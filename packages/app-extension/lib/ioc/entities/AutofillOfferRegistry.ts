import { injectable } from 'inversify'

import type { ListedEntry } from '../../types/VaultState'

/**
 * One open autofill menu, and everything needed to serve and finish it.
 *
 * `tabId`, `frameId` and `url` are taken from the `MessageSender` the browser
 * supplies, never from the payload -- the same rule `REPORT_OTP_FIELDS`
 * follows, and for the same reason: a content script must not be trusted to
 * name its own origin or its own frame.
 */
export interface AutofillOffer {
  token: string
  tabId: number
  /** The frame holding the field. The menu iframe is a *different* frame. */
  frameId: number
  /**
   * Chrome's per-document id for that frame, when it supplies one (106+).
   *
   * Preferred over `frameId` for delivery: a frame id is reused after a
   * navigation, a document id is not, so a code can never be delivered into a
   * page that replaced the one the offer was made for. Firefox has no such id.
   */
  documentId?: string
  url: string
  /** Which detected field the menu is attached to, within that frame. */
  fieldId: string
  /** Exactly what the menu may offer, and the only ids a fill will honour. */
  entries: ListedEntry[]
  openedAt: number
}

/**
 * The open autofill offers, one per tab.
 *
 * ## Why the token is random, and not a counter
 *
 * The menu is a `web_accessible_resources` page, which means any site can
 * frame `chrome-extension://<id>/menu.html` itself -- and a frame loaded from
 * that url *is* an extension context, so it can call `runtime.sendMessage` and
 * its `sender.tab.id` is the tab it is embedded in. A hostile frame on the
 * page the user is currently on therefore shares a tab with a legitimate open
 * offer. With a guessable handle it could ask for that offer's contents and
 * read the user's entry list for the site; checking that the sender is an
 * extension page does not help, because it *is* one.
 *
 * So the handle has to be unguessable. `crypto.randomUUID()` is available in
 * both an mv3 service worker and an mv2 background page.
 *
 * ## Why one per tab, and no expiry sweeper
 *
 * A tab has at most one focused field, so a second offer in the same tab means
 * the first is stale by definition and replacing it is the correct behaviour --
 * it also resolves the focus-moved-between-frames race, where frame A's close
 * and frame B's open can arrive out of order. Between that, an explicit close,
 * `tabs.onRemoved` and a vault lock, there is nothing left for a timer to
 * collect.
 *
 * In memory only, like {@link OtpFieldRegistry}: an mv3 worker is evicted
 * whenever the browser feels like it, and losing this costs the user one more
 * click on a field.
 */
@injectable()
class AutofillOfferRegistry {
  private offers = new Map<number, AutofillOffer>()

  /**
   * Records a new offer for a tab, replacing whatever it had.
   * @param offer - Everything but the token.
   * @returns The stored offer, including its freshly minted token.
   */
  open(offer: Omit<AutofillOffer, 'token' | 'openedAt'>): AutofillOffer {
    const stored: AutofillOffer = {
      ...offer,
      token: crypto.randomUUID(),
      openedAt: Date.now(),
    }
    this.offers.set(offer.tabId, stored)
    return stored
  }

  /**
   * Resolves a token back to its offer.
   *
   * The tab is checked as well as the token, so a token cannot be replayed
   * from another tab even if one somehow leaked.
   * @param token - The token the menu was handed.
   * @param tabId - The requesting sender's tab.
   * @returns The offer, or null when the token is unknown, stale or foreign.
   */
  resolve(token: string, tabId: number): AutofillOffer | null {
    const offer = this.offers.get(tabId)
    if (offer?.token !== token) return null
    return offer
  }

  close(token: string, tabId: number): void {
    if (this.offers.get(tabId)?.token === token) this.offers.delete(tabId)
  }

  forgetTab(tabId: number): void {
    this.offers.delete(tabId)
  }

  /** Used when the vault locks: nothing on offer survives it. */
  forgetAll(): void {
    this.offers.clear()
  }
}

export default AutofillOfferRegistry
