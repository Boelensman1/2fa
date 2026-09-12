import { describe, it, expect } from 'vitest'

import type { UrlMatcher } from '../../src/interfaces/Entry.mjs'
import {
  buildUrlMatchContext,
  findMatcherForUrl,
  matcherMatchesUrl,
  suggestMatchersForUrl,
} from '../../src/utils/urlMatching.mjs'
import { MAX_REGEX_SOURCE_LENGTH } from '../../src/utils/matcherValidation.mjs'

/**
 * Applies a matcher to a url.
 * @param matcher - The matcher to apply.
 * @param url - The url to match against.
 * @returns True when the matcher covers the url.
 */
const matches = (matcher: UrlMatcher, url: string): boolean => {
  const ctx = buildUrlMatchContext(url)
  return ctx !== null && matcherMatchesUrl(matcher, ctx)
}

describe('buildUrlMatchContext', () => {
  it('rejects urls it cannot match against', () => {
    expect(buildUrlMatchContext('')).toBeNull()
    expect(buildUrlMatchContext('not a url')).toBeNull()
    expect(buildUrlMatchContext('about:blank')).toBeNull()
    expect(buildUrlMatchContext('file:///etc/passwd')).toBeNull()
    expect(buildUrlMatchContext('chrome-extension://abc/popup.html')).toBeNull()
  })

  it('normalises the host and the default port away', () => {
    expect(buildUrlMatchContext('https://EXAMPLE.com./x')?.hostname).toBe(
      'example.com',
    )
    expect(buildUrlMatchContext('https://example.com:443/')?.origin).toBe(
      'https://example.com',
    )
  })
})

describe('BaseDomain', () => {
  const matcher: UrlMatcher = { type: 'BaseDomain', value: 'github.com' }

  it('matches the domain and its subdomains', () => {
    expect(matches(matcher, 'https://github.com/x')).toBe(true)
    expect(matches(matcher, 'https://gist.github.com/')).toBe(true)
    expect(matches(matcher, 'https://a.b.github.com/')).toBe(true)
  })

  it('does not match a look-alike domain', () => {
    // The dot boundary is the whole point of this matcher type.
    expect(matches(matcher, 'https://github.com.evil.com/')).toBe(false)
    expect(matches(matcher, 'https://notgithub.com/')).toBe(false)
    expect(matches(matcher, 'https://evil.com/?q=github.com')).toBe(false)
  })

  it('handles multi-label domains without a public suffix list', () => {
    const bbc: UrlMatcher = { type: 'BaseDomain', value: 'bbc.co.uk' }
    expect(matches(bbc, 'https://www.bbc.co.uk/news')).toBe(true)
    expect(matches(bbc, 'https://evil.co.uk/')).toBe(false)
  })

  it('ignores case, a trailing dot and the port', () => {
    expect(matches(matcher, 'https://GitHub.COM./x')).toBe(true)
    expect(matches(matcher, 'https://github.com:8443/x')).toBe(true)
    expect(
      matches(
        { type: 'BaseDomain', value: '.GitHub.com.' },
        'https://github.com/',
      ),
    ).toBe(true)
  })
})

describe('Host', () => {
  const matcher: UrlMatcher = { type: 'Host', value: 'sso.example.com' }

  it('matches only the exact host', () => {
    expect(matches(matcher, 'https://sso.example.com/login')).toBe(true)
    expect(matches(matcher, 'https://example.com/login')).toBe(false)
    expect(matches(matcher, 'https://a.sso.example.com/')).toBe(false)
  })

  it('ignores the port', () => {
    expect(matches(matcher, 'https://sso.example.com:8443/')).toBe(true)
  })
})

describe('Origin', () => {
  const matcher: UrlMatcher = { type: 'Origin', value: 'https://example.com' }

  it('is scheme and port sensitive', () => {
    expect(matches(matcher, 'https://example.com/x')).toBe(true)
    expect(matches(matcher, 'https://example.com:443/x')).toBe(true)
    expect(matches(matcher, 'http://example.com/x')).toBe(false)
    expect(matches(matcher, 'https://example.com:8443/x')).toBe(false)
  })

  it('never matches when the value is not a url', () => {
    expect(
      matches({ type: 'Origin', value: 'example.com' }, 'https://example.com/'),
    ).toBe(false)
  })
})

describe('UrlPrefix', () => {
  const matcher: UrlMatcher = {
    type: 'UrlPrefix',
    value: 'https://example.com/login',
  }

  it('matches on a path boundary', () => {
    expect(matches(matcher, 'https://example.com/login')).toBe(true)
    expect(matches(matcher, 'https://example.com/login/step2')).toBe(true)
    expect(matches(matcher, 'https://example.com/login?a=1')).toBe(true)
    expect(matches(matcher, 'https://example.com/login#f')).toBe(true)
  })

  it('does not match a longer path segment', () => {
    // A plain startsWith would let this through.
    expect(matches(matcher, 'https://example.com/loginfoo')).toBe(false)
    expect(matches(matcher, 'https://example.com/login-other')).toBe(false)
  })
})

describe('Regex', () => {
  it('is anchored, so a bare substring does not match', () => {
    const matcher: UrlMatcher = { type: 'Regex', value: 'github' }
    expect(matches(matcher, 'https://evil.com/?q=github')).toBe(false)
  })

  it('matches when the whole url is covered', () => {
    const matcher: UrlMatcher = {
      type: 'Regex',
      value: 'https://github\\.com/.*',
    }
    expect(matches(matcher, 'https://github.com/login')).toBe(true)
    expect(matches(matcher, 'https://gitlab.com/login')).toBe(false)
  })

  it('anchors a top-level alternation too', () => {
    const matcher: UrlMatcher = { type: 'Regex', value: 'a|.*' }
    expect(matches(matcher, 'https://example.com/')).toBe(true)
    expect(
      matches({ type: 'Regex', value: 'a|b' }, 'https://example.com/'),
    ).toBe(false)
  })

  it('never matches, and never throws, on a refused source', () => {
    expect(matches({ type: 'Regex', value: '(' }, 'https://x.com/')).toBe(false)
    expect(matches({ type: 'Regex', value: '(a+)+' }, 'https://x.com/')).toBe(
      false,
    )
    expect(matches({ type: 'Regex', value: '(.*)*' }, 'https://x.com/')).toBe(
      false,
    )
    expect(
      matches(
        { type: 'Regex', value: 'a'.repeat(MAX_REGEX_SOURCE_LENGTH + 1) },
        'https://x.com/',
      ),
    ).toBe(false)
  })

  it('does not carry lastIndex across repeated calls', () => {
    const matcher: UrlMatcher = { type: 'Regex', value: '.*' }
    const url = 'https://example.com/'
    expect(matches(matcher, url)).toBe(true)
    expect(matches(matcher, url)).toBe(true)
    expect(matches(matcher, url)).toBe(true)
  })

  it('skips regexes once the deadline has passed', () => {
    const ctx = buildUrlMatchContext('https://example.com/')!
    const matcher: UrlMatcher = { type: 'Regex', value: '.*' }
    expect(matcherMatchesUrl(matcher, ctx, Date.now() + 1000)).toBe(true)
    expect(matcherMatchesUrl(matcher, ctx, Date.now() - 1)).toBe(false)
  })
})

describe('findMatcherForUrl', () => {
  const ctx = buildUrlMatchContext('https://gist.github.com/foo')!

  it('returns null when there are no matchers', () => {
    expect(findMatcherForUrl([], ctx)).toBeNull()
  })

  it('returns the first matcher that fires, not the first in the list', () => {
    const matchers: UrlMatcher[] = [
      { type: 'Host', value: 'example.com' },
      { type: 'BaseDomain', value: 'github.com' },
    ]
    expect(findMatcherForUrl(matchers, ctx)).toEqual({
      type: 'BaseDomain',
      value: 'github.com',
    })
  })

  it('prefers the most specific matcher, not the first one listed', () => {
    const matchers: UrlMatcher[] = [
      { type: 'BaseDomain', value: 'github.com' },
      { type: 'Host', value: 'gist.github.com' },
    ]
    expect(findMatcherForUrl(matchers, ctx)?.type).toBe('Host')
  })

  it('breaks a specificity tie by the longer value', () => {
    const matchers: UrlMatcher[] = [
      { type: 'BaseDomain', value: 'github.com' },
      { type: 'BaseDomain', value: 'gist.github.com' },
    ]
    expect(findMatcherForUrl(matchers, ctx)?.value).toBe('gist.github.com')
  })

  it('reports the login-page match on the login page', () => {
    const loginCtx = buildUrlMatchContext('https://github.com/login/step2')!
    const matchers: UrlMatcher[] = [
      { type: 'BaseDomain', value: 'github.com' },
      { type: 'UrlPrefix', value: 'https://github.com/login' },
    ]
    expect(findMatcherForUrl(matchers, loginCtx)).toEqual({
      type: 'UrlPrefix',
      value: 'https://github.com/login',
    })
  })

  it('rejects an unknown matcher type at runtime', () => {
    const matchers = [{ type: 'Nope', value: 'x' }] as unknown as UrlMatcher[]
    expect(findMatcherForUrl(matchers, ctx)).toBeNull()
  })
})

describe('suggestMatchersForUrl', () => {
  it('suggests the full hostname, which can never be too broad', () => {
    expect(suggestMatchersForUrl('https://www.bbc.co.uk/news')).toEqual([
      { type: 'BaseDomain', value: 'www.bbc.co.uk' },
    ])
  })

  it('suggests nothing for an unmatchable url', () => {
    expect(suggestMatchersForUrl('about:blank')).toEqual([])
    expect(suggestMatchersForUrl('nonsense')).toEqual([])
  })
})
