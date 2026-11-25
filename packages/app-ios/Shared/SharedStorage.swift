import FavaEngine
import Foundation

/// What the app and the AutoFill extension share: the vault file in the app
/// group container and the unlocked session in the shared Keychain access
/// group. Both identifiers come from Info.plist, where the build fills in the
/// team prefix.
enum SharedStorage {
    static let appGroup = infoString("FavaAppGroup")
    static let keychainGroup = infoString("FavaKeychainGroup")

    static let sessions = UnlockedSessionStore(service: "nl.appeal.fava.unlockedSession", accessGroup: keychainGroup)

    static let engineConfiguration = FavaEngine.Configuration(deviceType: "favaios")

    /// The locked vault, as favalib last saved it.
    static var vaultURL: URL {
        get throws {
            guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
                throw SharedStorageError.noAppGroup(appGroup)
            }
            return container.appendingPathComponent("vault.json")
        }
    }

    static func readVault() throws -> String? {
        let url = try vaultURL
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// The engine's `onSave`: an atomic write, readable while the device is
    /// locked so AutoFill works from the lock screen's keyboard too. The vault
    /// is encrypted; the file protection is not what keeps it secret.
    @Sendable static func writeVault(_ locked: String) throws {
        try Data(locked.utf8).write(to: try vaultURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func deleteVault() throws {
        let url = try vaultURL
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    private static func infoString(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String, !value.isEmpty else {
            fatalError("\(key) is missing from Info.plist")
        }
        return value
    }
}

enum SharedStorageError: LocalizedError {
    case noAppGroup(String)

    var errorDescription: String? {
        switch self {
        case .noAppGroup(let group): "The app group \(group) is not available; check the entitlements."
        }
    }
}
