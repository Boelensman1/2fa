import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'

import AutofillOfferRegistry from '../../lib/ioc/entities/AutofillOfferRegistry'
import type { EntryId } from 'favalib'
import type { ListedEntry } from '../../lib/types/VaultState'

const entry = (id: string): ListedEntry => ({
  id: id as EntryId,
  issuer: 'GitHub',
  name: 'frank@appeal.nl',
  url: null,
  matchers: [],
  matchedBy: null,
})

const anOffer = (
  over: Partial<Parameters<AutofillOfferRegistry['open']>[0]>,
) => ({
  tabId: 1,
  frameId: 0,
  url: 'https://github.com/login',
  fieldId: 'otp-1',
  entries: [entry('a')],
  ...over,
})

let registry: AutofillOfferRegistry

beforeEach(() => {
  registry = new AutofillOfferRegistry()
})

describe('AutofillOfferRegistry', () => {
  it('resolves a token back to its offer', () => {
    const opened = registry.open(anOffer({}))

    expect(registry.resolve(opened.token, 1)).toMatchObject({
      frameId: 0,
      fieldId: 'otp-1',
      url: 'https://github.com/login',
    })
  })

  it('mints an unguessable token, not a counter', () => {
    const first = registry.open(anOffer({ tabId: 1 }))
    const second = registry.open(anOffer({ tabId: 2 }))

    expect(first.token).not.toBe(second.token)
    // A hostile page can frame the menu url itself, so a sequential handle
    // would be a two-digit guess away from another tab's entry list.
    expect(first.token).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number(first.token)).toBeNaN()
  })

  /**
   * Focus moving from a field in one frame to a field in another: the second
   * frame's open can land before the first frame's close. One offer per tab
   * makes the newer one win regardless of arrival order.
   */
  it('keeps only the newest offer for a tab', () => {
    const first = registry.open(anOffer({ frameId: 0, fieldId: 'otp-1' }))
    const second = registry.open(anOffer({ frameId: 3, fieldId: 'otp-9' }))

    expect(registry.resolve(first.token, 1)).toBeNull()
    expect(registry.resolve(second.token, 1)?.frameId).toBe(3)
  })

  it('does not let a stale close drop the current offer', () => {
    const first = registry.open(anOffer({}))
    const second = registry.open(anOffer({}))

    registry.close(first.token, 1)

    expect(registry.resolve(second.token, 1)).not.toBeNull()
  })

  it('forgets a closed tab', () => {
    const opened = registry.open(anOffer({}))

    registry.forgetTab(1)

    expect(registry.resolve(opened.token, 1)).toBeNull()
  })

  it('forgets everything when the vault locks', () => {
    const one = registry.open(anOffer({ tabId: 1 }))
    const two = registry.open(anOffer({ tabId: 2 }))

    registry.forgetAll()

    expect(registry.resolve(one.token, 1)).toBeNull()
    expect(registry.resolve(two.token, 2)).toBeNull()
  })

  it('carries the entries a fill is allowed to use', () => {
    const opened = registry.open(anOffer({ entries: [entry('a'), entry('b')] }))

    const resolved = registry.resolve(opened.token, 1)

    expect(resolved?.entries.map((item) => item.id)).toEqual(['a', 'b'])
  })
})
