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

    private var engine: FavaEngine?
    private var eventTask: Task<Void, Never>?
    private let defaults = UserDefaults(suiteName: SharedStorage.appGroup)

    init() {
        biometricUnlock = defaults?.bool(forKey: "biometricUnlock") ?? false
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

    func create(password: String) async throws {
        let engine = try await runningEngine()
        try await engine.createVault(password: password)
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
        entries = []
        state = .locked
    }

    func close() {
        guard let engine else { return }
        eventTask?.cancel()
        engine.shutdown()
        self.engine = nil
        entries = []
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
        guard let engine, state == .unlocked else { return }
        entries = (try? await engine.entries()) ?? entries
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
    }

    private func handle(_ event: EngineEvent) async {
        switch event.kind {
        case .changed:
            await refresh()
        case .passwordChanged:
            if biometricUnlock, let engine {
                try? SharedStorage.sessions.save(try await engine.exportUnlockedSession())
            }
        default:
            break
        }
    }
}
