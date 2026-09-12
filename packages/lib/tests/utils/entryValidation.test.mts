import { describe, it, expect } from 'vitest'

import {
  validateEntryFatal,
  validateEntryStrict,
} from '../../src/utils/entryValidation.mjs'
import {
  MAX_MATCHERS_PER_ENTRY,
  MAX_REGEX_SOURCE_LENGTH,
  MAX_URL_LENGTH,
} from '../../src/utils/matcherValidation.mjs'

const validEntry = {
  id: '0000',
  name: 'Test',
  issuer: 'Test Issuer',
  type: 'TOTP',
  matchers: [{ type: 'BaseDomain', value: 'github.com' }],
  url: 'https://github.com/login',
  inputSelector: '#otp',
  addedAt: 1,
  updatedAt: null,
  payload: {
    secret: 'TESTSECRET',
    period: 30,
    algorithm: 'SHA-1',
    digits: 6,
  },
}

/**
 * Builds an entry with the given overrides.
 * @param overrides - The fields to override.
 * @returns The entry.
 */
const entryWith = (overrides: Record<string, unknown>): unknown => ({
  ...validEntry,
  ...overrides,
})

describe('validateEntryFatal', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntryFatal(validEntry)).toBeNull()
  })

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['a missing id', entryWith({ id: undefined })],
    ['an empty id', entryWith({ id: '' })],
    ['a non-string name', entryWith({ name: 42 })],
    ['an empty issuer', entryWith({ issuer: '' })],
    ['no type', entryWith({ type: '' })],
    ['no payload', entryWith({ payload: undefined })],
    [
      'no secret',
      entryWith({ payload: { ...validEntry.payload, secret: '' } }),
    ],
    [
      'zero digits',
      entryWith({ payload: { ...validEntry.payload, digits: 0 } }),
    ],
    [
      'fractional digits',
      entryWith({ payload: { ...validEntry.payload, digits: 6.5 } }),
    ],
    [
      'a period out of range',
      entryWith({ payload: { ...validEntry.payload, period: 0 } }),
    ],
    [
      'no algorithm',
      entryWith({ payload: { ...validEntry.payload, algorithm: '' } }),
    ],
    ['no addedAt', entryWith({ addedAt: undefined })],
    ['an infinite addedAt', entryWith({ addedAt: Infinity })],
    ['a non-numeric updatedAt', entryWith({ updatedAt: 'yesterday' })],
    ['matchers that are not an array', entryWith({ matchers: 'nope' })],
  ])('rejects an entry with %s', (_label, entry) => {
    expect(validateEntryFatal(entry)).not.toBeNull()
  })

  it('accepts an unknown algorithm, so a newer peer is not vaporised', () => {
    expect(
      validateEntryFatal(
        entryWith({ payload: { ...validEntry.payload, algorithm: 'SHA-3' } }),
      ),
    ).toBeNull()
  })

  it.each([
    ['an unknown matcher type', [{ type: 'Nope', value: 'x' }]],
    ['a matcher with no value', [{ type: 'Host', value: '' }]],
    ['a backtracking regex', [{ type: 'Regex', value: '(a+)+' }]],
    ['junk in the list', [null, 'nope', {}]],
  ])(
    'accepts and repairs %s rather than losing the entry',
    (_label, matchers) => {
      // A remote command that throws is dropped and never retried, so these are
      // the sanitiser's problem, not a reason to reject.
      expect(validateEntryFatal(entryWith({ matchers }))).toBeNull()
    },
  )

  it('accepts an entry with no matchers at all', () => {
    expect(validateEntryFatal(entryWith({ matchers: undefined }))).toBeNull()
  })
})

describe('validateEntryStrict', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntryStrict(validEntry)).toBeNull()
  })

  it('inherits every fatal check', () => {
    expect(validateEntryStrict(entryWith({ id: '' }))).not.toBeNull()
  })

  it.each([
    ['an unknown matcher type', [{ type: 'Nope', value: 'x' }]],
    ['a matcher with no value', [{ type: 'Host', value: '' }]],
    ['a backtracking regex', [{ type: 'Regex', value: '(a+)+' }]],
    ['a non-compiling regex', [{ type: 'Regex', value: '(' }]],
    [
      'an over-long regex',
      [{ type: 'Regex', value: 'a'.repeat(MAX_REGEX_SOURCE_LENGTH + 1) }],
    ],
  ])('rejects %s', (_label, matchers) => {
    expect(validateEntryStrict(entryWith({ matchers }))).not.toBeNull()
  })

  it('rejects too many matchers', () => {
    const matchers = Array.from(
      { length: MAX_MATCHERS_PER_ENTRY + 1 },
      (_, i) => ({ type: 'Host', value: `host-${i}.com` }),
    )
    expect(validateEntryStrict(entryWith({ matchers }))).not.toBeNull()
  })

  it('rejects an over-long url', () => {
    expect(
      validateEntryStrict(entryWith({ url: 'x'.repeat(MAX_URL_LENGTH + 1) })),
    ).not.toBeNull()
  })

  it('rejects an input selector containing a newline', () => {
    expect(
      validateEntryStrict(entryWith({ inputSelector: '#otp\nbody' })),
    ).not.toBeNull()
  })

  it('accepts null url and inputSelector', () => {
    expect(
      validateEntryStrict(entryWith({ url: null, inputSelector: null })),
    ).toBeNull()
  })
})
