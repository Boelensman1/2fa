import AuthenticationServices
import FavaEngine
import SwiftUI
import UIKit

/// Fills in one-time codes. It only ever unlocks from the session the app
/// saved, behind Face ID: no password, so no argon2 (64 MiB) under the
/// extension's memory limit, and no network. Without a usable session it tells
/// the user to open the app.
///
/// iOS reaches it three ways, and each finishes differently (`Mode`):
/// - a one-time code field: the bar's suggestion, or the code list;
/// - long-press a field > AutoFill > Fava: any field, recognised or not;
/// - Fava picked from the password sheet, which iOS offers on login forms and
///   which cannot take a code: the code is copied to paste instead.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    enum Mode {
        case oneTimeCode
        case textToInsert
        case password
    }

    private let model = AutoFillModel()
    private var mode = Mode.oneTimeCode
    /// iOS asks for codes before the view is on screen, and Face ID cannot be
    /// shown until it is: the request waits here until `viewDidAppear`.
    private var pending: (() -> Void)?
    private var appeared = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: AutoFillView(
            model: model,
            onPick: { [weak self] entry, remember in self?.pick(entry, remember: remember) },
            onCancel: { [weak self] in self?.cancel() }
        ))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appeared = true
        pending?()
        pending = nil
    }

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        start(.oneTimeCode, for: serviceIdentifiers)
    }

    override func prepareInterfaceForUserChoosingTextToInsert() {
        start(.textToInsert, for: [])
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        start(.password, for: serviceIdentifiers)
    }

    /// A suggestion the keyboard offered from the identities the app
    /// registered: fill that entry's code straight after Face ID.
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        mode = .oneTimeCode
        let identity = credentialRequest.credentialIdentity
        whenOnScreen { [weak self, model] in
            Task {
                if let token = await model.load(for: [identity.serviceIdentifier], mode: .oneTimeCode, picking: identity.recordIdentifier) {
                    self?.complete(with: token)
                }
            }
        }
    }

    private func start(_ mode: Mode, for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        self.mode = mode
        whenOnScreen { [weak self, model] in
            Task {
                if let token = await model.load(for: serviceIdentifiers, mode: mode) {
                    self?.complete(with: token)
                }
            }
        }
    }

    private func whenOnScreen(_ work: @escaping () -> Void) {
        if appeared { work() } else { pending = work }
    }

    /// Reading the session needs Face ID, which needs the extension's UI.
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    private func pick(_ entry: Entry, remember: Bool) {
        guard let token = entry.token else { return }
        Task {
            if remember { await model.rememberSite(for: entry) }
            complete(with: token)
        }
    }

    private func complete(with token: Token) {
        model.close()
        switch mode {
        case .oneTimeCode:
            extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: token.otp))
        case .textToInsert:
            extensionContext.completeRequest(withTextToInsert: token.otp)
        case .password:
            // A password request cannot carry a code. Copy it, local to this
            // device and only for as long as it is valid, and step aside.
            UIPasteboard.general.setItems(
                [[UIPasteboard.typeAutomatic: token.otp]],
                options: [.localOnly: true, .expirationDate: token.validTillDate]
            )
            extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
        }
    }

    private func cancel() {
        model.close()
        extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
    }
}

@MainActor
@Observable
final class AutoFillModel {
    enum State {
        case loading
        /// No session, or it no longer works: the app has to unlock first.
        /// `reason` says which, small, for when it should have worked.
        case needsApp(reason: String)
        /// `nearby`: favalib matched nothing, and these claim a subdomain of
        /// the site iOS named (it may name only the registrable domain).
        case ready(matches: [Entry], nearby: [Entry], others: [Entry])
        case failed(String)
    }

    private(set) var state = State.loading
    private(set) var mode = CredentialProviderViewController.Mode.oneTimeCode
    /// The site the request is for, when it names one: picking a code from
    /// "Other codes" offers to remember it, so iOS suggests that entry here.
    private(set) var site: String?
    /// What iOS said the request is for, shown small at the top of the list:
    /// it decides what matches, and is otherwise invisible.
    private(set) var requestedFor: [String] = []
    private var engine: FavaEngine?

    /// - Parameter entryId: The entry the user already chose. When it is
    ///   still there, its code is returned instead of showing the list.
    /// - Returns: The code to fill without showing the list: the chosen
    ///   entry's, or on a one-time code field the only entry for the site.
    @discardableResult
    func load(
        for serviceIdentifiers: [ASCredentialServiceIdentifier],
        mode: CredentialProviderViewController.Mode,
        picking entryId: String? = nil
    ) async -> Token? {
        self.mode = mode
        site = serviceIdentifiers.lazy.compactMap { SiteDomains.of($0) }.first
        requestedFor = serviceIdentifiers.map(\.identifier)
        let session: String
        let locked: String
        do {
            guard let stored = try await SharedStorage.sessions.load(reason: "Fill in a code") else {
                state = .needsApp(reason: "No saved session.")
                return nil
            }
            session = stored
        } catch UnlockedSessionStore.Failure.cancelled {
            state = .needsApp(reason: "Face ID was cancelled.")
            return nil
        } catch {
            state = .needsApp(reason: "Reading the saved session failed: \(error).")
            return nil
        }
        do {
            guard let vault = try SharedStorage.readVault() else {
                state = .needsApp(reason: "No vault file.")
                return nil
            }
            locked = vault
        } catch {
            state = .needsApp(reason: "Reading the vault failed: \(error.localizedDescription)")
            return nil
        }

        do {
            let engine = try await FavaEngine.start(configuration: SharedStorage.engineConfiguration, onSave: SharedStorage.writeVault)
            self.engine = engine
            do {
                try await engine.unlock(lockedRepresentation: locked, session: session, connectToSyncServer: false)
            } catch {
                // The contract: a session that failed once is never tried again.
                try? SharedStorage.sessions.delete()
                close()
                state = .needsApp(reason: "The saved session did not open the vault: \((error as? FavaEngineError)?.message ?? error.localizedDescription)")
                return nil
            }
            if let entryId, let token = try? await engine.token(for: entryId) {
                return token
            }
            var matches: [Entry] = []
            for identifier in serviceIdentifiers {
                matches += try await engine.entries(forURL: Self.url(for: identifier))
            }
            // One entry for the site, on a code field: nothing to choose.
            // Text to insert names no site, and a password field cannot take
            // the code, so those always show the list.
            if mode == .oneTimeCode, matches.count == 1, let token = matches[0].token {
                return token
            }
            let all = try await engine.entries()
            let matched = Set(matches.map(\.id))
            var nearby: [Entry] = []
            if matches.isEmpty, let site {
                nearby = all.filter { entry in
                    SiteDomains.of(entry).contains { $0 == site || $0.hasSuffix("." + site) }
                }
            }
            let shown = matched.union(nearby.map(\.id))
            state = .ready(matches: matches, nearby: nearby, others: all.filter { !shown.contains($0.id) })
        } catch {
            close()
            state = .failed((error as? FavaEngineError)?.message ?? error.localizedDescription)
        }
        return nil
    }

    /// Adds the request's site to the entry as a `Host` matcher, exactly the
    /// host iOS named and nothing under it, so the next time iOS suggests it
    /// there: in the vault, which syncs it to the other devices when the
    /// app next connects (favalib keeps the edit queued until then), and in
    /// iOS's store directly, so it works before the app is opened again.
    /// Best effort: the code is filled whether or not this works.
    func rememberSite(for entry: Entry) async {
        guard let engine, let site, !SiteDomains.of(entry).contains(site) else { return }
        do {
            _ = try await engine.updateEntry(entry.id, EntryUpdate(matchers: entry.matchers + [UrlMatcher(type: "Host", value: site)]))
        } catch {
            return
        }
        let store = ASCredentialIdentityStore.shared
        if await store.state().isEnabled {
            try? await store.saveCredentialIdentities([SiteDomains.identity(domain: site, entry: entry)])
        }
    }

    func close() {
        engine?.shutdown()
        engine = nil
    }

    private static func url(for identifier: ASCredentialServiceIdentifier) -> String {
        switch identifier.type {
        case .domain: "https://\(identifier.identifier)"
        default: identifier.identifier
        }
    }
}

struct AutoFillView: View {
    let model: AutoFillModel
    /// The entry picked, and whether to remember the site for it.
    let onPick: (Entry, Bool) -> Void
    let onCancel: () -> Void
    @State private var search = ""
    /// Picked from "Other codes" on a site: asking whether to remember it.
    @State private var offering: Entry?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Fava")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
        case .needsApp(let reason):
            ContentUnavailableView {
                Label("Open Fava to unlock", systemImage: "lock")
            } description: {
                Text("Unlock Fava with your password, with \"Unlock with Face ID\" turned on in its settings. Then try again.")
            } actions: {
                Text(reason).font(.caption).foregroundStyle(.secondary)
            }
        case .failed(let message):
            ContentUnavailableView("Something went wrong", systemImage: "exclamationmark.triangle", description: Text(message))
        case .ready(let allMatches, let allNearby, let allOthers):
            let matches = allMatches.filter { $0.matches(search: search) }
            let nearby = allNearby.filter { $0.matches(search: search) }
            let others = allOthers.filter { $0.matches(search: search) }
            List {
                Section {
                } footer: {
                    Text(model.requestedFor.isEmpty ? "iOS did not say which site this is for." : "For \(model.requestedFor.joined(separator: ", "))")
                }
                if model.mode == .password {
                    Section {
                        Text("This field takes a password, not a code. Picking a code copies it: paste it into the code field.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                if !matches.isEmpty {
                    Section("For this site") { rows(matches, offerToRemember: false) }
                }
                if !nearby.isEmpty, let site = model.site {
                    Section("On sites under \(site)") { rows(nearby, offerToRemember: false) }
                }
                if !others.isEmpty {
                    Section(matches.isEmpty && nearby.isEmpty ? "All codes" : "Other codes") { rows(others, offerToRemember: model.site != nil) }
                }
            }
            .overlay {
                if allMatches.isEmpty && allNearby.isEmpty && allOthers.isEmpty {
                    ContentUnavailableView("No codes", systemImage: "key")
                } else if matches.isEmpty && nearby.isEmpty && others.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .searchable(text: $search, prompt: "Name or issuer")
            .confirmationDialog(
                offerTitle,
                isPresented: Binding(get: { offering != nil }, set: { if !$0 { offering = nil } }),
                titleVisibility: .visible,
                presenting: offering
            ) { entry in
                Button("Suggest it here") { onPick(entry, true) }
                Button("Just this time") { onPick(entry, false) }
            } message: { _ in
                Text("Adds the site to the entry. With sync on, your other devices get it too.")
            }
        }
    }

    private var offerTitle: String {
        guard let entry = offering, let site = model.site else { return "" }
        return "Suggest \(SiteDomains.label(for: entry)) on \(site) from now on?"
    }

    private func rows(_ entries: [Entry], offerToRemember: Bool) -> some View {
        ForEach(entries) { entry in
            if let otp = entry.token?.otp {
                Button {
                    if offerToRemember { offering = entry } else { onPick(entry, false) }
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(entry.issuer.isEmpty ? entry.name : entry.issuer).font(.headline)
                            if !entry.issuer.isEmpty {
                                Text(entry.name).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text(otp).font(.title3.monospacedDigit())
                    }
                }
                .foregroundStyle(.primary)
            }
        }
    }
}
