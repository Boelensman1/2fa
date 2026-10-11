/**
 * The native half of the engine: what the embedding app installs as
 * `globalThis.__favaHost` before it evaluates the bundle.
 *
 * A bare JSContext has the ECMAScript built-ins and nothing else -- no timers,
 * no randomness, no sockets, no WebAssembly. Everything favalib needs beyond
 * the language is either polyfilled in JS (see `polyfills/`) or comes from
 * here, and this is kept to what JS genuinely cannot do: a CSPRNG, a fast
 * argon2id, a socket, a clock to schedule against, and the two ways out (saving
 * the vault, reporting events).
 *
 * Binary values cross as base64 strings. A Swift block returning `[UInt8]`
 * reaches JS as a plain Array, and building a real Uint8Array from Swift needs
 * the C API; a string is the one type both sides convert for free, and every
 * payload here is small.
 *
 * Every function is called on the JS thread and must return synchronously.
 * That includes argon2id: openpgp calls it synchronously, so it blocks the JS
 * thread for the length of the derivation, which is why the JSContext must not
 * live on the main thread.
 *
 * The Swift implementation is `swift/Sources/FavaEngine/FavaHost.swift`. Keep
 * the two in step.
 */
export interface FavaHost {
  /**
   * Cryptographically secure random bytes (`SecRandomCopyBytes`).
   * @param count - How many bytes.
   * @returns The bytes, base64.
   */
  randomBytes(count: number): string

  /**
   * Argon2id, version 0x13, as the reference implementation computes it. Must
   * support parallelism above 1 (fava vaults use 4), which rules out libsodium.
   * @param password - Base64 of the password bytes.
   * @param salt - Base64 of the salt bytes.
   * @param iterations - Passes (t).
   * @param memoryKiB - Memory cost (m), in KiB.
   * @param parallelism - Lanes (p).
   * @param hashLength - Output length in bytes.
   * @returns The derived bytes, base64.
   */
  argon2id(
    password: string,
    salt: string,
    iterations: number,
    memoryKiB: number,
    parallelism: number,
    hashLength: number,
  ): string

  /**
   * Calls `callback` once after `ms` milliseconds, on the JS thread.
   * @param callback - What to call.
   * @param ms - Delay in milliseconds.
   * @returns A timer id, unique for the life of the context.
   */
  setTimeout(callback: () => void, ms: number): number

  /**
   * Cancels a pending timer. Unknown or fired ids are ignored.
   * @param id - The id setTimeout returned.
   */
  clearTimeout(id: number): void

  /**
   * Writes a line to the platform log.
   * @param level - Severity.
   * @param message - The line.
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void

  /**
   * Opens a WebSocket (`URLSessionWebSocketTask`). Text frames only; fava's
   * sync protocol is JSON.
   * @param url - A ws:// or wss:// url.
   * @param onEvent - Called on the JS thread with `('open')`,
   * `('message', text)`, `('close', code, reason)` or `('error', description)`.
   * After `close` no further events arrive for this id.
   * @returns A socket id.
   */
  wsConnect(
    url: string,
    onEvent: (
      type: 'open' | 'message' | 'close' | 'error',
      a?: string | number,
      b?: string,
    ) => void,
  ): number

  /**
   * Sends a text frame.
   * @param id - The socket id.
   * @param text - The frame.
   */
  wsSend(id: number, text: string): void

  /**
   * Starts closing a socket. The `close` event follows.
   * @param id - The socket id.
   * @param code - The close code.
   * @param reason - The close reason.
   */
  wsClose(id: number, code: number, reason: string): void

  /**
   * Persists the vault. The string is favalib's LockedRepresentation:
   * encrypted, MAC'd, safe to write to a file. Write it atomically.
   * @param lockedRepresentation - The vault to store.
   */
  save(lockedRepresentation: string): void

  /**
   * Reports a FavaLibEvent.
   * @param type - The event name (FavaLibEvent's string value).
   * @param detailJson - The event's detail, JSON.
   */
  emit(type: string, detailJson: string): void
}

/**
 * Returns the host the app installed.
 * @returns The host.
 * @throws {TypeError} If the app evaluated the bundle without installing one.
 */
export const getHost = (): FavaHost => {
  const host = (globalThis as { __favaHost?: FavaHost }).__favaHost
  if (!host) {
    throw new TypeError(
      'globalThis.__favaHost is not set; install it before evaluating the engine bundle',
    )
  }
  return host
}
