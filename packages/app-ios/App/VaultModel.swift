import FavaEngine
import Foundation
import Observation

/// The app's one engine and the vault's state, for the views.
///
/// Two ways to stop showing codes, and they are not the same:
/// - `lock()` is the user's lock. favalib's contract says a lock deletes the
///   unlocked session too, so the next unlock needs the password.
/// - `close()` happens when the app leaves the foreground. It shuts the engine
///   down (the vault leaves memory) but keeps the session, so returning only
///   takes Face ID -- the same as the app being killed and relaunched.
@MainActor
@Observable
final class VaultModel {
    enum State: Equatable {
        case starting
        case noVault
        case locked
        case unlocked
        case failed(String)
    }

    private(set) var state = State.starting
    private(set) var entries: [Entry] = []
    /// Whether to keep the unlocked session for Face ID, a choice the user
    /// makes. Kept in the app group so the extension's message can mention it.
    private(set) var biometricUnlock: Bool

    /// This vault was created to receive another device's: until pairing
    /// finishes it is empty, and the app shows the join screen instead of the
    /// codes. Persisted, so a relaunch mid-join returns to it.
    private(set) var isJoining: Bool
    /// The responder's half of pairing has been sent; waiting for the vault.
    private(set) var joinInProgress = false
    private(set) var syncStatus: EngineStatus?
    private(set) var syncDevices: [SyncDevice] = []
    /// How the last pairing this device started ended; nil while it runs.
    private(set) var addDeviceResult: AddDeviceResult?

    private var engine: FavaEngine?
    private var eventTask: Task<Void, Never>?
    private let defaults = UserDefaults(suiteName: SharedStorage.appGroup)

    init() {
        biometricUnlock = defaults?.bool(forKey: "biometricUnlock") ?? false
        isJoining = defaults?.bool(forKey: "joiningVault") ?? false
    }

    // MARK: - Lifecycle

    /// Starts the engine if needed and works out whether there is a vault.
    func start() async {
        do {
            _ = try await runningEngine()
            if state == .unlocked { return }
            state = try SharedStorage.readVault() == nil ? .noVault : .locked
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func passwordStrength(_ password: String) async throws -> PasswordStrength {
        try await runningEngine().passwordStrength(password)
    }

    /// - Parameter joining: The vault is a placeholder for another device's,
    ///   which pairing will replace.
    func create(password: String, joining: Bool = false) async throws {
        let engine = try await runningEngine()
        try await engine.createVault(password: password)
        setJoining(joining)
        try await didUnlock()
    }

    func unlock(password: String) async throws {
        let engine = try await runningEngine()
        guard let locked = try SharedStorage.readVault() else { state = .noVault; return }
        try await engine.unlock(lockedRepresentation: locked, password: password)
        try await didUnlock()
    }

    /// Unlocks with the stored session, behind Face ID. Returns false when
    /// there is nothing to unlock with and the password is needed.
    func unlockWithBiometrics() async -> Bool {
        guard biometricUnlock else { return false }
        do {
            guard let session = try await SharedStorage.sessions.load(reason: "Unlock your codes"),
                  let locked = try SharedStorage.readVault()
            else { return false }
            do {
                let engine = try await runningEngine()
                try await engine.unlock(lockedRepresentation: locked, session: session)
            } catch {
                // The contract: a session that failed once is never tried again.
                try? SharedStorage.sessions.delete()
                return false
            }
            try await didUnlock()
            return true
        } catch {
            return false
        }
    }

    func lock() async {
        try? await engine?.lock()
        try? SharedStorage.sessions.delete()
        clearUnlockedState()
        state = .locked
    }

    func close() {
        guard let engine else { return }
        eventTask?.cancel()
        engine.shutdown()
        self.engine = nil
        clearUnlockedState()
        if state == .unlocked { state = .locked }
    }

    func setBiometricUnlock(_ enabled: Bool) async throws {
        if enabled, let engine, state == .unlocked {
            try SharedStorage.sessions.save(try await engine.exportUnlockedSession())
        } else {
            try SharedStorage.sessions.delete()
        }
        biometricUnlock = enabled
        defaults?.set(enabled, forKey: "biometricUnlock")
    }

    // MARK: - Entries

    func refresh() async {
        guard let engine, state == .unlocked, let entries = try? await engine.entries() else { return }
        self.entries = entries
        await CredentialIdentities.update(for: entries)
    }

    func importURI(_ uri: String) async throws {
        guard let engine else { return }
        _ = try await engine.importURI(uri.trimmingCharacters(in: .whitespacesAndNewlines))
        await refresh()
    }

    func delete(_ entry: Entry) async throws {
        guard let engine else { return }
        try await engine.deleteEntry(entry.id)
        await refresh()
    }

    // MARK: - Sync

    /// Resolves once the server accepted the secret; its error says what is
    /// wrong otherwise.
    func setSyncServer(url: String, secret: String) async throws {
        guard let engine else { return }
        var url = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if !url.contains("://") { url = "wss://" + url }
        try await engine.setSyncServer(url: url, secret: secret.trimmingCharacters(in: .whitespacesAndNewlines))
        await refreshSync()
    }

    /// Joins the vault of the device showing `code`. Returns once this half of
    /// the exchange is sent; `isJoining` turns false when the vault arrives.
    func join(code: String, deviceName: String) async throws {
        guard let engine else { return }
        let name = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { try await engine.setDeviceFriendlyName(name) }
        try await engine.respondToPairing(code.trimmingCharacters(in: .whitespacesAndNewlines))
        joinInProgress = true
    }

    func cancelJoin() async {
        try? await engine?.cancelPairing()
        joinInProgress = false
    }

    /// Deletes this device's vault, its codes and its saved session, and
    /// returns to the first-run screen. Other devices keep their copies, but
    /// codes that exist only here are gone.
    func reset() async {
        try? await engine?.lock()
        try? SharedStorage.sessions.delete()
        try? SharedStorage.deleteVault()
        await CredentialIdentities.removeAll()
        setJoining(false)
        clearUnlockedState()
        state = .noVault
    }

    /// Starts pairing as the device that has the vault; the other device
    /// enters or scans the code. `addDeviceResult` says how it ended.
    func addDevice() async throws -> PairingCode {
        guard let engine else { throw VaultModelError.locked }
        addDeviceResult = nil
        return try await engine.initiatePairing()
    }

    func cancelAddDevice() async {
        guard addDeviceResult == nil else { return }
        try? await engine?.cancelPairing()
    }

    func removeDevice(_ device: SyncDevice) async throws {
        guard let engine else { return }
        try await engine.removeSyncDevice(device.deviceId)
        await refreshSync()
    }

    /// Records that the user has seen the devices a peer added.
    func acknowledgeDevices() async {
        guard let engine else { return }
        for device in syncDevices where !device.acknowledged {
            try? await engine.acknowledgeSyncDevice(device.deviceId)
        }
        await refreshSync()
    }

    func refreshSync() async {
        guard let engine, state == .unlocked else { return }
        syncStatus = try? await engine.status()
        syncDevices = syncStatus?.syncConfigured == true ? (try? await engine.syncDevices()) ?? [] : []
    }

    // MARK: - Private

    private func runningEngine() async throws -> FavaEngine {
        if let engine { return engine }
        let engine = try await FavaEngine.start(configuration: SharedStorage.engineConfiguration, onSave: SharedStorage.writeVault)
        self.engine = engine
        eventTask = Task { [weak self] in
            for await event in engine.events {
                await self?.handle(event)
            }
        }
        return engine
    }

    private func didUnlock() async throws {
        state = .unlocked
        if biometricUnlock, let engine {
            // Replaces a session that may have been invalidated since.
            try? SharedStorage.sessions.save(try await engine.exportUnlockedSession())
        }
        await refresh()
        await refreshSync()
    }

    private func setJoining(_ joining: Bool) {
        isJoining = joining
        defaults?.set(joining, forKey: "joiningVault")
    }

    private func clearUnlockedState() {
        entries = []
        syncStatus = nil
        syncDevices = []
        joinInProgress = false
        addDeviceResult = nil
    }

    private func handle(_ event: EngineEvent) async {
        switch event.kind {
        case .changed:
            await refresh()
            await refreshSync()
        case .passwordChanged:
            if biometricUnlock, let engine {
                try? SharedStorage.sessions.save(try await engine.exportUnlockedSession())
            }
        case .connectToExistingVaultFinished:
            // Also fired when the join is cancelled. Only a vault that came
            // from another device lists it, so that tells the two apart.
            joinInProgress = false
            await refreshSync()
            if isJoining, !syncDevices.isEmpty {
                setJoining(false)
                await refresh()
            }
        case .addDeviceFlowFinished:
            addDeviceResult = (try? JSONDecoder().decode(AddDeviceResult.self, from: Data(event.detailJSON.utf8)))
                ?? AddDeviceResult(status: "failed", reason: nil)
            await refreshSync()
        case .connectionToSyncServerStatusChanged, .syncDeviceAdded:
            await refreshSync()
        default:
            break
        }
    }
}

/// favalib's AddDeviceFlowResult.
struct AddDeviceResult: Decodable, Equatable {
    /// 'completed', 'cancelled' or 'failed'.
    var status: String
    var reason: String?

    var completed: Bool { status == "completed" }
}

enum VaultModelError: LocalizedError {
    case locked

    var errorDescription: String? {
        switch self {
        case .locked: "The vault is locked."
        }
    }
}
