import AuthenticationServices
import FavaEngine
import SwiftUI

/// Fills in one-time codes. It only ever unlocks from the session the app
/// saved, behind Face ID: no password, so no argon2 (64 MiB) under the
/// extension's memory limit, and no network. Without a usable session it tells
/// the user to open the app.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let model = AutoFillModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: AutoFillView(
            model: model,
            onPick: { [weak self] code in self?.complete(with: code) },
            onCancel: { [weak self] in self?.cancel() }
        ))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        Task { await model.load(for: serviceIdentifiers) }
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        Task { await model.load(for: [credentialRequest.credentialIdentity.serviceIdentifier]) }
    }

    /// Reading the session needs Face ID, which needs the extension's UI.
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    private func complete(with code: String) {
        model.close()
        extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: code))
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
        case needsApp
        case ready(matches: [Entry], others: [Entry])
        case failed(String)
    }

    private(set) var state = State.loading
    private var engine: FavaEngine?

    func load(for serviceIdentifiers: [ASCredentialServiceIdentifier]) async {
        let session: String?
        do {
            session = try await SharedStorage.sessions.load(reason: "Fill in a code")
        } catch UnlockedSessionStore.Failure.cancelled {
            state = .needsApp
            return
        } catch {
            session = nil
        }
        guard let session, let locked = try? SharedStorage.readVault() else {
            state = .needsApp
            return
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
                state = .needsApp
                return
            }
            var matches: [Entry] = []
            for identifier in serviceIdentifiers {
                matches += try await engine.entries(forURL: Self.url(for: identifier))
            }
            let matched = Set(matches.map(\.id))
            let others = try await engine.entries().filter { !matched.contains($0.id) }
            state = .ready(matches: matches, others: others)
        } catch {
            close()
            state = .failed((error as? FavaEngineError)?.message ?? error.localizedDescription)
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
    let onPick: (String) -> Void
    let onCancel: () -> Void

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
        case .needsApp:
            ContentUnavailableView(
                "Open Fava to unlock",
                systemImage: "lock",
                description: Text("Unlock Fava with your password, with \"Unlock with Face ID\" turned on in its settings. Then try again.")
            )
        case .failed(let message):
            ContentUnavailableView("Something went wrong", systemImage: "exclamationmark.triangle", description: Text(message))
        case .ready(let matches, let others):
            List {
                if !matches.isEmpty {
                    Section("For this site") { rows(matches) }
                }
                if !others.isEmpty {
                    Section(matches.isEmpty ? "All codes" : "Other codes") { rows(others) }
                }
            }
            .overlay {
                if matches.isEmpty && others.isEmpty {
                    ContentUnavailableView("No codes", systemImage: "key")
                }
            }
        }
    }

    private func rows(_ entries: [Entry]) -> some View {
        ForEach(entries) { entry in
            if let otp = entry.token?.otp {
                Button { onPick(otp) } label: {
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
