import { describe, it, expect } from 'vitest'

import type { UrlMatcher } from '../../src/interfaces/Entry.mjs'
import { parseMatcherSpec } from '../../src/utils/matcherValidation.mjs'

describe('parseMatcherSpec', () => {
  it.each<UrlMatcher>([
    { type: 'UrlPrefix', value: 'https://example.com/a%2Fb' },
    { type: 'UrlPrefix', value: 'https://example.com/a%25b' },
    { type: 'UrlPrefix', value: 'https://example.com/a%b' },
    { type: 'UrlPrefix', value: 'https://example.com/a+b' },
    { type: 'Regex', value: String.raw`https://example\.com/\d+%2F\w+` },
  ])('preserves the literal value of $type:$value', (matcher) => {
    expect(parseMatcherSpec(`${matcher.type}:${matcher.value}`)).toEqual(
      matcher,
    )
  })

  it.each(['Host', ':example.com', 'Host:', 'Nope:example.com', 'Regex:('])(
    'rejects an invalid spec: %s',
    (spec) => {
      expect(parseMatcherSpec(spec)).toBeNull()
    },
  )
})
