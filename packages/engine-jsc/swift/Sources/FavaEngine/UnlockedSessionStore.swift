#if canImport(LocalAuthentication) && canImport(Security)
import Foundation
import LocalAuthentication
import Security

/// Keeps favalib's unlocked session in the Keychain, under the one contract
/// favalib allows for storing it outside memory
/// (PersistentStorageManager.exportUnlockedSession):
///
/// - `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`: never in a backup or
///   iCloud Keychain, and deleted by the OS if the device passcode is removed.
/// - `.biometryCurrentSet`: released only after a fresh Face ID / Touch ID
///   match, and invalidated when the enrolled biometrics change -- adding a
///   face does not inherit the vault. No passcode fallback: whoever knows the
///   passcode can enrol a face, and that is exactly what this must not allow.
///
/// All of these attributes are load-bearing; do not relax one without
/// changing favalib's documented contract first.
///
/// Lifecycle obligations on the app:
/// - delete on lock (a lock means the session is gone, not just the memory copy);
/// - on `passwordChanged`, save a fresh export (the old one no longer opens
///   the vault anyway);
/// - when `unlock(session:)` fails for any reason, delete and ask for the password.
///
/// Reading it blocks while the biometric prompt is up, so `load` is async and
/// runs off the caller's thread.
public struct UnlockedSessionStore: Sendable {
    public enum Failure: Error, Equatable {
        /// The user dismissed the biometric prompt.
        case cancelled
        /// No biometrics enrolled, or no passcode set: the item cannot exist.
        case unavailable
        case keychain(OSStatus)
    }

    public let service: String
    public let account: String
    /// Set to a Keychain access group shared with the AutoFill extension.
    public let accessGroup: String?

    public init(
        service: String = "favaenginejsc.unlockedSession",
        account: String = "vault",
        accessGroup: String? = nil
    ) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }

    private var baseQuery: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }

    /// Stores a session, replacing any previous one.
    public func save(_ session: String) throws {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &error
        ) else {
            throw Failure.unavailable
        }
        try delete()
        var query = baseQuery
        query[kSecAttrAccessControl as String] = access
        query[kSecValueData as String] = Data(session.utf8)
        let status = SecItemAdd(query as CFDictionary, nil)
        switch status {
        case errSecSuccess: return
        case errSecNotAvailable, errSecAuthFailed: throw Failure.unavailable
        default: throw Failure.keychain(status)
        }
    }

    /// Reads the session, showing the biometric prompt.
    ///
    /// Face ID is evaluated first, with `LAContext`, and the item is then read
    /// with that authenticated context and no UI of its own. Leaving the prompt
    /// to the Keychain read fails in an app extension with
    /// errSecInteractionNotAllowed. The item's `.biometryCurrentSet` still
    /// decides: only a context that matched the currently enrolled biometrics
    /// opens it.
    /// - Parameter reason: Shown in the prompt (Touch ID; Face ID uses the
    ///   app's NSFaceIDUsageDescription).
    /// - Returns: The session, or nil if none is stored (or it was invalidated
    ///   by a biometrics change).
    public func load(reason: String) async throws -> String? {
        // Its attributes are readable without authentication, so a missing
        // session costs no prompt.
        guard try exists() else { return nil }

        let context = LAContext()
        do {
            _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel, .userFallback: throw Failure.cancelled
            default: throw Failure.unavailable
            }
        }
        context.interactionNotAllowed = true

        let query = baseQuery
        return try await Task.detached(priority: .userInitiated) {
            var lookup = query
            lookup[kSecReturnData as String] = true
            lookup[kSecMatchLimit as String] = kSecMatchLimitOne
            lookup[kSecUseAuthenticationContext as String] = context
            var result: CFTypeRef?
            let status = SecItemCopyMatching(lookup as CFDictionary, &result)
            switch status {
            case errSecSuccess:
                guard let data = result as? Data else { return nil }
                return String(decoding: data, as: UTF8.self)
            case errSecItemNotFound:
                return nil
            case errSecUserCanceled:
                throw Failure.cancelled
            case errSecAuthFailed, errSecNotAvailable:
                throw Failure.unavailable
            default:
                throw Failure.keychain(status)
            }
        }.value
    }

    private func exists() throws -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        var lookup = baseQuery
        lookup[kSecReturnAttributes as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        lookup[kSecUseAuthenticationContext as String] = context
        switch SecItemCopyMatching(lookup as CFDictionary, nil) {
        case errSecSuccess, errSecInteractionNotAllowed: return true
        case errSecItemNotFound: return false
        case let status: throw Failure.keychain(status)
        }
    }

    /// Deletes the stored session, if any.
    public func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw Failure.keychain(status)
        }
    }
}
#endif
