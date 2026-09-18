/**
 * Whether a fill just taught us something worth writing into the vault.
 *
 * Pure, and next to `fillTarget.ts` for the reason that file gives: the suite
 * runs `tests/**\/*.test.ts` only, so a rule left inside `handleMessage` is
 * verified by hand or not at all. Shaped like `isTrustedFrame` too -- the
 * vault question is answered by the caller and passed in, so nothing here
 * needs a `FavaLib`.
 *
 * One function, called twice: once to build the offer the popup shows, and
 * again to apply the answer. That is deliberate. If the offer were computed
 * here and the write assembled somewhere else, the user could be shown one
 * matcher and have another saved.
 * @module
 */

import {
  MAX_MATCHERS_PER_ENTRY,
  MAX_URL_LENGTH,
  suggestMatchersForUrl,
  type UrlMatcher,
} from 'favalib'

import type { SiteOffer } from '../types/Autofill'

export interface SiteOfferQuestion {
  /**
   * The *page's* url -- the top frame's, never the frame that was filled.
   *
   * Null when the top frame has not reported, in which case there is nothing
   * to offer: a matcher naming a host the user was never shown is not an
   * offer, it is a guess.
   */
  pageUrl: string | null
  /** Whether a matcher on the entry already covers `pageUrl`. */
  entryClaimsPage: boolean
  /** The entry's matchers, so a full list is not added to. */
  matchers: UrlMatcher[]
  /** The entry's site url. Only an absent one is filled in. */
  siteUrl: string | null
}

/**
 * The site url to record for a page.
 *
 * `new URL` rather than favalib's `buildUrlMatchContext`, which is not
 * exported, and the protocol check is repeated rather than inferred from
 * `suggestMatchersForUrl` having returned something: which of the two refuses
 * an `about:` url first is not a fact this should depend on.
 * @param url - The page's url.
 * @returns The url to record, or null when there is nothing honest to record.
 */
const siteUrlFor = (url: string): string | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  // Origin and path, never the query or the fragment. A second-factor url
  // routinely carries a session id, and this string is stored in the vault and
  // synced to every device the user has.
  return `${parsed.origin}${parsed.pathname}`
}

/**
 * Whether two urls name the same http(s) host.
 *
 * The one check on putting an unanswered prompt back after a navigation. A
 * submit takes the page, and the prompt with it, so the offer is re-shown on
 * the page that loads -- but only if it is the same site. Without this, a user
 * who filled a code and then opened something else within the minute would get
 * a prompt about the first site on top of the second, which reads as a bug.
 *
 * Host, not registrable domain: telling `bbc.co.uk` from `co.uk` needs a public
 * suffix list and favalib carries none on purpose. Narrower means a prompt that
 * does not come back after a redirect across hosts, never one that comes back
 * somewhere it should not.
 * @param a - One url.
 * @param b - The other.
 * @returns True when both parse as http(s) and their hosts are equal.
 */
export const sameSiteHost = (a: string, b: string): boolean => {
  const hostOf = (url: string): string | null => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.host
        : null
    } catch {
      return null
    }
  }

  const host = hostOf(a)
  return host !== null && host === hostOf(b)
}

/**
 * What to offer to remember after a fill, if anything.
 * @param question - See {@link SiteOfferQuestion}.
 * @returns The offer, or null when there is nothing to ask about.
 */
export const siteOfferFor = (question: SiteOfferQuestion): SiteOffer | null => {
  const { pageUrl, entryClaimsPage, matchers, siteUrl } = question

  // Nothing to learn: the entry is already offered on this page, which is the
  // state this whole prompt exists to reach.
  if (pageUrl === null || entryClaimsPage) return null

  // favalib refuses a seventeenth matcher outright, and an offer that cannot
  // be accepted is worse than no offer.
  if (matchers.length >= MAX_MATCHERS_PER_ENTRY) return null

  const site = siteUrlFor(pageUrl)
  if (site === null) return null

  // favalib's own suggestion rather than a hostname derived here: its doc
  // comment owns the "the full hostname, narrower than the user wanted but
  // never broader" rule, and a public suffix list is the only thing that could
  // improve on it.
  const [matcher] = suggestMatchersForUrl(pageUrl)
  if (!matcher) return null

  // Only ever filled in, never overwritten -- the user may have typed a better
  // url than this one. Dropped when it is too long for favalib to accept,
  // because `validateEntryStrict` would otherwise reject the update whole and
  // cost them the matcher as well.
  const hasSite = siteUrl !== null && siteUrl.length > 0
  const siteFits = site.length <= MAX_URL_LENGTH

  return {
    pageUrl,
    matcher,
    siteUrl: !hasSite && siteFits ? site : null,
  }
}
