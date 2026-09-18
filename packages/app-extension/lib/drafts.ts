import { storage } from 'wxt/utils/storage'
import type { StorageItemKey } from 'wxt/utils/storage'

import Logger from './classes/Logger'
import type { TabId } from './ui/components/TabBar'

const log = new Logger('drafts')

/**
 * What the popup was in the middle of typing.
 *
 * A browser action popup is destroyed the moment it loses focus, so every
 * `useState` in it is gone as soon as the user goes to look something up --
 * which the sync setup *forces* them to do: `SyncServerForm` asks for a server
 * address and a shared secret together, and both of those live somewhere else.
 *
 * These live in `session:` -- `browser.storage.session`, memory-backed, never
 * written to disk, wiped when the browser closes, and unreadable from content
 * scripts. That is not a detail: a draft holds a sync server secret and a live
 * pairing code, and `local:` would put both on disk, outliving the browser that
 * was meant to forget them. Do not move them.
 *
 * A master password is deliberately not on the list. `VaultContainer` already
 * refuses to hold one even where it would save a full argon2id pass on every
 * worker boot, and keeps the derived session blob instead, because the password
 * opens every key generation of the vault and is very often the user's password
 * elsewhere. A half-typed one surviving popup opens would undo exactly that.
 *
 * Plain `getItem`/`setItem` rather than `storage.defineItem`, matching
 * `ioc/entities/Db.ts`: the same four calls, and nothing that runs at import
 * time in a background that may be booting.
 */
export interface SyncServerDraft {
  url: string
  secret: string
}

export interface PairDraft {
  connectionString: string
  deviceName: string
}

/** One draft: read it, write it through, drop it. Never throws. */
export interface Draft<T> {
  read: () => Promise<T | null>
  /**
   * Fire and forget, on every keystroke.
   *
   * Not debounced on purpose. The popup can be torn down between any two
   * keystrokes -- that is the whole failure being fixed -- and a debounce would
   * drop the last characters typed, which is precisely when it matters.
   * `storage.session` has no write-rate quota; that is `storage.sync`.
   */
  write: (_value: T) => void
  clear: () => Promise<void>
}

/**
 * A draft that degrades to today's behaviour rather than breaking the form.
 *
 * `storage.session` is Chrome 102+ and Firefox 115+, and both build targets
 * have it (chrome is built mv3, firefox mv2 -- there is no manifest-version
 * restriction on the Firefox side). An older browser than that should lose a
 * draft, not the screen it was typed on.
 */
const defineDraft = <T>(name: string): Draft<T> => {
  const key: StorageItemKey = `session:draft:${name}`

  const warn = (error: unknown) => {
    log.warn(
      `Could not reach the draft store for ${key}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const clear = async () => {
    try {
      await storage.removeItem(key)
    } catch (error) {
      warn(error)
    }
  }

  return {
    read: async () => {
      try {
        return (await storage.getItem<T>(key)) ?? null
      } catch (error) {
        warn(error)
        return null
      }
    },
    write: (value: T) => {
      const store = async () => {
        try {
          await storage.setItem(key, value)
        } catch (error) {
          warn(error)
        }
      }
      void store()
    },
    clear,
  }
}

/** The sync server address and its shared secret, typed together. */
export const syncServerDraft = defineDraft<SyncServerDraft>('syncServer')

/** The pairing code pasted from another device, and the name for this one. */
export const pairDraft = defineDraft<PairDraft>('pair')

/** Which tab of the unlocked popup was open. */
export const popupTabDraft = defineDraft<TabId>('popupTab')

/** Whether Settings had the sync server form open. */
export const settingsEditingServerDraft = defineDraft<boolean>(
  'settingsEditingServer',
)

/** Which half of the first-run screen was selected. */
export const createModeDraft = defineDraft<'connect' | 'create'>('createMode')

// Typed by what this list is for, rather than as `Draft<unknown>`: `write`
// makes `Draft<T>` invariant in T, so every entry would need a cast.
const allDrafts: { clear: () => Promise<void> }[] = [
  syncServerDraft,
  pairDraft,
  popupTabDraft,
  settingsEditingServerDraft,
  createModeDraft,
]

/**
 * Closes the sync server form and forgets what was typed into it.
 *
 * The two go together: the draft exists to survive a popup close *while the
 * form is open*, so every way of leaving the form -- connecting, cancelling, or
 * switching to the vault tab -- ends the secret's life here. Nothing needs it
 * afterwards; a server that accepted it has it stored in the vault.
 */
export const closeSyncServerEditor = async () => {
  await Promise.all([
    settingsEditingServerDraft.clear(),
    syncServerDraft.clear(),
  ])
}

/**
 * Drops every draft.
 *
 * Called from `VaultContainer.lock()`, which is the user saying stop holding my
 * things -- and the drafts hold a server secret and a pairing code.
 */
export const clearDrafts = async () => {
  await Promise.all(allDrafts.map((draft) => draft.clear()))
}
