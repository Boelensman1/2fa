import type { UrlMatcher, UrlMatcherType } from '../interfaces/Entry.mjs'
import {
  MAX_MATCHABLE_URL_LENGTH,
  compileMatcherRegex,
} from './matcherValidation.mjs'

/**
 * The parts of a url that matching needs, normalised once so every matcher
 * sees the same thing.
 */
export interface UrlMatchContext {
  /** The full, normalised url. Default ports are stripped. */
  href: string
  /** Scheme, host and port. */
  origin: string
  /** Lowercased, with any trailing dot removed. */
  hostname: string
  pathname: string
}

/**
 * How specific each matcher type is, used to rank entries that all match the
 * same url. Higher is more specific, and so a better guess.
 *
 * `Regex` sits below `UrlPrefix` because two regexes cannot be compared for
 * narrowness statically, but above the host-level types because writing one at
 * all is a deliberate act.
 */
export const MATCHER_SPECIFICITY: Record<UrlMatcherType, number> = {
  UrlPrefix: 400,
  Regex: 300,
  Origin: 200,
  Host: 100,
  BaseDomain: 0,
}

const MATCHABLE_PROTOCOLS = ['http:', 'https:']

/**
 * Strips the leading and trailing dots that a hand-typed hostname often picks
 * up, and lowercases it.
 * @param hostname - The hostname to normalise.
 * @returns The normalised hostname.
 */
const normaliseHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '')

/**
 * Parses a url into the shape the matchers consume.
 *
 * This deliberately uses the native `URL` rather than the injected
 * `UrlParserLib`: that interface is otpauth-shaped (`path` pre-split, no
 * origin, no port) and widening it would break every implementer. It exists
 * for exotic engines importing otpauth uris, which is not this code path.
 * @param url - The url to parse.
 * @returns The parsed context, or null when the url cannot be matched against.
 */
export const buildUrlMatchContext = (url: string): UrlMatchContext | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Autofilling on an extension, file or about: page is a footgun, and the
  // host-based matchers are meaningless there.
  if (!MATCHABLE_PROTOCOLS.includes(parsed.protocol)) {
    return null
  }

  return {
    href: parsed.href,
    origin: parsed.origin,
    hostname: normaliseHostname(parsed.hostname),
    pathname: parsed.pathname,
  }
}

/**
 * Normalises the value of an `Origin` matcher for comparison.
 * @param value - The matcher value.
 * @returns The origin, or null when the value is not a parseable url.
 */
const normaliseOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Decides whether a `UrlPrefix` matcher covers a url.
 *
 * The prefix has to end on a path boundary. A plain `startsWith` would let a
 * matcher for `https://example.com/login` fire on
 * `https://example.com/loginsomethingelse`.
 * @param prefix - The matcher value.
 * @param href - The url being matched.
 * @returns True when the prefix covers the url.
 */
const matchesUrlPrefix = (prefix: string, href: string): boolean => {
  if (href === prefix) {
    return true
  }
  if (!href.startsWith(prefix)) {
    return false
  }
  return prefix.endsWith('/') || '/?#'.includes(href.charAt(prefix.length))
}

/**
 * Decides whether a single matcher covers a url.
 * @param matcher - The matcher to apply.
 * @param ctx - The url being matched.
 * @returns True when the matcher covers the url.
 */
export const matcherMatchesUrl = (
  matcher: UrlMatcher,
  ctx: UrlMatchContext,
): boolean => {
  switch (matcher.type) {
    case 'BaseDomain': {
      const value = normaliseHostname(matcher.value)
      if (value.length === 0) {
        return false
      }
      // A dot boundary is what stops github.com matching github.com.evil.com.
      return ctx.hostname === value || ctx.hostname.endsWith(`.${value}`)
    }
    case 'Host':
      return ctx.hostname === normaliseHostname(matcher.value)
    case 'Origin':
      return ctx.origin === normaliseOrigin(matcher.value)
    case 'UrlPrefix':
      return matchesUrlPrefix(matcher.value, ctx.href)
    case 'Regex': {
      if (ctx.href.length > MAX_MATCHABLE_URL_LENGTH) {
        return false
      }
      // User-authored regexes run synchronously, without a time limit. A
      // pathological pattern can block the calling thread; RegExp.test cannot
      // be interrupted once it starts.
      return compileMatcherRegex(matcher.value)?.test(ctx.href) ?? false
    }
    default:
      return false
  }
}

/**
 * Finds the matcher that makes an entry belong to a url.
 *
 * When several of an entry's matchers cover the url, the most specific one
 * wins rather than the first. An entry carrying both `github.com` and
 * `https://github.com/login` should report the login-page match on the login
 * page: it is the better thing to show the user, and it is what ranks the
 * entry correctly against the others. Ties keep the order the user chose.
 * @param matchers - The entry's matchers, in the order the user put them.
 * @param ctx - The url being matched.
 * @returns The most specific matcher covering the url, or null when none does.
 */
export const findMatcherForUrl = (
  matchers: UrlMatcher[],
  ctx: UrlMatchContext,
): UrlMatcher | null => {
  let best: UrlMatcher | null = null

  for (const matcher of matchers) {
    if (!matcherMatchesUrl(matcher, ctx)) {
      continue
    }
    if (
      best === null ||
      MATCHER_SPECIFICITY[matcher.type] > MATCHER_SPECIFICITY[best.type] ||
      (MATCHER_SPECIFICITY[matcher.type] === MATCHER_SPECIFICITY[best.type] &&
        matcher.value.length > best.value.length)
    ) {
      best = matcher
    }
  }

  return best
}

/**
 * Proposes the matchers to attach to an entry for a given site.
 *
 * The suggestion is the full hostname, which is always safe: it can be
 * narrower than the user wanted, never broader. Narrowing `www.bbc.co.uk` to
 * `bbc.co.uk` would need a public suffix list, which the lib deliberately does
 * not carry; a consumer that wants it can offer a better default itself.
 * @param url - The url to suggest matchers for.
 * @returns The suggested matchers, or an empty array for an unmatchable url.
 */
export const suggestMatchersForUrl = (url: string): UrlMatcher[] => {
  const ctx = buildUrlMatchContext(url)
  if (!ctx || ctx.hostname.length === 0) {
    return []
  }
  return [{ type: 'BaseDomain', value: ctx.hostname }]
}
