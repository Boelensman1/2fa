import type { UrlMatcher, UrlMatcherType } from '../interfaces/Entry.mjs'
import { URL_MATCHER_TYPES } from '../interfaces/Entry.mjs'

/** The most matchers a single entry may carry. */
export const MAX_MATCHERS_PER_ENTRY = 16

/** The longest value any matcher may hold. */
export const MAX_MATCHER_VALUE_LENGTH = 512

/**
 * The longest regex source a `Regex` matcher may hold.
 *
 * Catastrophic backtracking needs both a pathological pattern and a long
 * subject. Capping the pattern bounds the constant factor.
 */
export const MAX_REGEX_SOURCE_LENGTH = 200

/**
 * Urls longer than this are not offered to `Regex` matchers.
 *
 * Backtracking blowup is superlinear in the length of the subject, so this is
 * the single highest-leverage limit. The cheaper matcher types still run.
 */
export const MAX_MATCHABLE_URL_LENGTH = 2048

/** The longest `url` an entry may hold. */
export const MAX_URL_LENGTH = 2048

/** The longest `inputSelector` an entry may hold. */
export const MAX_INPUT_SELECTOR_LENGTH = 256

/**
 * How long a single `findEntryMetasForUrl` call may spend on `Regex` matchers
 * before it stops evaluating the rest of them.
 *
 * This bounds a *set* of individually-slow regexes. It cannot interrupt one
 * catastrophic regex: javascript has no way to abort a `RegExp.test` that is
 * already running.
 */
export const REGEX_BUDGET_MS = 20

/** How many compiled regexes to keep around. */
const REGEX_CACHE_MAX_SIZE = 256

/**
 * A group whose body is itself quantified, with a quantifier applied to it:
 * `(a+)+`, `(.*)*`, `(\d{2,})+`. These are the classic catastrophic
 * backtracking shapes.
 */
const NESTED_QUANTIFIER = /\([^()]*[*+}][^()]*\)\s*(?:[*+]|\{\d+,\d*\})/

const regexCache = new Map<string, RegExp | null>()

/**
 * Narrows an unknown value to a known matcher type.
 * @param value - The value to check.
 * @returns True when the value is one of `URL_MATCHER_TYPES`.
 */
export const isUrlMatcherType = (value: unknown): value is UrlMatcherType =>
  typeof value === 'string' &&
  (URL_MATCHER_TYPES as readonly string[]).includes(value)

/**
 * Compiles the source of a `Regex` matcher, refusing sources that are too long
 * or that look like they backtrack catastrophically.
 *
 * The pattern is anchored as `^(?:<source>)$`. This is the most
 * security-relevant decision in matching: an unanchored matcher of `github`
 * would fire on `https://evil.com/?q=github`. The non-capturing group also
 * stops a top-level alternation (`a|.*`) from escaping the anchors.
 *
 * The nested-quantifier check is a heuristic, not a decision procedure. It
 * catches the shapes people copy and paste; `(a|aa)+` still slips through,
 * which is why the caller also caps the subject length and the time budget.
 * @param source - The regex source, as stored on the matcher.
 * @returns The compiled, anchored regex, or null when the source is refused.
 */
export const compileMatcherRegex = (source: string): RegExp | null => {
  const cached = regexCache.get(source)
  if (cached !== undefined) {
    return cached
  }

  let compiled: RegExp | null = null
  if (
    source.length > 0 &&
    source.length <= MAX_REGEX_SOURCE_LENGTH &&
    !NESTED_QUANTIFIER.test(source)
  ) {
    try {
      // No flags: `g` and `y` carry `lastIndex` across calls.
      compiled = new RegExp(`^(?:${source})$`)
    } catch {
      compiled = null
    }
  }

  if (regexCache.size >= REGEX_CACHE_MAX_SIZE) {
    const oldest = regexCache.keys().next()
    if (!oldest.done) {
      regexCache.delete(oldest.value)
    }
  }
  regexCache.set(source, compiled)

  return compiled
}

/**
 * Checks a single matcher.
 * @param matcher - The value to check, which may be anything at all.
 * @returns Null when the matcher is usable, otherwise the reason it is not.
 */
export const validateUrlMatcher = (matcher: unknown): string | null => {
  if (typeof matcher !== 'object' || matcher === null) {
    return 'matcher is not an object'
  }

  const { type, value } = matcher as Partial<UrlMatcher>

  if (!isUrlMatcherType(type)) {
    return `unknown matcher type "${String(type)}"`
  }
  if (typeof value !== 'string' || value.length === 0) {
    return `matcher of type "${type}" has no value`
  }
  if (value.length > MAX_MATCHER_VALUE_LENGTH) {
    return `matcher value exceeds ${MAX_MATCHER_VALUE_LENGTH} characters`
  }
  if (type === 'Regex' && compileMatcherRegex(value) === null) {
    return 'regex matcher is invalid, too long, or backtracks unsafely'
  }

  return null
}

/**
 * Parses the `TYPE:VALUE` spelling of a matcher, as used by the cli's
 * `--match` flag and by the `favaMatcher` otpauth parameter.
 *
 * Splits on the first colon only, so values containing colons (a `UrlPrefix`
 * of `https://example.com/login`, say) survive. The value is percent-decoded
 * when it can be, and taken verbatim when it cannot.
 * @param spec - The spec to parse.
 * @returns The matcher, or null when the spec is unusable.
 */
export const parseMatcherSpec = (spec: string): UrlMatcher | null => {
  const separator = spec.indexOf(':')
  if (separator < 1) {
    return null
  }

  const type = spec.slice(0, separator)
  const rawValue = spec.slice(separator + 1)

  let value: string
  try {
    value = decodeURIComponent(rawValue)
  } catch {
    value = rawValue
  }

  const matcher = { type, value } as UrlMatcher
  return validateUrlMatcher(matcher) === null ? matcher : null
}
