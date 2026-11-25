import FavaEngine
import XCTest

/// Runs inside the app, with its entitlements: what these check is that the
/// app group and the Keychain access group the extension relies on are real.
final class SharedStorageTests: XCTestCase {
    private var appGroup: String { Bundle.main.object(forInfoDictionaryKey: "FavaAppGroup") as! String }
    private var keychainGroup: String { Bundle.main.object(forInfoDictionaryKey: "FavaKeychainGroup") as! String }

    func testTheKeychainGroupHasTheTeamPrefix() {
        XCTAssertEqual(keychainGroup, "HW2XFJ2L7B.nl.appeal.fava.shared")
    }

    func testTheAppGroupContainerIsAvailable() throws {
        let container = try XCTUnwrap(FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup))
        let probe = container.appendingPathComponent("probe-\(UUID().uuidString)")
        try Data("x".utf8).write(to: probe, options: .atomic)
        try FileManager.default.removeItem(at: probe)
    }

    /// Deleting touches the access group without a biometric prompt; a missing
    /// keychain-access-groups entitlement fails here with errSecMissingEntitlement.
    func testTheSessionStoreCanUseTheSharedAccessGroup() throws {
        let store = UnlockedSessionStore(service: "nl.appeal.fava.tests.\(UUID().uuidString)", accessGroup: keychainGroup)
        XCTAssertNoThrow(try store.delete())
    }

    /// Saving needs a passcode and enrolled biometrics, which a fresh
    /// simulator has neither of; then it must say so, not fail obscurely.
    func testSavingASessionWorksOrReportsBiometricsUnavailable() throws {
        let store = UnlockedSessionStore(service: "nl.appeal.fava.tests.\(UUID().uuidString)", accessGroup: keychainGroup)
        defer { try? store.delete() }
        do {
            try store.save("session")
        } catch UnlockedSessionStore.Failure.unavailable {
            throw XCTSkip("no passcode or biometrics enrolled on this device")
        }
    }
}
