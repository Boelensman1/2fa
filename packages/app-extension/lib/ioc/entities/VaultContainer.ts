import { injectable, inject } from 'inversify'
import {
  FavaLibEvent,
  type DeviceFriendlyName,
  type EntryId,
  type EntryMeta,
  type EntryMetaForUrl,
  type FavaLib,
  type LockedRepresentationString,
  type Password,
} from 'favalib'

import IOC_TYPES from '../types'
import Logger from '../../classes/Logger'
import creationUtils from '../../vault/creationUtils'
import type {
  EntryList,
  ListedEntry,
  PasswordStrength,
  VaultStatus,
  VaultSummary,
} from '../../types/VaultState'
import type Db from './Db'

const log = new Logger('background-script/VaultContainer')

/** Where the encrypted vault lives, in `Db`'s `local:meta:` area. */
const VAULT_KEY = 'lockedRepresentation'

/**
 * Where the master password lives while the vault is unlocked.
 *
 * This is the one genuinely uncomfortable line in this file, so: favalib can
 * only build a `FavaLib` from `(lockedRepresentation, password)` -- there is
 * no api to rehydrate one from the keys it has already derived. An mv3 service
 * worker is evicted after ~30s idle, taking the instance with it. So the only
 * way to stay unlocked across an eviction is to keep the password.
 *
 * `Db`'s session area is `browser.storage.session`: memory-backed, never
 * written to disk, wiped when the browser closes, and unreadable from content
 * scripts. Anything that can read it is already a context that could read the
 * unlocked vault directly.
 *
 * The clean fix is an "export/import unlocked session" api in favalib, which
 * would let this hold derived key material with a lifetime of its own instead.
 * Until then this is what survives a worker restart, and `lock()` clears it.
 */
const SESSION_PASSWORD_KEY = 'vaultPassword'

/**
 * Whether the browser keeps the background alive on its own.
 *
 * Only an mv3 background is a service worker the browser terminates when idle.
 * wxt builds firefox as mv2, whose background is a persistent page -- nothing
 * evicts it, so `restoreSession` there has never once had work to do. Writing
 * the password on every unlock for a reader that never comes is exposure
 * bought for nothing, so don't.
 *
 * Keyed on the manifest version rather than the browser, because that is the
 * thing that actually decides it: a firefox *mv3* build gets an event page,
 * which is terminated and does need this. `!== 2` rather than `=== 3` so an
 * unknown value (vitest, where wxt defines no globals) falls to the working
 * side -- getting this wrong the other way would silently stop the vault
 * surviving eviction, which no test would catch.
 *
 * If the mv2 background ever becomes non-persistent, this has to change with it.
 */
const backgroundCanBeEvicted = () =>
  Number(import.meta.env.MANIFEST_VERSION) !== 2

/** favalib reports a bad password as a CryptoError, which it does not export. */
const isWrongPassword = (error: unknown): boolean =>
  error instanceof Error && /invalid password/i.test(error.message)

/**
 * Turns a thrown favalib error into a line the popup can show the user.
 *
 * Lives here rather than in the popup because the reasons are favalib's, and
 * because a rejection does not survive `sendMessage` -- the background has to
 * turn it into data before it crosses.
 */
export const describeVaultError = (error: unknown): string => {
  if (isWrongPassword(error)) return 'Wrong password'
  return error instanceof Error ? error.message : String(error)
}

const toListedEntry = (entry: EntryMeta | EntryMetaForUrl): ListedEntry => ({
  id: entry.id,
  issuer: entry.issuer,
  name: entry.name,
  url: entry.url,
  matchers: entry.matchers,
  matchedBy: 'matchedBy' in entry ? entry.matchedBy : null,
})

/**
 * Owns the one `FavaLib` instance, in the background service worker.
 *
 * It lives here rather than in the popup because the popup is torn down every
 * time it closes, and because the sync websocket has to outlive it. The popup
 * holds no keys and no vault state; it asks this over the message protocol.
 */
@injectable()
class VaultContainer {
  private db: Db
  private favaLib: FavaLib | null = null
  private pairing = false

  public constructor(@inject(IOC_TYPES.DB) db: Db) {
    this.db = db
  }

  private async readBlob(): Promise<LockedRepresentationString | undefined> {
    const blob = await this.db.getMetaValue(VAULT_KEY)
    return blob as LockedRepresentationString | undefined
  }

  async getStatus(): Promise<VaultStatus> {
    if (this.favaLib) return this.pairing ? 'pairing' : 'unlocked'
    return (await this.readBlob()) ? 'locked' : 'no-vault'
  }

  async getSummary(): Promise<VaultSummary> {
    const status = await this.getStatus()
    const favaLib = this.favaLib

    if (!favaLib) {
      return {
        status,
        deviceId: null,
        deviceFriendlyName: null,
        syncConnected: false,
        entryCount: 0,
      }
    }

    return {
      status,
      deviceId: favaLib.meta.deviceId,
      deviceFriendlyName: favaLib.meta.deviceFriendlyName,
      syncConnected: favaLib.sync?.webSocketConnected ?? false,
      // While pairing there is a vault object, but it is the empty one this
      // device just made -- reporting its size would show "0 items" next to a
      // spinner that is about to produce the real count.
      entryCount: this.pairing ? 0 : favaLib.vault.size,
    }
  }

  /**
   * Wires a fresh instance up and remembers the password for the session.
   *
   * The save function must be installed on every instance: the one baked into
   * `creationUtils` throws, because it has no instance to refresh afterwards.
   */
  private async attach(favaLib: FavaLib, password: Password) {
    favaLib.storage.setSaveFunction(async (lockedRepresentation) => {
      await this.db.upsertMetaKV(VAULT_KEY, lockedRepresentation)
    })

    favaLib.addEventListener(FavaLibEvent.Log, (event) => {
      if (event.detail.severity === 'warning') {
        log.warn(event.detail.message)
      } else {
        log.info(event.detail.message)
      }
    })

    this.favaLib = favaLib

    if (backgroundCanBeEvicted()) {
      await this.db.setSessionValue(SESSION_PASSWORD_KEY, password)
    }
  }

  /**
   * Creates a brand new vault.
   *
   * In `connect` mode the vault is deliberately *not* saved: this device's
   * empty vault is a placeholder until the device it pairs with sends the real
   * one, and writing it first would leave a vault behind that unlocks to
   * nothing if pairing is abandoned. `../app-browser`'s CreateVault does the
   * same, for the same reason.
   */
  async createVault(password: Password, mode: 'create' | 'connect') {
    const { favaLib } = await creationUtils.createNewFavaLibVault(password)
    await this.attach(favaLib, password)

    this.pairing = mode === 'connect'
    favaLib.addEventListener(
      FavaLibEvent.ConnectToExistingVaultFinished,
      () => {
        this.pairing = false
      },
    )

    if (mode === 'create') {
      await favaLib.storage.forceSave()
    }

    await favaLib.ready
  }

  /**
   * Joins an existing vault using a connection string from another device.
   *
   * Text only. The qr path would need `getImageDataFromInput`, which wants
   * `Image` and `document` -- neither exists in a service worker.
   */
  async pair(connectionString: string, deviceFriendlyName?: string) {
    const favaLib = this.favaLib
    if (!favaLib) throw new Error('Create a vault before pairing')
    if (!favaLib.sync) throw new Error('No sync server configured')

    const name = deviceFriendlyName?.trim()
    if (name) {
      await favaLib.setDeviceFriendlyName(name as DeviceFriendlyName)
    }

    const finished = new Promise<void>((resolve) => {
      favaLib.addEventListener(
        FavaLibEvent.ConnectToExistingVaultFinished,
        () => resolve(),
      )
    })

    await favaLib.sync.respondToAddDeviceFlow(connectionString, 'text')
    await finished
    this.pairing = false
  }

  async unlock(password: Password) {
    const blob = await this.readBlob()
    if (!blob) throw new Error('There is no vault to unlock')

    const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
      blob,
      password,
    )
    await this.attach(favaLib, password)

    // With a sync server configured, `Ready` only fires once the first batch of
    // remote commands has been applied. Listing before it returns a vault that
    // is a round of sync out of date.
    await favaLib.ready
  }

  /**
   * Rebuilds the instance after the service worker was evicted.
   *
   * Silent by design: no stored password just means the vault is locked, which
   * is a normal state and not an error to report.
   */
  async restoreSession() {
    if (this.favaLib) return
    // Nothing is ever stored where the background cannot be evicted, so there
    // is nothing to look for.
    if (!backgroundCanBeEvicted()) return

    const password = await this.db.getSessionValue(SESSION_PASSWORD_KEY)
    if (!password) return

    try {
      await this.unlock(password as Password)
      log.info('Restored an unlocked vault after a worker restart')
    } catch (error) {
      log.warn(
        `Could not restore the unlocked vault: ${describeVaultError(error)}`,
      )
      await this.lock()
    }
  }

  async lock() {
    this.favaLib?.sync?.closeServerConnection()
    this.favaLib = null
    this.pairing = false
    await this.db.deleteSessionValue(SESSION_PASSWORD_KEY)
  }

  /** Forgets the vault entirely. Unrecoverable without another device. */
  async reset() {
    await this.lock()
    // Not `db.reset()`: that is `storage.clear('local')` and would take the
    // config -- verbose logging and all -- with it.
    await this.db.deleteMetaKV(VAULT_KEY)
  }

  /**
   * The entry list the popup renders.
   *
   * `url` is the active tab's, and drives the "for this site" group.
   * favalib's `findEntryMetasForUrl` already sorts most-specific-match first.
   */
  listEntries(query: string, url: string | null): EntryList {
    const favaLib = this.favaLib
    if (!favaLib || this.pairing) return { forSite: [], all: [] }

    const trimmed = query.trim()
    const all = trimmed
      ? favaLib.vault.searchEntriesMetas(trimmed)
      : favaLib.vault.listEntriesMetas()

    // Searching is a deliberate narrowing, so the site group would be a second
    // list contradicting it. Bitwarden hides its suggestions while searching
    // for the same reason.
    const forSite =
      url && !trimmed ? favaLib.vault.findEntryMetasForUrl(url) : []

    return {
      forSite: forSite.map(toListedEntry),
      all: all.map(toListedEntry),
    }
  }

  /** Whether there are keys in memory to generate a token with. */
  get isUnlocked(): boolean {
    return this.favaLib !== null && !this.pairing
  }

  /**
   * The entries that claim one frame's url, most specific first.
   *
   * Separate from {@link VaultContainer.listEntries} because the autofill menu
   * asks a different question: not "what is in the vault, filtered" but "what
   * belongs to exactly this url". The url is the *frame's*, browser-supplied,
   * never the tab's -- a field on an embedded third-party origin must not be
   * offered the surrounding page's entries.
   * @param url - The frame's url.
   * @returns The matching entries, safe to send to the menu.
   */
  entriesForUrl(url: string): ListedEntry[] {
    if (!this.isUnlocked) return []
    return (this.favaLib?.vault.findEntryMetasForUrl(url) ?? []).map(
      toListedEntry,
    )
  }

  /**
   * The `inputSelector` overrides that apply to one frame's url.
   *
   * These are the user's escape hatch for pages the heuristic gets wrong, and
   * until now nothing ever supplied them: the content script called
   * `observeOtpFields` with no selectors, so `detectOtpFields` never took the
   * override branch at all. The background is the only side that can know
   * them, because knowing them means reading the vault.
   * @param url - The frame's url.
   * @returns The selectors, deduplicated. Empty when there is nothing to override.
   */
  inputSelectorsForUrl(url: string): string[] {
    if (!this.isUnlocked) return []
    const selectors = (this.favaLib?.vault.findEntryMetasForUrl(url) ?? [])
      .map((entry) => entry.inputSelector)
      .filter((selector): selector is string => Boolean(selector))
    return [...new Set(selectors)]
  }

  /** Feedback for the create screen. favalib rejects a score below 3 outright. */
  async getPasswordStrength(password: Password): Promise<PasswordStrength> {
    const { score, feedback } =
      await creationUtils.getPasswordStrength(password)
    return {
      score,
      warning: feedback.warning ?? '',
      suggestions: feedback.suggestions,
    }
  }

  async generateToken(entryId: EntryId): Promise<string> {
    const favaLib = this.favaLib
    if (!favaLib) throw new Error('The vault is locked')

    const { otp } = await favaLib.vault.generateTokenForEntry(entryId)
    return otp
  }
}

export default VaultContainer
