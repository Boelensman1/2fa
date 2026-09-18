import { injectable } from 'inversify'
import { storage } from 'wxt/utils/storage'
import type { StorageItemKey } from 'wxt/utils/storage'
import type { EntryId } from 'favalib'

import Logger from '../../classes/Logger'
import type { SiteOffer } from '../../types/Autofill'

const log = new Logger('background-script/RememberOfferRegistry')

/**
 * Where the pending offers live.
 *
 * `session:` is `browser.storage.session` -- memory-backed, never written to
 * disk, wiped when the browser closes and unreadable from content scripts. See
 * the class doc for why this one is persisted at all, and `lib/drafts.ts` for
 * the contract the area is held under.
 */
const KEY: StorageItemKey = 'session:rememberOffers'

/**
 * How long an unanswered offer stays up.
 *
 * Long enough to type a code, submit, and read the prompt on the page that
 * loads; short enough that a prompt is never a surprise. An offer that expires
 * is a no, which is the right default for something that writes to the vault.
 */
export const REMEMBER_OFFER_TTL_MS = 60_000

/** One pending "remember this site?" question, for one tab. */
export interface RememberOffer {
  token: string
  tabId: number
  entryId: EntryId
  /** What to call the entry on screen. The prompt is never told its id. */
  entryLabel: string
  /** The host the question is about, frozen with the rest of the offer. */
  pageHost: string
  /** The background's own suggestion, recomputed before it is applied. */
  offer: SiteOffer
  /** True when the code went into an embedded frame rather than the page. */
  inSubframe: boolean
  expiresAt: number
  /**
   * The frame-0 url the prompt was last mounted on.
   *
   * A submit navigates the page and takes the prompt with it, so the offer is
   * re-shown when frame 0 next reports from the same host. This is what stops
   * an SPA's repeated reports from re-mounting it on the page it is already on.
   */
  shownOnUrl: string
}

type Stored = Record<string, RememberOffer>

const read = async (): Promise<Stored> => {
  try {
    return (await storage.getItem<Stored>(KEY)) ?? {}
  } catch (error) {
    log.warn(
      `Could not read the pending offers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {}
  }
}

const write = async (offers: Stored): Promise<void> => {
  try {
    if (Object.keys(offers).length === 0) {
      await storage.removeItem(KEY)
      return
    }
    await storage.setItem(KEY, offers)
  } catch (error) {
    log.warn(
      `Could not store the pending offers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/**
 * Drops every offer that has run out, so a read never returns a dead one.
 *
 * Done on read rather than by a sweeper: a service worker that is awake enough
 * to answer is awake enough to prune, and a timer in an mv3 worker is not a
 * thing that can be relied on to fire.
 */
const live = (offers: Stored, now: number): Stored =>
  Object.fromEntries(
    Object.entries(offers).filter(([, offer]) => offer.expiresAt > now),
  )

/**
 * The "remember this site?" questions waiting to be answered, one per tab.
 *
 * ## Why the token is unguessable
 *
 * The prompt is a `web_accessible_resources` page, so any site can frame
 * `chrome-extension://<id>/remember.html` itself -- and a frame loaded from
 * that url *is* an extension context, with `runtime.sendMessage` and a
 * `sender.tab.id` for the tab it sits in. It is the threat
 * {@link AutofillOfferRegistry} describes, with a sharper edge: answering yes
 * **writes to the vault**. Checking that the sender is an extension page does
 * nothing, because it is one; only a handle it cannot guess separates our
 * prompt from theirs. `crypto.randomUUID()`, and `resolve` checks the tab as
 * well, so a leaked token cannot be replayed from somewhere else.
 *
 * ## Why this one is persisted, and `AutofillOfferRegistry` is not
 *
 * That one says losing an offer "costs the user one more click on a field",
 * which is true of a menu the user is looking at. This offer has to outlive a
 * page navigation and up to a minute of the user reading a login form, and mv3
 * evicts the worker after ~30s idle -- so an in-memory offer would routinely be
 * gone by the time it was answered, and the answer would fail for no reason the
 * user could see.
 *
 * It holds an entry label and a page url. That is the same class of thing the
 * pairing code and the sync secret in `lib/drafts.ts` are held to, and the same
 * area: never on disk, gone when the browser closes, invisible to content
 * scripts. It is dropped on a vault lock with everything else.
 */
@injectable()
class RememberOfferRegistry {
  /**
   * Records a new offer for a tab, replacing whatever it had.
   * @param offer - Everything but the token and the deadline.
   * @param now - Injectable clock, so the suite need not wait a minute.
   * @returns The stored offer, including its freshly minted token.
   */
  async open(
    offer: Omit<RememberOffer, 'token' | 'expiresAt'>,
    now = Date.now(),
  ): Promise<RememberOffer> {
    const stored: RememberOffer = {
      ...offer,
      token: crypto.randomUUID(),
      expiresAt: now + REMEMBER_OFFER_TTL_MS,
    }
    const offers = live(await read(), now)
    offers[String(offer.tabId)] = stored
    await write(offers)
    return stored
  }

  /**
   * Resolves a token back to its offer.
   *
   * The tab is checked as well as the token: a token cannot be replayed from
   * another tab even if one somehow leaked, and a hostile frame can only ever
   * reach the offer belonging to the tab it is already sitting in.
   * @param token - The token the prompt was handed.
   * @param tabId - The requesting sender's tab.
   * @param now - Injectable clock.
   * @returns The offer, or null when it is unknown, expired or foreign.
   */
  async resolve(
    token: string,
    tabId: number,
    now = Date.now(),
  ): Promise<RememberOffer | null> {
    const offer = (await read())[String(tabId)]
    if (offer?.token !== token) return null
    if (offer.expiresAt <= now) return null
    return offer
  }

  /**
   * The offer waiting for a tab, whatever its token.
   *
   * Only for the background's own re-show check after a navigation -- never to
   * answer something a tab asked, which is what {@link resolve} is for.
   * @param tabId - The tab.
   * @param now - Injectable clock.
   * @returns The offer, or null when there is none or it has expired.
   */
  async forTab(tabId: number, now = Date.now()): Promise<RememberOffer | null> {
    const offer = (await read())[String(tabId)]
    if (!offer || offer.expiresAt <= now) return null
    return offer
  }

  /** Records the frame-0 url the prompt has just been mounted on. */
  async markShownOn(tabId: number, url: string): Promise<void> {
    const offers = await read()
    const offer = offers[String(tabId)]
    if (!offer) return
    offers[String(tabId)] = { ...offer, shownOnUrl: url }
    await write(offers)
  }

  async close(token: string, tabId: number): Promise<void> {
    const offers = await read()
    if (offers[String(tabId)]?.token !== token) return
    delete offers[String(tabId)]
    await write(offers)
  }

  async forgetTab(tabId: number): Promise<void> {
    const offers = await read()
    if (!(String(tabId) in offers)) return
    delete offers[String(tabId)]
    await write(offers)
  }
}

/**
 * Drops every pending offer.
 *
 * A free function beside the class, and imported by `VaultContainer.lock()`
 * exactly as `clearDrafts` is: `lock()` is also reached from
 * `restoreSession()`'s failure path, which never goes through `handleMessage`
 * and has no container to ask for a registry. A lock is the user saying stop
 * holding my things, and this holds an entry label and a page url.
 */
export const clearRememberOffers = async (): Promise<void> => {
  await write({})
}

export default RememberOfferRegistry
