import AuthenticationServices
import FavaEngine
import Foundation

/// Tells iOS which sites have codes, so the keyboard can suggest Fava on a
/// one-time code field. iOS only suggests what a provider has registered; the
/// extension is still what fills the code, behind Face ID.
///
/// Registered: one identity per entry and domain, taken from the entry's
/// matchers (`SiteDomains`, the same rules the extension matches with). Regex
/// matchers name no domain and are skipped, and an entry without matchers is
/// reachable only through the extension's full list. iOS stores the domains
/// and labels outside the vault's encryption; never the secrets or codes.
@MainActor
enum CredentialIdentities {
    enum Status: Equatable {
        /// Nothing tried yet in this process: the vault has not been
        /// unlocked since the app started.
        case unknown
        /// Fava is not switched on under AutoFill & Passwords.
        case disabled
        case registered(count: Int, at: Date)
        case failed(String, at: Date)
    }

    private(set) static var status = Status.unknown

    /// What was registered last, so the half-minute code refresh does not
    /// rewrite the store each time.
    private static var registered: Set<Identity>?

    /// Makes the next `update` write the store even if the entries did not
    /// change. iOS empties a provider's store behind its back (switching the
    /// provider off and on, some OS updates), and this process would never
    /// notice: the app calls it every time it comes to the foreground.
    static func invalidate() {
        registered = nil
    }

    static func update(for entries: [Entry]) async {
        let identities = Set(entries.flatMap { entry in
            SiteDomains.of(entry).map { Identity(domain: $0, label: SiteDomains.label(for: entry), entryId: entry.id) }
        })
        guard identities != registered else { return }
        let store = ASCredentialIdentityStore.shared
        // Off until Fava is enabled under AutoFill & Passwords; leaving
        // `registered` unset makes the next refresh try again.
        guard await store.state().isEnabled else {
            status = .disabled
            return
        }
        do {
            try await store.replaceCredentialIdentities(identities.map(\.credentialIdentity))
            registered = identities
            status = .registered(count: identities.count, at: .now)
        } catch {
            registered = nil
            status = .failed(error.localizedDescription, at: .now)
        }
    }

    static func removeAll() async {
        registered = nil
        status = .unknown
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
    }

    /// Whether Fava is switched on as an AutoFill provider.
    static func isEnabled() async -> Bool {
        await ASCredentialIdentityStore.shared.state().isEnabled
    }

    /// What iOS's store gives back, asked three ways. Registering reported
    /// success while a read-back of all one-time code identities came back
    /// empty, so this tells apart "nothing stored" (every count zero) from
    /// "stored, but that query does not list it".
    struct ReadBack {
        /// Distinct domains from asking for every identity type.
        var all: [String]
        /// Distinct domains from asking for one-time code identities only.
        var oneTimeCodes: [String]
        /// How many of the domains this process registered come back when
        /// asked for by name, out of `asked`.
        var foundByName: Int
        var asked: Int
    }

    static func readBack() async -> ReadBack {
        let store = ASCredentialIdentityStore.shared
        // `[]` is every type: the Objective-C `...TypesAll` is 0, which Swift
        // imports as the empty option set and marks `.all` unavailable.
        let all = await store.credentialIdentities(forService: nil, credentialIdentityTypes: [])
        let codes = await store.credentialIdentities(forService: nil, credentialIdentityTypes: .oneTimeCode)
        let domains = Set((registered ?? []).map(\.domain))
        var found = 0
        for domain in domains {
            let service = ASCredentialServiceIdentifier(identifier: domain, type: .domain)
            if !(await store.credentialIdentities(forService: service, credentialIdentityTypes: [])).isEmpty {
                found += 1
            }
        }
        return ReadBack(
            all: Set(all.map(\.serviceIdentifier.identifier)).sorted(),
            oneTimeCodes: Set(codes.map(\.serviceIdentifier.identifier)).sorted(),
            foundByName: found,
            asked: domains.count
        )
    }

    private struct Identity: Hashable {
        var domain: String
        var label: String
        var entryId: String

        var credentialIdentity: ASOneTimeCodeCredentialIdentity {
            ASOneTimeCodeCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: domain, type: .domain),
                label: label,
                recordIdentifier: entryId
            )
        }
    }
}
