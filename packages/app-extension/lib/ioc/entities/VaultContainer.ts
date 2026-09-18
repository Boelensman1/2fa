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
  type ServerSecret,
  type UnlockedSessionString,
} from 'favalib'

import IOC_TYPES from '../types'
import Logger from '../../classes/Logger'
import { clearDrafts } from '../../drafts'
import creationUtils from '../../vault/creationUtils'
import type {
  EntryList,
  ListedEntry,
  PasswordStrength,
  VaultStatus,
  VaultSummary,
} from '../../types/VaultState'
import type { SiteOffer } from '../../types/Autofill'
import type Db from './Db'

const log = new Logger('background-script/VaultContainer')

/** Where the encrypted vault lives, in `Db`'s `local:meta:` area. */
const VAULT_KEY = 'lockedRepresentation'

/**
 * Where the unlocked session lives while the vault is unlocked.
 *
 * favalib's `exportUnlockedSession()` blob: the four secrets a password unlock
 * derives, so that a worker restart rehydrates through
 * `loadFavaLibFromUnlockedSession` with no argon2id pass at all. It replaced
 * keeping the master password here, which is what this had to do while favalib
 * could only build a `FavaLib` from `(lockedRepresentation, password)`.
 *
 * It is still plaintext key material, and favalib's jsdoc states the contract
 * it must be held under: memory-backed storage with the lifetime of a process,
 * and nothing else. `Db`'s session area is exactly that --
 * `browser.storage.session`, never written to disk, wiped when the browser
 * closes, unreadable from content scripts. Do not move it to `local:`, do not
 * log it, and keep `lock()` clearing it.
 *
 * What it buys over the password is a smaller blast radius and a faster boot:
 * this opens one key generation of one vault, where the password opens every
 * generation and is very often the user's password somewhere else too.
 * `changePassword` rotates the generation, which is why
 * `FavaLibEvent.PasswordChanged` re-exports it.
 */
const SESSION_KEY = 'unlockedSession'

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
        syncServerUrl: null,
        syncConnected: false,
        entryCount: 0,
      }
    }

    return {
      status,
      deviceId: favaLib.meta.deviceId,
      deviceFriendlyName: favaLib.meta.deviceFriendlyName,
      // Null means no server has been configured, which is a different thing
      // from one that is configured and currently down -- the first is
      // answered by the sync-server form and the second by waiting.
      syncServerUrl: favaLib.sync?.serverUrl ?? null,
      syncConnected: favaLib.sync?.webSocketConnected ?? false,
      // While pairing there is a vault object, but it is the empty one this
      // device just made -- reporting its size would show "0 items" next to a
      // spinner that is about to produce the real count.
      entryCount: this.pairing ? 0 : favaLib.vault.size,
    }
  }

  /**
   * Wires a fresh instance up and remembers the session for the worker's life.
   *
   * The save function must be installed on every instance: the one baked into
   * `creationUtils` throws, because it has no instance to refresh afterwards.
   */
  private async attach(favaLib: FavaLib) {
    favaLib.storage.setSaveFunction(async (lockedRepresentation) => {
      await this.db.upsertMetaKV(VAULT_KEY, lockedRepresentation)
    })

    favaLib.addEventListener(FavaLibEvent.Log, (event) => {
      // Three severities since favalib gained `error`, which is not a louder
      // `warning`: `warning` is the ordinary noise of a sync connection, and
      // `error` is a refusal the user should hear about even though the
      // library carried on -- a vault arriving unrequested, a command that
      // does not verify. Folding it into the default branch logged exactly
      // those at info.
      if (event.detail.severity === 'error') {
        log.error(event.detail.message)
      } else if (event.detail.severity === 'warning') {
        log.warn(event.detail.message)
      } else {
        log.info(event.detail.message)
      }
    })

    // A session blob opens one key GENERATION, and changePassword moves it:
    // favalib refuses the pre-rotation blob against the vault that change
    // wrote, which would surface as the vault mysteriously locking itself at
    // the next eviction. Re-export instead of dropping, so the worker can
    // still come back.
    favaLib.addEventListener(FavaLibEvent.PasswordChanged, () => {
      void this.rememberSession(favaLib)
    })

    this.favaLib = favaLib

    await this.rememberSession(favaLib)
  }

  /**
   * Writes the unlocked session to `Db`'s session area, if anything will read
   * it.
   *
   * Re-exported rather than written once, because the blob is bound to a key
   * generation: the same export opens every save that generation goes on to
   * make, but not one made after a `changePassword`.
   */
  private async rememberSession(favaLib: FavaLib) {
    // Nothing evicts a persistent background page, so there is no reader --
    // writing key material for one is exposure bought for nothing.
    if (!backgroundCanBeEvicted()) return
    await this.db.setSessionValue(
      SESSION_KEY,
      favaLib.storage.exportUnlockedSession(),
    )
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
    await this.attach(favaLib)

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
    if (!favaLib.sync) {
      throw new Error('Set up the sync server before pairing')
    }

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

  /**
   * Points this vault at a sync server, and proves the shared secret to it.
   *
   * A url alone configures nothing since favalib gained the connection gate:
   * the server refuses a socket that cannot prove its secret, and only the
   * user can supply that -- which is why this is a step after the vault
   * exists rather than a build-time parameter. `../app-browser`'s
   * `SyncServerForm` is the same call from the other client.
   *
   * `setSyncServerUrl` resolves only once the server has accepted, so a wrong
   * secret surfaces as a rejection here instead of a connection that quietly
   * never works. Both values are stored in the vault, and the secret itself
   * never travels -- what crosses the wire is an HMAC over a nonce the server
   * draws.
   * @param serverUrl - An absolute ws:// or wss:// url.
   * @param serverSecret - The secret the server is configured with.
   */
  async setSyncServer(serverUrl: string, serverSecret: string) {
    const favaLib = this.favaLib
    if (!favaLib) throw new Error('Create a vault before setting a sync server')

    await favaLib.setSyncServerUrl(serverUrl, serverSecret as ServerSecret)
  }

  async unlock(password: Password) {
    const blob = await this.readBlob()
    if (!blob) throw new Error('There is no vault to unlock')

    const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
      blob,
      password,
    )
    await this.attach(favaLib)

    // With a sync server configured, `Ready` only fires once the first batch of
    // remote commands has been applied. Listing before it returns a vault that
    // is a round of sync out of date.
    await favaLib.ready
  }

  /**
   * Rebuilds the instance after the service worker was evicted.
   *
   * Silent by design: no stored session just means the vault is locked, which
   * is a normal state and not an error to report.
   *
   * No key derivation happens here -- that is the point of the session blob.
   * The old password path ran a full argon2id unlock on every worker boot,
   * which at the v2 parameters is the better part of a second of the popup
   * sitting on a spinner.
   */
  async restoreSession() {
    if (this.favaLib) return
    // Nothing is ever stored where the background cannot be evicted, so there
    // is nothing to look for.
    if (!backgroundCanBeEvicted()) return

    const session = await this.db.getSessionValue(SESSION_KEY)
    if (!session) return

    const blob = await this.readBlob()
    if (!blob) {
      // The vault was forgotten while the worker was down. The session opens
      // nothing now, so do not keep holding key material for it.
      await this.db.deleteSessionValue(SESSION_KEY)
      return
    }

    try {
      const favaLib = await creationUtils.loadFavaLibFromUnlockedSession(
        blob,
        session as UnlockedSessionString,
      )
      await this.attach(favaLib)
      // With a sync server configured, `Ready` only fires once the first batch
      // of remote commands has been applied -- same reason as `unlock`.
      await favaLib.ready
      log.info('Restored an unlocked vault after a worker restart')
    } catch (error) {
      // favalib's contract for every throw out of the session path is the
      // same: discard the session and ask for the password. Do not branch on
      // which error it was.
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
    await this.db.deleteSessionValue(SESSION_KEY)
    // What the popup was in the middle of typing goes too: a lock is the user
    // saying stop holding my things, and the drafts hold the sync server
    // secret and a pairing code. `reset()` comes through here as well.
    await clearDrafts()
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
   * One entry, for a question that is about that entry rather than a list.
   *
   * Null rather than a throw for an id that is not there: an entry can be
   * deleted on another device while the popup is holding a row for it, and
   * that is not an error worth a message.
   * @param entryId - The entry to look up.
   * @returns The entry, or null when the vault is locked or does not have it.
   */
  entryFor(entryId: EntryId): ListedEntry | null {
    if (!this.isUnlocked) return null
    try {
      const meta = this.favaLib?.vault.getEntryMeta(entryId)
      return meta ? toListedEntry(meta) : null
    } catch {
      return null
    }
  }

  /**
   * Records what a fill taught us: one more matcher, and the site url when the
   * entry had none.
   *
   * The only write this package makes into the vault. `updateEntry` replaces
   * the matcher list rather than merging into it, so the append is done here;
   * the encrypted save and the sync push both fall out of that one call.
   *
   * The offer is the background's own (`siteOfferFor`), never the popup's
   * word for it -- see `REMEMBER_ENTRY_SITE` in `handleMessage`.
   * @param entryId - The entry to extend.
   * @param offer - What to add, as the background decided it.
   */
  async addSiteToEntry(entryId: EntryId, offer: SiteOffer): Promise<void> {
    const favaLib = this.favaLib
    if (!favaLib || this.pairing) throw new Error('The vault is locked')

    const meta = favaLib.vault.getEntryMeta(entryId)
    await favaLib.vault.updateEntry(entryId, {
      matchers: [...meta.matchers, offer.matcher],
      // `url` is display-only and never matched on, so this changes nothing
      // about where the entry is offered. `?? meta.url` rather than a
      // conditional spread because the offer already decided: it carries a
      // url only when the entry had none.
      url: offer.siteUrl ?? meta.url,
    })
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
