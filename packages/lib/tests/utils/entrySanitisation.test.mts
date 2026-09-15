import { describe, it, expect } from 'vitest'

import type Entry from '../../src/interfaces/Entry.mjs'
import { sanitiseEntry } from '../../src/utils/entrySanitisation.mjs'
import {
  MAX_INPUT_SELECTOR_LENGTH,
  MAX_MATCHERS_PER_ENTRY,
  MAX_MATCHER_VALUE_LENGTH,
  MAX_URL_LENGTH,
} from '../../src/utils/matcherValidation.mjs'

/**
 * Builds an entry with the given overrides, bypassing the types so the
 * sanitiser can be fed the junk a peer might actually send.
 * @param overrides - The fields to override.
 * @returns The entry.
 */
const entryWith = (overrides: Record<string, unknown>): Entry =>
  ({
    id: '0000',
    name: 'Test',
    issuer: 'Test Issuer',
    type: 'TOTP',
    matchers: [],
    url: null,
    inputSelector: null,
    addedAt: 1,
    updatedAt: null,
    payload: {
      secret: 'TESTSECRET',
      period: 30,
      algorithm: 'SHA-1',
      digits: 6,
    },
    ...overrides,
  }) as unknown as Entry

describe('sanitiseEntry', () => {
  it('leaves a well-formed entry alone', () => {
    const entry = entryWith({
      matchers: [{ type: 'BaseDomain', value: 'github.com' }],
      url: 'https://github.com/login',
      inputSelector: '#otp',
    })
    expect(sanitiseEntry(entry)).toEqual(entry)
  })

  it('is idempotent', () => {
    const entry = entryWith({
      matchers: [
        { type: 'Nope', value: 'x' },
        { type: 'Host', value: 'a.com' },
      ],
      url: 'x'.repeat(MAX_URL_LENGTH + 1),
    })
    const once = sanitiseEntry(entry)
    expect(sanitiseEntry(once)).toEqual(once)
  })

  it('drops matchers that are not usable, without throwing', () => {
    const entry = entryWith({
      matchers: [
        null,
        'nope',
        {},
        { type: 'Nope', value: 'x' },
        { type: 'Host', value: '' },
        { type: 'Host' },
        { type: 'Regex', value: '(' },
        { type: 'Regex', value: '(a+)+' },
        { type: 'Host', value: 'x'.repeat(MAX_MATCHER_VALUE_LENGTH + 1) },
        { type: 'Host', value: 'keep.me' },
      ],
    })
    expect(sanitiseEntry(entry).matchers).toEqual([
      { type: 'Host', value: 'keep.me' },
    ])
  })

  it('replaces a matchers value that is not an array', () => {
    expect(sanitiseEntry(entryWith({ matchers: 'nope' })).matchers).toEqual([])
    expect(sanitiseEntry(entryWith({ matchers: undefined })).matchers).toEqual(
      [],
    )
    expect(sanitiseEntry(entryWith({ matchers: null })).matchers).toEqual([])
  })

  it('strips properties the matcher should not carry', () => {
    const entry = entryWith({
      matchers: [{ type: 'Host', value: 'a.com', evil: 'payload' }],
    })
    expect(sanitiseEntry(entry).matchers[0]).toEqual({
      type: 'Host',
      value: 'a.com',
    })
  })

  it('truncates an over-long matcher list', () => {
    const entry = entryWith({
      matchers: Array.from({ length: MAX_MATCHERS_PER_ENTRY + 4 }, (_, i) => ({
        type: 'Host',
        value: `host-${i}.com`,
      })),
    })
    expect(sanitiseEntry(entry).matchers).toHaveLength(MAX_MATCHERS_PER_ENTRY)
  })

  it('drops a url that is unusable', () => {
    expect(sanitiseEntry(entryWith({ url: 'https://ok.com' })).url).toBe(
      'https://ok.com',
    )
    expect(sanitiseEntry(entryWith({ url: '' })).url).toBeNull()
    expect(sanitiseEntry(entryWith({ url: 42 })).url).toBeNull()
    expect(
      sanitiseEntry(entryWith({ url: 'x'.repeat(MAX_URL_LENGTH + 1) })).url,
    ).toBeNull()
  })

  it('drops an input selector that is unusable', () => {
    expect(
      sanitiseEntry(entryWith({ inputSelector: '#otp' })).inputSelector,
    ).toBe('#otp')
    expect(
      sanitiseEntry(entryWith({ inputSelector: '#otp\nbody' })).inputSelector,
    ).toBeNull()
    expect(
      sanitiseEntry(entryWith({ inputSelector: '#otp\r' })).inputSelector,
    ).toBeNull()
    expect(
      sanitiseEntry(
        entryWith({
          inputSelector: 'x'.repeat(MAX_INPUT_SELECTOR_LENGTH + 1),
        }),
      ).inputSelector,
    ).toBeNull()
  })

  it('leaves the rest of the entry untouched', () => {
    const sanitised = sanitiseEntry(entryWith({ matchers: 'nope' }))
    expect(sanitised.id).toBe('0000')
    expect(sanitised.name).toBe('Test')
    expect(sanitised.payload.secret).toBe('TESTSECRET')
  })
})
