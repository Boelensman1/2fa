/**
 * The engine's API: what the native app calls, and the only thing it calls.
 *
 * There is a single entry point, `favaEngine.call(method, argsJson)`, which
 * resolves to the result as JSON or rejects with `{ kind, message }` (also as
 * JSON, in the rejection's message). One untyped door is easier to bridge than
 * many typed ones: the Swift side has one generic `call` that encodes
 * arguments and decodes results with Codable, and adding a method here needs
 * no new bridging code there.
 *
 * The engine holds at most one unlocked vault. Everything it writes leaves
 * through the host: the vault through `save`, events through `emit`.
 *
 * Calls start in the order they arrive, but an async one does not hold up the
 * next: two calls can be in flight at once. What must not interleave is the
 * vault's lifecycle, so `createVault`, the unlocks and `lock` are ordered by
 * when they START: an unlock that finishes after a later lock or unlock began
 * is discarded and rejects with kind `usage`. `lock` never waits for anything.
 *
 * Mirror any change here in `swift/Sources/FavaEngine/FavaEngine.swift`.
 */
import {
  AuthenticationError,
  CryptoError,
  EntryNotFoundError,
  FavaLibError,
  FavaLibEvent,
  InitializationError,
  StorageVersionError,
  SyncDeviceKeyConflictError,
  SyncDeviceRemovedError,
  SyncPairingVersionError,
  TokenGenerationError,
  UnsupportedStorageVersionError,
  getFavaLibVaultCreationUtils,
  type DeviceFriendlyName,
  type DeviceId,
  type DeviceType,
  type Entry,
  type EntryId,
  type FavaLib,
  type LockedRepresentationString,
  type NewEntry,
  type Password,
  type ServerSecret,
  type UnlockedSessionString,
} from 'favalib'
import { browserProviders } from 'favalib/platformProviders/browser'

import { getHost } from './host.mjs'
import {
  base64ToBytes,
  bytesToBase64,
  Utf8Decoder,
  Utf8Encoder,
} from './polyfills/encoding.mjs'

/** What `configure` takes. */
export interface EngineConfig {
  /** favalib's device type, e.g. 'favaios'. Shown to paired devices. */
  deviceType: string
  /** Extra words zxcvbn should treat as guessable in a vault password. */
  passwordExtraDict?: string[]
}

/** Engine errors as the host sees them. `kind` is stable; `message` is not. */
export interface EngineError {
  kind: string
  message: string
}

/**
 * favalib's error classes, most specific first. Every one of them reports
 * `name === 'FavaLibError'`, so the host cannot tell them apart without this.
 */
const ERROR_KINDS: [string, abstract new (...args: never[]) => Error][] = [
  ['unsupportedStorageVersion', UnsupportedStorageVersionError],
  ['storageVersion', StorageVersionError],
  ['initialization', InitializationError],
  ['authentication', AuthenticationError],
  ['crypto', CryptoError],
  ['entryNotFound', EntryNotFoundError],
  ['tokenGeneration', TokenGenerationError],
  ['syncPairingVersion', SyncPairingVersionError],
  ['syncDeviceKeyConflict', SyncDeviceKeyConflictError],
  ['syncDeviceRemoved', SyncDeviceRemovedError],
  ['favalib', FavaLibError],
]

/**
 * Maps a thrown value to what the host receives.
 * @param error - Whatever was thrown.
 * @returns The kind and message.
 */
export const toEngineError = (error: unknown): EngineError => {
  if (error instanceof EngineUsageError) {
    return { kind: 'usage', message: error.message }
  }
  for (const [kind, ErrorClass] of ERROR_KINDS) {
    if (error instanceof ErrorClass) {
      return { kind, message: error.message }
    }
  }
  // eslint-disable-next-line no-restricted-globals
  if (error instanceof Error) {
    return { kind: 'internal', message: `${error.name}: ${error.message}` }
  }
  return { kind: 'internal', message: String(error) }
}

/** A call the engine cannot serve in its current state. */
// eslint-disable-next-line no-restricted-globals
class EngineUsageError extends Error {
  /**
   * @param message - What was wrong.
   */
  constructor(message: string) {
    super(message)
    this.name = 'EngineUsageError'
  }
}

const encoder = new Utf8Encoder()
const decoder = new Utf8Decoder()

/**
 * A pairing code as favalib's text form (url-safe base64 of the JSON) from
 * either form: QR codes carry the raw JSON, so a scanned code arrives as that.
 * @param payload - Text form or raw JSON.
 * @returns The text form.
 */
export const pairingTextFromPayload = (payload: string): string => {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{')) {
    return trimmed
  }
  return bytesToBase64(encoder.encode(trimmed))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * The raw JSON a pairing QR code carries, from favalib's text form, so the
 * host can draw it natively and other fava clients can scan it.
 * @param text - The text form.
 * @returns The JSON.
 */
export const pairingQrPayloadFromText = (text: string): string => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return decoder.decode(
    base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4)),
  )
}

/**
 * The engine. One instance lives at `globalThis.favaEngine`.
 */
export class FavaEngine {
  #config: Required<EngineConfig> | null = null
  #favaLib: FavaLib | null = null
  /** Bumped by every lifecycle call; see the class comment. */
  #generation = 0

  /**
   * Runs a method by name. The native side's only entry point.
   * @param method - A method name from `methods`.
   * @param argsJson - The arguments, as a JSON array.
   * @returns The result as JSON (`null` for none).
   */
  async call(method: string, argsJson = '[]'): Promise<string> {
    try {
      const handler = Object.prototype.hasOwnProperty.call(this.methods, method)
        ? this.methods[method as keyof typeof this.methods]
        : undefined
      if (!handler) {
        throw new EngineUsageError(`Unknown method: ${method}`)
      }
      const args = JSON.parse(argsJson) as unknown
      if (!Array.isArray(args)) {
        throw new EngineUsageError('Arguments must be a JSON array')
      }
      const result = await (handler as (...a: unknown[]) => unknown)(
        ...(args as unknown[]),
      )
      return JSON.stringify(result ?? null)
    } catch (error) {
      // Rejecting with a plain Error whose message is the JSON keeps the
      // bridge simple: JSContext hands Swift the rejection reason as a
      // JSValue, and `message` is a string property on every engine.
      // eslint-disable-next-line no-restricted-globals
      throw new Error(JSON.stringify(toEngineError(error)))
    }
  }

  #lib(): FavaLib {
    if (!this.#favaLib) {
      throw new EngineUsageError('No vault is unlocked')
    }
    return this.#favaLib
  }

  #sync() {
    const sync = this.#lib().sync
    if (!sync) {
      throw new EngineUsageError('No sync server is configured')
    }
    return sync
  }

  #utils() {
    if (!this.#config) {
      throw new EngineUsageError('configure() has not been called')
    }
    const extra = this.#config.passwordExtraDict
    return getFavaLibVaultCreationUtils(
      browserProviders,
      this.#config.deviceType as DeviceType,
      extra.length ? (extra as [string, ...string[]]) : ['phone'],
    )
  }

  #adopt(favaLib: FavaLib) {
    this.#drop()
    favaLib.storage.setSaveFunction((locked) => {
      if (this.#favaLib !== favaLib) {
        throw new EngineUsageError('The vault is no longer unlocked')
      }
      getHost().save(locked)
    })
    for (const type of Object.values(FavaLibEvent)) {
      favaLib.addEventListener(type, (event) => {
        // Only forward events from the vault the engine currently holds; a
        // locked one can still have a socket winding down.
        if (this.#favaLib !== favaLib) return
        getHost().emit(type, JSON.stringify(event.detail ?? {}))
      })
    }
    this.#favaLib = favaLib
  }

  /**
   * Loads a vault and adopts it, unless a later lifecycle call started while
   * it was loading -- then the loaded vault is closed and never seen.
   * @param load - Produces the vault.
   * @returns The adopted vault.
   */
  async #replace(load: () => Promise<FavaLib>): Promise<FavaLib> {
    const generation = ++this.#generation
    const favaLib = await load()
    if (generation !== this.#generation) {
      favaLib.closeServerConnection()
      throw new EngineUsageError('A later lock or unlock superseded this one')
    }
    this.#adopt(favaLib)
    return favaLib
  }

  #drop() {
    const favaLib = this.#favaLib
    this.#favaLib = null
    favaLib?.closeServerConnection()
  }

  /**
   * Everything `call` can reach. Arguments and results are JSON values.
   */
  readonly methods = {
    /**
     * Must be called once, before anything that touches a vault.
     * @param config - The engine configuration.
     */
    configure: (config: EngineConfig) => {
      if (!config?.deviceType) {
        throw new EngineUsageError('deviceType is required')
      }
      this.#config = {
        deviceType: config.deviceType,
        passwordExtraDict: config.passwordExtraDict ?? [],
      }
    },

    /** @returns Whether a vault is unlocked, and its sync state. */
    status: () => ({
      unlocked: this.#favaLib !== null,
      syncConfigured: !!this.#favaLib?.sync,
      syncConnected: !!this.#favaLib?.sync?.webSocketConnected,
    }),

    /**
     * zxcvbn's verdict on a candidate vault password. favalib refuses to
     * create a vault (or change to a password) scoring below 3.
     * @param password - The candidate password.
     * @returns favalib's PasswordStrength: score (0-4), guessesLog10 and
     * feedback.
     */
    passwordStrength: (password: string) =>
      this.#utils().getPasswordStrength(password as Password),

    /**
     * Creates a vault and keeps it unlocked. The vault reaches the host
     * through `save`.
     * @param password - The vault password.
     */
    createVault: async (password: string) => {
      const utils = this.#utils()
      const favaLib = await this.#replace(
        async () =>
          (await utils.createNewFavaLibVault(password as Password)).favaLib,
      )
      await favaLib.storage.forceSave()
    },

    /**
     * Unlocks with the password: one argon2id pass.
     * @param lockedRepresentation - The saved vault.
     * @param password - The vault password.
     * @param connectToSyncServer - Whether to connect to sync while loading.
     */
    unlockWithPassword: async (
      lockedRepresentation: string,
      password: string,
      connectToSyncServer = true,
    ) => {
      const utils = this.#utils()
      await this.#replace(() =>
        utils.loadFavaLibFromLockedRepesentation(
          lockedRepresentation as LockedRepresentationString,
          password as Password,
          { connectToSyncServer },
        ),
      )
    },

    /**
     * Unlocks from an exported session: no key derivation. Any failure means
     * the session should be discarded and the password asked for.
     * @param lockedRepresentation - The saved vault.
     * @param session - What exportUnlockedSession returned.
     * @param connectToSyncServer - Whether to connect to sync while loading.
     */
    unlockWithSession: async (
      lockedRepresentation: string,
      session: string,
      connectToSyncServer = true,
    ) => {
      const utils = this.#utils()
      await this.#replace(() =>
        utils.loadFavaLibFromUnlockedSession(
          lockedRepresentation as LockedRepresentationString,
          session as UnlockedSessionString,
          { connectToSyncServer },
        ),
      )
    },

    /**
     * PLAINTEXT KEY MATERIAL. Only for the biometric-gated Keychain item that
     * favalib's PersistentStorageManager.exportUnlockedSession allows.
     * @returns The session string.
     */
    exportUnlockedSession: () => this.#lib().storage.exportUnlockedSession(),

    /**
     * Drops the unlocked vault and closes its sync connection, at once: an
     * unlock still in flight is discarded when it finishes. The host must
     * also delete any stored session.
     */
    lock: () => {
      this.#generation++
      this.#drop()
    },

    /**
     * @param oldPassword - The current password.
     * @param newPassword - The new password.
     * @returns Resolves when done.
     */
    changePassword: (oldPassword: string, newPassword: string) =>
      this.#lib().storage.changePassword(
        oldPassword as Password,
        newPassword as Password,
      ),

    /**
     * @param query - Optional search over name and issuer.
     * @returns Every (matching) entry's metadata with its current code.
     */
    listEntries: (query?: string) =>
      query
        ? this.#lib().vault.searchEntriesMetas(query, true)
        : this.#lib().vault.listEntriesMetas(true),

    /**
     * What AutoFill offers for a page or app.
     * @param url - The url being filled.
     * @returns The entries whose matchers accept it, with current codes.
     */
    entriesForUrl: (url: string) =>
      this.#lib().vault.findEntryMetasForUrl(url, true),

    /**
     * @param entryId - The entry.
     * @param timestamp - Milliseconds since the epoch; defaults to now.
     * @returns The code and its validity window.
     */
    token: (entryId: string, timestamp?: number) =>
      this.#lib().vault.generateTokenForEntry(entryId as EntryId, timestamp),

    /**
     * @param entry - favalib's NewEntry.
     * @returns The new entry's id.
     */
    addEntry: (entry: NewEntry) => this.#lib().vault.addEntry(entry),

    /**
     * @param entryId - The entry.
     * @param updates - The fields to change.
     * @returns The updated metadata.
     */
    updateEntry: (entryId: string, updates: Partial<Omit<Entry, 'id'>>) =>
      this.#lib().vault.updateEntry(entryId as EntryId, updates),

    /**
     * @param entryId - The entry.
     * @returns Resolves when done.
     */
    deleteEntry: (entryId: string) =>
      this.#lib().vault.deleteEntry(entryId as EntryId),

    /**
     * Adds an entry from an otpauth:// uri, e.g. a QR code the host decoded.
     * @param uri - The uri.
     * @returns The new entry's id.
     */
    importUri: (uri: string) => this.#lib().exportImport.importFromUri(uri),

    /**
     * Imports a text export, encrypted (with password) or not.
     * @param text - The file contents.
     * @param password - The export password, for an encrypted export.
     * @returns One result per line; `error` is a message or null.
     */
    importText: async (text: string, password?: string) =>
      (await this.#lib().exportImport.importFromTextFile(text, password)).map(
        (r) => ({
          lineNr: r.lineNr,
          entryId: r.entryId,
          error:
            r.error === null || r.error === undefined
              ? null
              : toEngineError(r.error).message,
        }),
      ),

    /**
     * A text export of every entry.
     * @param password - Encrypts the export (OpenPGP, argon2 S2K). Null for
     * plaintext, which also needs userWasWarned.
     * @param userWasWarned - The user saw a warning about plaintext exports.
     * @returns The export.
     */
    exportText: (password: string | null, userWasWarned = false) =>
      this.#lib().exportImport.exportEntries(
        'text',
        password ?? undefined,
        userWasWarned,
      ),

    /**
     * Sets the sync server; resolves once the server accepted the secret.
     * @param url - wss:// url.
     * @param secret - The server's shared secret.
     * @returns Resolves when done.
     */
    setSyncServer: async (url: string, secret: string) => {
      const favaLib = this.#lib()
      try {
        await favaLib.setSyncServerUrl(url, secret as ServerSecret)
      } catch (error) {
        if (this.#favaLib !== favaLib) {
          throw new EngineUsageError('The vault is no longer unlocked')
        }
        throw error
      }
    },

    /**
     * Starts pairing as the device that already has the vault.
     * @returns The code in both forms: `text` to show or copy, `qrPayload` to
     * draw as a QR code.
     */
    initiatePairing: async () => {
      const { text } = await this.#sync().initiateAddDeviceFlow({
        qr: false,
        text: true,
      })
      return { text, qrPayload: pairingQrPayloadFromText(text) }
    },

    /**
     * Joins another device's vault. Replaces this device's vault on success
     * (watch for the connectToExistingVaultFinished event).
     * @param payload - The text code, or a scanned QR code's contents.
     * @returns Resolves when done.
     */
    respondToPairing: (payload: string) =>
      this.#sync().respondToAddDeviceFlow(
        pairingTextFromPayload(payload),
        'text',
      ),

    /** Abandons a pairing this device started. */
    cancelPairing: () => {
      this.#sync().cancelAddSyncDevice()
    },

    /** @returns The paired devices. */
    syncDevices: () => this.#sync().getSyncDevices(),

    /**
     * Records that the user has been shown a device a peer introduced, which
     * is what clears its `acknowledged: false`. Local only; peers are not told.
     * @param deviceId - The device that was shown.
     * @returns Resolves when saved.
     */
    acknowledgeSyncDevice: (deviceId: string) =>
      this.#sync().acknowledgeSyncDevice(deviceId as DeviceId),

    /**
     * @param deviceId - The device to remove.
     * @returns Resolves when done.
     */
    removeSyncDevice: (deviceId: string) =>
      this.#lib().removeSyncDevice(deviceId as DeviceId),

    /**
     * @param name - How paired devices should label this one.
     * @returns Resolves when done.
     */
    setDeviceFriendlyName: (name: string) =>
      this.#lib().setDeviceFriendlyName(name as DeviceFriendlyName),
  }
}
