import { describe, it, expect } from 'vitest'
import { MAX_MATCHERS_PER_ENTRY, MAX_URL_LENGTH } from 'favalib'
import type { UrlMatcher } from 'favalib'

import { sameSiteHost, siteOfferFor } from '../../lib/background/rememberSite'

/**
 * What a popup fill offers to write into the vault.
 *
 * Tested as a function rather than through the ui because it is called twice --
 * once to build the offer and once to apply the answer -- and the guarantee
 * worth pinning is that both calls agree. The `handleMessage` suite covers the
 * wiring; this covers the rule.
 */

const github: UrlMatcher = { type: 'BaseDomain', value: 'github.com' }

const question = (over: Partial<Parameters<typeof siteOfferFor>[0]> = {}) => ({
  pageUrl: 'https://elsewhere.example/login',
  entryClaimsPage: false,
  matchers: [github],
  siteUrl: null,
  ...over,
})

describe('siteOfferFor', () => {
  it('offers the page host as a BaseDomain matcher', () => {
    expect(siteOfferFor(question())).toEqual({
      pageUrl: 'https://elsewhere.example/login',
      matcher: { type: 'BaseDomain', value: 'elsewhere.example' },
      siteUrl: 'https://elsewhere.example/login',
    })
  })

  /** The state the prompt exists to reach; reaching it is not news. */
  it('offers nothing when the entry already claims the page', () => {
    expect(siteOfferFor(question({ entryClaimsPage: true }))).toBeNull()
  })

  /**
   * The top frame has not reported. A matcher naming a host the user was never
   * shown is a guess, not an offer.
   */
  it('offers nothing without a page url', () => {
    expect(siteOfferFor(question({ pageUrl: null }))).toBeNull()
  })

  it.each([
    'about:blank',
    'moz-extension://uuid/popup.html',
    'file:///tmp/login.html',
    'not a url at all',
  ])('offers nothing for %s', (pageUrl) => {
    expect(siteOfferFor(question({ pageUrl }))).toBeNull()
  })

  /** An offer that favalib would refuse to accept is worse than no offer. */
  it('offers nothing when the entry is at the matcher limit', () => {
    const matchers = Array.from(
      { length: MAX_MATCHERS_PER_ENTRY },
      (_, i): UrlMatcher => ({ type: 'Host', value: `host-${String(i)}.test` }),
    )

    expect(siteOfferFor(question({ matchers }))).toBeNull()
    expect(
      siteOfferFor(question({ matchers: matchers.slice(1) })),
    ).not.toBeNull()
  })

  describe('the site url', () => {
    it('keeps the path and drops the query and the fragment', () => {
      expect(
        siteOfferFor(
          question({
            pageUrl: 'https://elsewhere.example/login/2fa?session=abc#step2',
          }),
        ),
      ).toMatchObject({ siteUrl: 'https://elsewhere.example/login/2fa' })
    })

    it('keeps the port, which is part of the origin', () => {
      expect(
        siteOfferFor(question({ pageUrl: 'http://localhost:3000/2fa' })),
      ).toMatchObject({
        siteUrl: 'http://localhost:3000/2fa',
        // The matcher does not carry one: `BaseDomain` matches on the hostname.
        matcher: { type: 'BaseDomain', value: 'localhost' },
      })
    })

    /** It is the user's, and they may have typed something better. */
    it('is null when the entry already has one', () => {
      expect(
        siteOfferFor(question({ siteUrl: 'https://typed-by-hand.example/' })),
      ).toMatchObject({ siteUrl: null })
    })

    /**
     * `validateEntryStrict` rejects an over-long url and would take the whole
     * update down with it -- costing the user the matcher, which is the half
     * that does anything.
     */
    it('is null when it is longer than favalib accepts, keeping the matcher', () => {
      const pageUrl = `https://elsewhere.example/${'a'.repeat(MAX_URL_LENGTH)}`

      expect(siteOfferFor(question({ pageUrl }))).toEqual({
        pageUrl,
        matcher: { type: 'BaseDomain', value: 'elsewhere.example' },
        siteUrl: null,
      })
    })
  })
})

/**
 * The one guard on putting an unanswered prompt back after a navigation.
 *
 * Too loose and a question about one site appears over another the user opened
 * in the meantime, which reads as the extension malfunctioning. Too tight and
 * the prompt does not survive the redirect a login performs, which is the
 * whole case it exists for.
 */
describe('sameSiteHost', () => {
  it('follows a redirect within one host', () => {
    expect(
      sameSiteHost('https://github.com/login', 'https://github.com/dashboard'),
    ).toBe(true)
  })

  it('does not follow the tab to another site', () => {
    expect(
      sameSiteHost('https://github.com/login', 'https://unrelated.example/'),
    ).toBe(false)
  })

  /**
   * Host, not registrable domain. Telling `bbc.co.uk` from `co.uk` needs a
   * public suffix list and favalib carries none on purpose, so a subdomain is
   * treated as a different site -- a prompt that does not come back, never one
   * that comes back somewhere it should not.
   */
  it('treats a subdomain as another site', () => {
    expect(
      sameSiteHost('https://github.com/login', 'https://gist.github.com/'),
    ).toBe(false)
  })

  it('tells ports and schemes apart the way the url does', () => {
    expect(
      sameSiteHost('https://example.com:8443/a', 'https://example.com/a'),
    ).toBe(false)
    expect(sameSiteHost('http://example.com/a', 'https://example.com/a')).toBe(
      true,
    )
  })

  it.each([
    ['about:blank', 'https://github.com/'],
    ['https://github.com/', 'moz-extension://uuid/remember.html'],
    ['not a url', 'https://github.com/'],
    ['', ''],
  ])('refuses %s against %s', (a, b) => {
    expect(sameSiteHost(a, b)).toBe(false)
  })
})
