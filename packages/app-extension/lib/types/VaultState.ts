import type { EntryId, UrlMatcher } from 'favalib'

/**
 * Where the vault is, from the popup's point of view.
 *
 * - `no-vault`   nothing stored yet; the user has to create or join one
 * - `locked`     a locked representation is on disk, but no keys are in memory
 * - `pairing`    a vault exists in memory and is waiting for another device to
 *                hand over the real contents
 * - `unlocked`   ready to list and to generate tokens
 */
export type VaultStatus = 'no-vault' | 'locked' | 'pairing' | 'unlocked'

export interface VaultSummary {
  status: VaultStatus
  deviceId: string | null
  deviceFriendlyName: string | null
  /**
   * The sync server this vault is configured with, or null when none is.
   *
   * Distinct from `syncConnected`: a vault with no server configured needs the
   * sync-server form, one with a server that is down needs patience.
   */
  syncServerUrl: string | null
  /** Whether the sync websocket is up. `false` whenever there is no vault. */
  syncConnected: boolean
  entryCount: number
}

/**
 * An entry as it crosses to the popup.
 *
 * A deliberate subset of favalib's `EntryMeta`: no `payload`, so no secret,
 * and no token either. The popup never renders a code -- it asks for one only
 * when the user clicks, and copies it straight to the clipboard.
 */
export interface ListedEntry {
  id: EntryId
  issuer: string
  name: string
  url: string | null
  matchers: UrlMatcher[]
  /** Set only for entries matched against the active tab's url. */
  matchedBy: UrlMatcher | null
}

export interface EntryList {
  /** Entries whose matchers claim the active tab, most specific first. */
  forSite: ListedEntry[]
  all: ListedEntry[]
}

/**
 * zxcvbn's verdict on a candidate master password.
 *
 * Computed in the background rather than the popup: reaching
 * `getPasswordStrength` means importing favalib's vault factory, which drags
 * node-forge, jpake and the rest into whatever bundle touches it. The popup is
 * meant to stay a thin client, so it asks instead.
 */
export interface PasswordStrength {
  /** 0-4. favalib refuses to create a vault below 3. */
  score: number
  warning: string
  suggestions: string[]
}

/** What a create/unlock/pair attempt reports back. */
export interface VaultActionResult {
  ok: boolean
  error: string | null
}
