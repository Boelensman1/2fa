# FavaEngine (Swift)

favalib for iOS 16+ / macOS 13+: the engine bundle in a JavaScriptCore context,
with the native pieces it needs. See `../AGENTS.md` for how it works.

## Build and test

```sh
make -C packages/engine-jsc build   # puts fava-engine.js into Sources/FavaEngine/Resources
cd packages/engine-jsc/swift && swift test
```

The resource is generated and gitignored, so the package does not build until
`make build` has run once.

## Using it in an app

Add the package (File > Add Package Dependencies > Add Local, pick this
`swift` directory) and link `FavaEngine` into the app and the AutoFill
extension.

```swift
import FavaEngine

let vaultURL = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: "group.example.fava")!
    .appendingPathComponent("vault.json")

let engine = try await FavaEngine.start(
    configuration: .init(deviceType: "favaios"),
    onSave: { locked in try? Data(locked.utf8).write(to: vaultURL, options: .atomic) }
)
let sessions = UnlockedSessionStore(accessGroup: "TEAMID.example.fava.shared")

// First run
try await engine.createVault(password: password)

// Later: Face ID first, the password if that fails
let locked = try String(contentsOf: vaultURL, encoding: .utf8)
if let session = try? await sessions.load(reason: "Unlock your 2FA codes"),
   (try? await engine.unlock(lockedRepresentation: locked, session: session)) != nil {
    // unlocked, no argon2
} else {
    try? sessions.delete()
    try await engine.unlock(lockedRepresentation: locked, password: password)
    try sessions.save(try await engine.exportUnlockedSession())  // if the user opts in
}

let codes = try await engine.entries()   // each with .token?.otp
```

Lifecycle rules (favalib's contract for the session, see `UnlockedSessionStore`):

- **Lock**: `try await engine.lock()` **and** `try sessions.delete()`.
- **`passwordChanged` event**: `try sessions.save(try await engine.exportUnlockedSession())`.
- **Any failure of `unlock(session:)`**: delete the session, ask for the password.

## AutoFill extension

A credential provider extension with `ProvidesOneTimeCodes = YES` under
`NSExtension > NSExtensionAttributes > ASCredentialProviderExtensionCapabilities`
(iOS 18). It shares the app group (for the vault file) and the Keychain access
group (for the session). In `prepareOneTimeCodeCredentialList(for:)`: start an
engine, `unlock(lockedRepresentation:session:connectToSyncServer: false)`,
`entries(forURL:)` for the service identifier, and complete the request with
the chosen entry's `token?.otp`. No password, no argon2, no network.

## Notes

- Every engine call runs on the engine's own thread, in order. Keep one engine
  per process.
- `onSave` is called on that thread. Write the file there; don't block on the
  main thread from it.
- Errors are `FavaEngineError`. Branch on `kind` (`authentication`, `usage`, ...),
  not on `message`.
- `CArgon2` is the Argon2 reference implementation, vendored unmodified (see its
  README). libsodium would not do: its argon2id cannot use 4 lanes.
