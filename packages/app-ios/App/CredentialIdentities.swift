import AuthenticationServices
import FavaEngine
import Foundation

/// Tells iOS which sites have codes, so the keyboard can suggest Fava on a
/// one-time code field. iOS only suggests what a provider has registered; the
/// extension is still what fills the code, behind Face ID.
///
/// Registered: one identity per entry and domain, taken from the entry's
/// matchers (the same rules the extension matches with). Regex matchers name
/// no domain and are skipped, and an entry without matchers is reachable only
/// through the extension's full list. iOS stores the domains and labels outside
/// the vault's encryption; never the secrets or codes.
@MainActor
enum CredentialIdentities {
    /// What was registered last, so the half-minute code refresh does not
    /// rewrite the store each time.
    private static var registered: Set<Identity>?

    static func update(for entries: [Entry]) async {
        let identities = Set(entries.flatMap(identities(for:)))
        guard identities != registered else { return }
        let store = ASCredentialIdentityStore.shared
        // Off until Fava is enabled under AutoFill & Passwords; leaving
        // `registered` unset makes the next refresh try again.
        guard await store.state().isEnabled else { return }
        do {
            try await store.replaceCredentialIdentities(identities.map(\.credentialIdentity))
            registered = identities
        } catch {
            registered = nil
        }
    }

    static func removeAll() async {
        registered = nil
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
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

    private static func identities(for entry: Entry) -> [Identity] {
        let label = entry.issuer.isEmpty ? entry.name : entry.name.isEmpty ? entry.issuer : "\(entry.issuer) (\(entry.name))"
        let domains = Set(entry.matchers.compactMap(domain(of:)))
        return domains.map { Identity(domain: $0, label: label, entryId: entry.id) }
    }

    private static func domain(of matcher: UrlMatcher) -> String? {
        let host: String? = switch matcher.type {
        case "BaseDomain", "Host": matcher.value
        case "Origin", "UrlPrefix": URL(string: matcher.value)?.host()
        default: nil
        }
        // Normalised the way favalib compares hostnames.
        guard var host = host?.lowercased() else { return nil }
        while host.hasPrefix(".") { host.removeFirst() }
        while host.hasSuffix(".") { host.removeLast() }
        return host.isEmpty ? nil : host
    }
}
