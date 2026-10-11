#if canImport(JavaScriptCore)
import XCTest
@testable import FavaEngine

/// The real stack: the built bundle, in a JSContext, with FavaHost's native
/// argon2, randomness and timers. Needs `make -C packages/engine-jsc build`
/// first, which puts the bundle into this package's resources.
final class FavaEngineTests: XCTestCase {
    private let password = "correct-horse-battery-staple-ios-9!"
    private let saves = Saves()

    private final class Saves: @unchecked Sendable {
        enum Failure: Error { case diskFull }
        private let lock = NSLock()
        private var all: [String] = []
        private var failNext = false
        func failNextSave() { lock.withLock { failNext = true } }
        func append(_ save: String) throws {
            try lock.withLock {
                if failNext {
                    failNext = false
                    throw Failure.diskFull
                }
                all.append(save)
            }
        }
        var last: String? { lock.withLock { all.last } }
        var count: Int { lock.withLock { all.count } }
    }

    private func startEngine() async throws -> FavaEngine {
        try await FavaEngine.start(
            configuration: .init(deviceType: "favaenginejsc-tests"),
            onSave: { [saves] in try saves.append($0) }
        )
    }

    private let rfcEntry = NewEntry(
        name: "RFC 6238", issuer: "Fava",
        payload: TotpPayload(secret: "JBSWY3DPEHPK3PXP")
    )

    func testCreatesAVaultAndGeneratesTheRFC6238Code() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }

        try await engine.createVault(password: password)
        XCTAssertGreaterThan(saves.count, 0, "the vault reaches onSave")

        let id = try await engine.addEntry(rfcEntry)
        let token = try await engine.token(for: id, at: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(token.otp, "324550")

        let entries = try await engine.entries()
        XCTAssertEqual(entries.map(\.name), ["RFC 6238"])
        XCTAssertEqual(entries.first?.token?.otp.count, 6)
    }

    func testRejectsAWeakPasswordWithAStableKind() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }

        let strength = try await engine.passwordStrength("password1")
        XCTAssertFalse(strength.isAcceptable)
        do {
            try await engine.createVault(password: "password1")
            XCTFail("a weak password was accepted")
        } catch let error as FavaEngineError {
            XCTAssertNotEqual(error.kind, "internal")
        }
    }

    func testRejectsCreationWhenTheNativeSaveFails() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        saves.failNextSave()
        do {
            try await engine.createVault(password: password)
            XCTFail("creation succeeded without persisting the vault")
        } catch let error as FavaEngineError {
            XCTAssertTrue(error.message.contains("diskFull"))
        }
        XCTAssertEqual(saves.count, 0)
    }

    func testRollsBackAPasswordChangeWhenTheNativeSaveFails() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        try await engine.createVault(password: password)
        let session = try await engine.exportUnlockedSession()
        let saved = try XCTUnwrap(saves.last)
        saves.failNextSave()
        do {
            try await engine.changePassword(from: password, to: password + "-new")
            XCTFail("password change succeeded without persisting the vault")
        } catch let error as FavaEngineError {
            XCTAssertTrue(error.message.contains("diskFull"))
        }
        let sessionAfterFailure = try await engine.exportUnlockedSession()
        XCTAssertEqual(sessionAfterFailure, session)
        XCTAssertEqual(saves.last, saved)

        // A later successful save must still use the original password.
        _ = try await engine.addEntry(rfcEntry)
        try await engine.lock()
        try await engine.unlock(
            lockedRepresentation: XCTUnwrap(saves.last), password: password,
            connectToSyncServer: false
        )
        let entries = try await engine.entries()
        XCTAssertEqual(entries.map(\.name), ["RFC 6238"])
    }

    func testUnlocksWithThePasswordAndRefusesAWrongOne() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        try await engine.createVault(password: password)
        _ = try await engine.addEntry(rfcEntry)
        let saved = try XCTUnwrap(saves.last)
        try await engine.lock()

        do {
            try await engine.unlock(lockedRepresentation: saved, password: "definitely-not-it-123", connectToSyncServer: false)
            XCTFail("a wrong password unlocked the vault")
        } catch is FavaEngineError {}

        try await engine.unlock(lockedRepresentation: saved, password: password, connectToSyncServer: false)
        let names = try await engine.entries().map(\.name)
        XCTAssertEqual(names, ["RFC 6238"])
    }

    /// The AutoFill extension path: a cold engine, the vault file and a
    /// session, no password and no argon2.
    func testUnlocksFromAnExportedSessionInAColdEngine() async throws {
        let app = try await startEngine()
        try await app.createVault(password: password)
        _ = try await app.addEntry(rfcEntry)
        let session = try await app.exportUnlockedSession()
        let saved = try XCTUnwrap(saves.last)
        app.shutdown()

        let extensionEngine = try await startEngine()
        defer { extensionEngine.shutdown() }
        let started = Date()
        try await extensionEngine.unlock(lockedRepresentation: saved, session: session, connectToSyncServer: false)
        let names = try await extensionEngine.entries().map(\.name)
        XCTAssertEqual(names, ["RFC 6238"])
        print("unlock from session + list: \(Int(Date().timeIntervalSince(started) * 1000)) ms")
    }

    func testRoundTripsAnEncryptedExport() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        try await engine.createVault(password: password)
        _ = try await engine.addEntry(rfcEntry)

        let exported = try await engine.exportText(password: "export-Password-%-strong-42")
        XCTAssertTrue(exported.contains("-----BEGIN PGP MESSAGE-----"))
        let results = try await engine.importText(exported, password: "export-Password-%-strong-42")
        XCTAssertEqual(results.compactMap(\.entryId).count, 1)
    }

    func testImportsAnOtpauthURIAndMatchesUrls() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        try await engine.createVault(password: password)
        _ = try await engine.importURI("otpauth://totp/ACME:alice%40example.com?secret=GEZDGNBVGY3TQOJQ&issuer=ACME")
        _ = try await engine.addEntry(NewEntry(
            name: "GitHub", issuer: "GitHub",
            payload: TotpPayload(secret: "JBSWY3DPEHPK3PXP"),
            matchers: [UrlMatcher(type: "BaseDomain", value: "github.com")]
        ))
        let matched = try await engine.entries(forURL: "https://github.com/login").map(\.name)
        XCTAssertEqual(matched, ["GitHub"])
    }

    func testForwardsEvents() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        try await engine.createVault(password: password)
        _ = try await engine.addEntry(rfcEntry)
        var sawChanged = false
        for await event in engine.events {
            if event.kind == .changed {
                sawChanged = true
                break
            }
        }
        XCTAssertTrue(sawChanged)
    }

    /// Timers are host timers on the engine's run loop. favalib's Ready event
    /// is dispatched from a setTimeout, so seeing it proves they fire.
    func testHostTimersFire() async throws {
        let engine = try await startEngine()
        defer { engine.shutdown() }
        try await engine.createVault(password: password)
        var sawReady = false
        for await event in engine.events where event.kind == .ready {
            sawReady = true
            break
        }
        XCTAssertTrue(sawReady)
    }
}
#endif
