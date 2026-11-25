import AuthenticationServices
import FavaEngine
import Foundation

/// The domains an entry claims, as iOS's AutoFill understands them: one per
/// matcher that names a host. Shared by the app, which registers them, and the
/// extension, which adds one when the user picks a code on a new site.
enum SiteDomains {
    /// The domains to register for an entry. Regex matchers name no domain,
    /// so an entry with only those (or none) is never suggested by iOS.
    static func of(_ entry: Entry) -> Set<String> {
        Set(entry.matchers.compactMap { of($0) })
    }

    static func of(_ matcher: UrlMatcher) -> String? {
        switch matcher.type {
        case "BaseDomain", "Host": normalise(matcher.value)
        case "Origin", "UrlPrefix": URL(string: matcher.value)?.host().flatMap { normalise($0) }
        default: nil
        }
    }

    /// The host a request is for, or nil for one that names none.
    static func of(_ identifier: ASCredentialServiceIdentifier) -> String? {
        switch identifier.type {
        case .domain: normalise(identifier.identifier)
        case .URL: URL(string: identifier.identifier)?.host().flatMap { normalise($0) }
        @unknown default: nil
        }
    }

    /// Normalised the way favalib compares hostnames: lowercased, without
    /// leading or trailing dots. Nil when nothing is left.
    static func normalise(_ host: String) -> String? {
        var host = host.lowercased()
        while host.hasPrefix(".") { host.removeFirst() }
        while host.hasSuffix(".") { host.removeLast() }
        return host.isEmpty ? nil : host
    }

    /// What iOS shows for an entry's suggestion.
    static func label(for entry: Entry) -> String {
        entry.issuer.isEmpty ? entry.name : entry.name.isEmpty ? entry.issuer : "\(entry.issuer) (\(entry.name))"
    }

    static func identity(domain: String, entry: Entry) -> ASOneTimeCodeCredentialIdentity {
        ASOneTimeCodeCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(identifier: domain, type: .domain),
            label: label(for: entry),
            recordIdentifier: entry.id
        )
    }
}
