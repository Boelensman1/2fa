import type { LiteralUnion } from 'type-fest'

import type { Tagged } from 'type-fest'

export type EntryId = Tagged<string, 'TotpId'>

export type EntryType = LiteralUnion<'TOTP', string>

/**
 * The kinds of url matcher an entry can carry.
 *
 * A `const` array rather than a bare union: the browser app, the cli and the
 * extension all need these at runtime, to populate a dropdown and to check a
 * string that arrived over the wire.
 */
export const URL_MATCHER_TYPES = [
  'BaseDomain',
  'Host',
  'Origin',
  'UrlPrefix',
  'Regex',
] as const

export type UrlMatcherType = (typeof URL_MATCHER_TYPES)[number]

/**
 * A single rule deciding whether an entry belongs to a url.
 *
 * See `utils/urlMatching.mts` for the semantics of each type.
 */
export interface UrlMatcher {
  type: UrlMatcherType
  value: string
}

export interface EntryMeta {
  id: EntryId
  name: string
  issuer: string
  type: EntryType
  /** Ordered, first match wins. Empty means the entry is never autofilled. */
  matchers: UrlMatcher[]
  /** The canonical login url. Shown to the user, never used for matching. */
  url: string | null
  /** A css selector overriding the extension's otp-field heuristic. */
  inputSelector: string | null
  addedAt: number
  updatedAt: number | null
}

export interface TotpPayload {
  secret: string
  period: LiteralUnion<30 | 60, number>
  algorithm: LiteralUnion<'SHA-1' | 'SHA-256' | 'SHA-512', string>
  digits: LiteralUnion<6 | 8, number>
}

interface TotpEntry extends EntryMeta {
  type: 'TOTP'
  payload: TotpPayload
}

type Entry = TotpEntry

/**
 * An entry as a caller supplies it.
 *
 * The matching fields are optional purely as a convenience: `addEntry` fills in
 * the empty defaults, so callers that do not care about matching do not have to
 * carry the boilerplate.
 */
export type NewEntry = Omit<
  Entry,
  'id' | 'addedAt' | 'updatedAt' | 'matchers' | 'url' | 'inputSelector'
> &
  Partial<Pick<Entry, 'matchers' | 'url' | 'inputSelector'>>

export default Entry

export interface Token {
  validFrom: number
  validTill: number
  otp: string
}

export type EntryMetaWithToken = EntryMeta & { token: Token }

/** An entry meta, plus the matcher that made it match the url that was looked up. */
export type EntryMetaForUrl = EntryMeta & { matchedBy: UrlMatcher }

export type EntryMetaForUrlWithToken = EntryMetaForUrl & { token: Token }
