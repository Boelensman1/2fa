#if canImport(JavaScriptCore)
import Foundation
import JavaScriptCore
import os

/// favalib, running in a JavaScriptCore context on its own thread.
///
/// Every method is async and safe to call from any thread or actor; calls are
/// served one at a time, in order, on the engine's thread. The engine holds at
/// most one unlocked vault.
///
/// Two things leave the engine on their own:
/// - the vault, through `onSave`, whenever favalib saves (encrypted and MAC'd,
///   safe to write to disk -- write it atomically, to the app group container
///   if an AutoFill extension needs it);
/// - favalib's events, on `events`.
///
/// The JS side is `packages/engine-jsc/src/engine.mts`; the method names here
/// are its `methods`.
public final class FavaEngine: @unchecked Sendable {
    public struct Configuration: Sendable {
        /// favalib's device type, shown to paired devices, e.g. "favaios".
        public var deviceType: String
        /// Words zxcvbn should treat as guessable in a vault password.
        public var passwordExtraDict: [String]
        /// The engine bundle. Defaults to the one in this package's resources.
        public var bundleURL: URL?

        public init(deviceType: String, passwordExtraDict: [String] = ["phone", "iphone"], bundleURL: URL? = nil) {
            self.deviceType = deviceType
            self.passwordExtraDict = passwordExtraDict
            self.bundleURL = bundleURL
        }
    }

    /// favalib's events, in order.
    public let events: AsyncStream<EngineEvent>

    private let thread: JSThread
    private let host: FavaHost
    private let eventContinuation: AsyncStream<EngineEvent>.Continuation
    private let logger = Logger(subsystem: "favaenginejsc", category: "engine")
    // JS-thread state.
    private var context: JSContext?
    private var engine: JSValue?
    /// The last exception JS threw out to native code; cleared before each
    /// entry into JS, so a stray one from a timer callback cannot fail an
    /// unrelated call.
    private var lastException: JSValue?

    private init(onSave: @escaping @Sendable (String) -> Void) {
        let (events, continuation) = AsyncStream<EngineEvent>.makeStream()
        let thread = JSThread()
        self.events = events
        self.eventContinuation = continuation
        self.thread = thread
        self.host = FavaHost(
            thread: thread,
            onSave: onSave,
            onEvent: { type, detail in continuation.yield(EngineEvent(type: type, detailJSON: detail)) }
        )
    }

    /// Starts an engine: a thread, a context, the bundle evaluated in it.
    /// - Parameters:
    ///   - configuration: Device type and bundle location.
    ///   - onSave: Receives every vault favalib saves, on the engine thread.
    public static func start(
        configuration: Configuration,
        onSave: @escaping @Sendable (String) -> Void
    ) async throws -> FavaEngine {
        guard let url = configuration.bundleURL ?? Bundle.module.url(forResource: "fava-engine", withExtension: "js") else {
            throw FavaEngineError(kind: "usage", message: "fava-engine.js is missing; run `make -C packages/engine-jsc build`")
        }
        let source = try String(contentsOf: url, encoding: .utf8)
        let engine = FavaEngine(onSave: onSave)
        engine.thread.startAndWait()
        try await engine.onThread { try engine.boot(source: source) }
        struct Config: Encodable { var deviceType: String; var passwordExtraDict: [String] }
        let _: Nothing = try await engine.call(
            "configure",
            [Config(deviceType: configuration.deviceType, passwordExtraDict: configuration.passwordExtraDict)]
        )
        return engine
    }

    private func boot(source: String) throws {
        guard let context = JSContext() else {
            throw FavaEngineError(kind: "internal", message: "could not create a JSContext")
        }
        context.name = "FavaEngine"
        context.exceptionHandler = { [weak self, logger = self.logger] _, exception in
            logger.error("JS exception: \(exception?.toString() ?? "?", privacy: .public)")
            self?.lastException = exception
        }
        host.install(in: context)
        lastException = nil
        context.evaluateScript(source, withSourceURL: URL(string: "fava-engine.js"))
        if let exception = lastException {
            lastException = nil
            throw FavaEngineError(kind: "internal", message: "bundle failed to load: \(exception)")
        }
        guard let engine = context.objectForKeyedSubscript("favaEngine"), engine.isObject else {
            throw FavaEngineError(kind: "internal", message: "bundle did not define favaEngine")
        }
        self.context = context
        self.engine = engine
    }

    /// Stops the engine: drops the vault, closes sockets, ends the thread.
    public func shutdown() {
        thread.perform { [self] in
            host.tearDown()
            engine = nil
            context = nil
            eventContinuation.finish()
        }
        thread.stop()
    }

    // MARK: - The generic door

    /// Calls an engine method by name. The typed methods below are wrappers
    /// around this; use it directly for anything they do not cover.
    /// - Parameters:
    ///   - method: A name from engine.mts' `methods`.
    ///   - arguments: Encoded as a JSON array; pass `Optional.none` for null.
    public func call<Result: Decodable>(
        _ method: String,
        _ arguments: [any Encodable] = []
    ) async throws -> Result {
        let argumentsJSON = String(
            decoding: try JSONEncoder().encode(arguments.map(AnyEncodable.init)),
            as: UTF8.self
        )
        let resultJSON: String = try await withCheckedThrowingContinuation { continuation in
            thread.perform { [self] in
                guard let context, let engine else {
                    continuation.resume(throwing: FavaEngineError(kind: "usage", message: "the engine is shut down"))
                    return
                }
                let resolve: @convention(block) (JSValue) -> Void = { value in
                    continuation.resume(returning: value.toString())
                }
                let reject: @convention(block) (JSValue) -> Void = { reason in
                    let message = reason.forProperty("message")?.toString() ?? reason.toString() ?? ""
                    continuation.resume(throwing: FavaEngineError(rejectionMessage: message))
                }
                lastException = nil
                let promise = engine.invokeMethod("call", withArguments: [method, argumentsJSON])
                if let exception = lastException {
                    lastException = nil
                    continuation.resume(throwing: FavaEngineError(kind: "internal", message: exception.toString()))
                    return
                }
                promise?.invokeMethod("then", withArguments: [
                    JSValue(object: unsafeBitCast(resolve, to: AnyObject.self), in: context) as Any,
                    JSValue(object: unsafeBitCast(reject, to: AnyObject.self), in: context) as Any,
                ])
            }
        }
        return try JSONDecoder().decode(Result.self, from: Data(resultJSON.utf8))
    }

    private func onThread<T>(_ body: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            thread.perform { continuation.resume(with: Result { try body() }) }
        }
    }

    // MARK: - Vault

    public func status() async throws -> EngineStatus {
        try await call("status")
    }

    public func passwordStrength(_ password: String) async throws -> PasswordStrength {
        try await call("passwordStrength", [password])
    }

    /// Creates a vault and keeps it unlocked; it reaches `onSave` at once.
    public func createVault(password: String) async throws {
        let _: Nothing = try await call("createVault", [password])
    }

    /// Unlocks with the password: one argon2id pass.
    public func unlock(lockedRepresentation: String, password: String, connectToSyncServer: Bool = true) async throws {
        let _: Nothing = try await call("unlockWithPassword", [lockedRepresentation, password, connectToSyncServer])
    }

    /// Unlocks from an exported session: no key derivation. On any error,
    /// delete the stored session and ask for the password.
    public func unlock(lockedRepresentation: String, session: String, connectToSyncServer: Bool = true) async throws {
        let _: Nothing = try await call("unlockWithSession", [lockedRepresentation, session, connectToSyncServer])
    }

    /// PLAINTEXT KEY MATERIAL. Store it only through `UnlockedSessionStore`,
    /// which applies the storage contract favalib documents on
    /// PersistentStorageManager.exportUnlockedSession.
    public func exportUnlockedSession() async throws -> String {
        try await call("exportUnlockedSession")
    }

    /// Drops the unlocked vault. Delete the stored session too: under
    /// favalib's contract, a lock means the session is gone.
    public func lock() async throws {
        let _: Nothing = try await call("lock")
    }

    /// Re-encrypts the vault under a new password. Emits `passwordChanged`;
    /// a session exported before this no longer opens the vault.
    public func changePassword(from oldPassword: String, to newPassword: String) async throws {
        let _: Nothing = try await call("changePassword", [oldPassword, newPassword])
    }

    // MARK: - Entries

    /// Every entry (or those whose name or issuer contains `query`), with its
    /// current code.
    public func entries(matching query: String? = nil) async throws -> [Entry] {
        try await call("listEntries", [query])
    }

    /// The entries AutoFill should offer for a url, with current codes.
    public func entries(forURL url: String) async throws -> [Entry] {
        try await call("entriesForUrl", [url])
    }

    public func token(for entryId: String, at date: Date? = nil) async throws -> Token {
        try await call("token", [entryId, date.map { $0.timeIntervalSince1970 * 1000 }])
    }

    /// - Returns: The new entry's id.
    public func addEntry(_ entry: NewEntry) async throws -> String {
        try await call("addEntry", [entry])
    }

    public func updateEntry(_ entryId: String, _ update: EntryUpdate) async throws -> Entry {
        try await call("updateEntry", [entryId, update])
    }

    public func deleteEntry(_ entryId: String) async throws {
        let _: Nothing = try await call("deleteEntry", [entryId])
    }

    /// Adds an entry from an otpauth:// uri, e.g. a scanned QR code.
    /// - Returns: The new entry's id.
    public func importURI(_ uri: String) async throws -> String {
        try await call("importUri", [uri])
    }

    /// Imports a fava text export; `password` for an encrypted one.
    public func importText(_ text: String, password: String? = nil) async throws -> [ImportResult] {
        try await call("importText", [text, password])
    }

    /// An encrypted (OpenPGP, argon2) export of every entry.
    public func exportText(password: String) async throws -> String {
        try await call("exportText", [password])
    }

    /// A PLAINTEXT export. Only after warning the user.
    public func exportPlaintext(userWasWarned: Bool) async throws -> String {
        try await call("exportText", [String?.none, userWasWarned])
    }

    // MARK: - Sync

    /// Resolves once the server accepted the shared secret.
    public func setSyncServer(url: String, secret: String) async throws {
        let _: Nothing = try await call("setSyncServer", [url, secret])
    }

    /// Starts pairing as the device that has the vault.
    public func initiatePairing() async throws -> PairingCode {
        try await call("initiatePairing")
    }

    /// Joins another device's vault, replacing this one's. `payload` is the
    /// text code or a scanned QR code. Watch for
    /// `connectToExistingVaultFinished`.
    public func respondToPairing(_ payload: String) async throws {
        let _: Nothing = try await call("respondToPairing", [payload])
    }

    public func cancelPairing() async throws {
        let _: Nothing = try await call("cancelPairing")
    }

    public func syncDevices() async throws -> [SyncDevice] {
        try await call("syncDevices")
    }

    public func removeSyncDevice(_ deviceId: String) async throws {
        let _: Nothing = try await call("removeSyncDevice", [deviceId])
    }

    public func setDeviceFriendlyName(_ name: String) async throws {
        let _: Nothing = try await call("setDeviceFriendlyName", [name])
    }
}

/// Decodes the `null` a method without a result returns.
struct Nothing: Decodable {
    init(from decoder: Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
#endif
