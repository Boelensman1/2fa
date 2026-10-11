# favaenginejsc

favalib packaged to run inside a bare JavaScriptCore `JSContext`: the engine
behind a native (SwiftUI) iOS app. Two halves, one package:

- **JS** (`src/`): a single classic-script bundle, `build/fava-engine.js`, with
  favalib, its dependencies, the polyfills a JSContext lacks, and a small
  facade (`favaEngine.call`) that is the only thing native code talks to.
- **Swift** (`swift/`): a Swift package, `FavaEngine`, that runs the bundle on
  its own thread and supplies the native half: argon2id, a CSPRNG, timers,
  WebSockets. It also holds `UnlockedSessionStore`, the Keychain home for the
  unlocked session. `make build` copies the bundle into its resources.

`make build`, `make lint` and `make test` cover the JS half here. The Swift half
needs Xcode: `make test-swift` (macOS), or open `swift/Package.swift`.

## Why JSContext, and what it costs

A JSContext runs in-process, loads the bundle in ~0.1 s, and works inside an
AutoFill credential provider extension, which a WKWebView does not fit well.
Its price is that it has ECMAScript and nothing else, and on iOS no JIT, so no
WebAssembly at all.

That decides the split. Only argon2id has to be native: favalib's hash-wasm
and openpgp's argon2 are both WebAssembly, and a pure-JS argon2id at the vault
parameters (64 MiB, t=3, p=4) takes over a minute with the JIT off, against
~0.1 s for the reference C implementation on four threads. Everything else
stays in JS, including AES-GCM, HKDF and HMAC (@noble, pure JS): favalib's
payloads are small enough that interpretation costs nothing noticeable.

## The host contract

`src/host.mts` is the interface; `swift/Sources/FavaEngine/FavaHost.swift`
implements it. Ten functions: `randomBytes`, `argon2id`, `setTimeout`,
`clearTimeout`, `log`, `wsConnect`/`wsSend`/`wsClose`, `save`, `emit`. Binary
crosses as base64 strings. Everything is synchronous and called on the JS
thread -- including argon2id, because openpgp calls its argon2 synchronously,
which is why the context must not live on the main thread. Change one side,
change the other.

## The polyfills, and the traps they cover

`src/polyfills/` installs, only where missing (so the bundle also runs where
the real thing exists): `TextEncoder`/`TextDecoder` (UTF-8, WHATWG
replacement semantics), `atob`/`btoa`, `Event`/`CustomEvent`/`EventTarget`,
timers and `console` over the host, `queueMicrotask`, `crypto`
(`getRandomValues` from the host, `subtle` subset), `WebSocket` over the host,
and `URL`/`URLSearchParams` from core-js. Four of these were found the hard way
and each is load-bearing:

- **`self = globalThis`.** openpgp computes its own `globalThis` from `window`,
  `global` or `self` and silently falls back to `{}`, after which it finds no
  WebCrypto and fails inside `encrypt()`.
- **`navigator`.** openpgp reads `navigator.userAgent` on the AEAD path.
- **`URL` globally, not just a `UrlParserLib`.** favalib's providers make otpauth
  parsing injectable, but its core uses the `URL` and `URLSearchParams` globals
  directly (URL matchers, the sync url check, otpauth queries).
- **subtle copies its inputs at call time.** WebCrypto does, and openpgp relies
  on it: its chunked AEAD rewrites one nonce/AAD buffer for the next chunk while
  the previous encrypt is pending. A shim that read the buffers later produced
  exports only it could decrypt. `tests/polyfills.test.mts` pins this.

The subtle subset is what favalib's browser provider and openpgp's lightweight
build reach: SHA digests, raw import/export, AES-GCM (generate, encrypt,
decrypt), HMAC, HKDF. Anything else rejects with `NotSupportedError`, which is
safe -- openpgp falls back to its bundled implementations -- where a wrong
answer would not be.

## The build (`scripts/build.mts`)

- `hash-wasm` is aliased to `src/shims/hash-wasm.mts` (argon2id on the host).
- `openpgp` resolves to its **lightweight** build, which keeps argon2 in a
  separate `argon2id.min.mjs`; that file is replaced by
  `src/shims/openpgp-argon2.mts`. The default build inlines it.
- `process.env.NODE_ENV` is defined as `production`. favalib's SyncManager reads
  it at load time and a JSContext has no `process`, so without the substitution
  the bundle throws as it loads; and `development` would let the sync url be any
  scheme, not just `ws://`/`wss://`.
- The build fails if the output still instantiates WebAssembly anywhere.

## The facade (`src/engine.mts`)

One entry point, `favaEngine.call(method, argsJson) -> Promise<resultJson>`,
rejecting with `{ kind, message }` as JSON. `kind` maps favalib's error classes
(which all report `name === 'FavaLibError'`) to stable strings; native code
branches on it. The engine holds at most one unlocked vault; saves leave through
the host's `save`, events through `emit`.

Calls are not queued: they start in order, but async ones overlap. The vault's
lifecycle is ordered instead -- `createVault`, the unlocks and `lock` bump a
generation counter, and an unlock that finishes after a later one started is
discarded (kind `usage`). That is deliberate: a FIFO queue would let a
`setSyncServer` waiting on the network hold up `lock`, and a lock must take
effect at once. Pairing codes come back in both forms:
`text` and `qrPayload` (the raw JSON other fava clients put in their QR codes),
and `respondToPairing` accepts either, so QR codes are drawn and scanned natively.

## The unlocked session

favalib allows its `exportUnlockedSession()` blob in exactly two places (see
`PersistentStorageManager.exportUnlockedSession` in packages/lib): process-
lifetime memory, or a hardware-backed, biometric-gated keystore item. On iOS
that is a Keychain item with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`
and `.biometryCurrentSet`, which is what `UnlockedSessionStore` writes. It is
what lets the AutoFill extension produce a code without the password and
without argon2 (~20 ms). The app's side of the contract: delete it on lock,
replace it on `passwordChanged`, delete it whenever `unlock(session:)` fails.

## Tests

- `tests/polyfills.test.mts`: every polyfill against node's native API.
- `tests/engine.test.mts`: the built bundle in a node `vm` context stripped to
  ECMAScript (no WebAssembly, no console), with `tests/harness.mts` standing in
  for the host -- vault lifecycle, session unlock, openpgp exports, and format
  compatibility with favalib's node provider in both directions.
- `tests/jsc.test.mts`: the bundle on real JavaScriptCore with
  `--useJIT=false --useWebAssembly=false`. Needs a `jsc` shell: macOS ships one
  (found automatically), elsewhere `npx jsvu --engines=javascriptcore` or set
  `JSC`. Skipped otherwise.
- `tests/sync.test.mts`: pairing and two-way sync with node favalib through a
  real server. Skipped unless `FAVA_SYNC_TEST_URL` and `FAVA_SYNC_TEST_SECRET`
  are set; in the container, `ws://localhost:8080` and
  `dev-only-sync-secret-not-for-real-use`.
- `swift/Tests`: argon2id against hash-wasm's output at the vault parameters,
  and the whole engine through `FavaEngine` (macOS).
