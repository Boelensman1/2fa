import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'

import {
  EntryNotFoundError,
  FavaLibEvent,
  type EntryId,
  type NewEntry,
  type FavaLib,
} from '../../src/main.mjs'
import type FavaLibMediator from '../../src/FavaLibMediator.mjs'

import {
  anotherNewTotpEntry,
  matcherNewTotpEntry,
  newTotpEntry,
  totpEntry,
  clearEntries,
  createFavaLibForTests,
  omit,
} from '../testUtils.mjs'

describe('VaultManager', () => {
  let favaLib: FavaLib

  beforeAll(async () => {
    favaLib = (await createFavaLibForTests()).favaLib
  })

  beforeEach(async () => {
    await clearEntries(favaLib)
  })

  it('should add and retrieve a Entry', async () => {
    const entryId = await favaLib.vault.addEntry(newTotpEntry)
    const retrieved = favaLib.vault.getEntryMeta(entryId)

    expect(retrieved).toEqual(
      omit(
        {
          ...newTotpEntry,
          matchers: [],
          url: null,
          inputSelector: null,
          id: entryId,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
        },
        'payload',
      ),
    )
  })

  it('should generate an otp', async () => {
    const id = await favaLib.vault.addEntry(newTotpEntry)
    const otp = await favaLib.vault.generateTokenForEntry(
      id,
      new Date(0).getTime(),
    )

    expect(otp).toEqual({
      otp: '810290',
      validFrom: 0,
      validTill: newTotpEntry.payload.period * 1000,
    })
  })

  it('should get all Entries', async () => {
    const totpEntry2: NewEntry = {
      ...newTotpEntry,
      payload: { ...newTotpEntry.payload, secret: 'Secret2' },
    }

    const id1 = await favaLib.vault.addEntry(newTotpEntry)
    const id2 = await favaLib.vault.addEntry(totpEntry2)

    const allEntries = favaLib.vault.listEntries()
    expect(allEntries).toHaveLength(2)
    expect(allEntries[0]).toEqual(id1)
    expect(allEntries[1]).toEqual(id2)
  })

  it('should delete a Entry', async () => {
    const id = await favaLib.vault.addEntry(newTotpEntry)
    expect(favaLib.vault.listEntries()).toHaveLength(1)

    await favaLib.vault.deleteEntry(id)
    expect(favaLib.vault.listEntries()).toHaveLength(0)
  })

  it('should throw an error when getting a non-existent Entry', () => {
    expect(() => favaLib.vault.getEntryMeta('non-existing' as EntryId)).toThrow(
      'Entry not found',
    )
  })

  it('should throw an error when deleting a non-existent Entry', async () => {
    await expect(() =>
      favaLib.vault.deleteEntry('non-existing' as EntryId),
    ).rejects.toThrow('Entry not found')
  })

  it('should update an existing entry', async () => {
    const entryId = await favaLib.vault.addEntry(newTotpEntry)
    const updatedEntry = {
      ...newTotpEntry,
      name: 'Updated TOTP',
      issuer: 'Updated Issuer',
    }

    const updated = await favaLib.vault.updateEntry(entryId, updatedEntry)

    expect(updated).toEqual(
      expect.objectContaining({
        id: entryId,
        name: 'Updated TOTP',
        issuer: 'Updated Issuer',
      }),
    )

    const retrieved = favaLib.vault.getEntryMeta(entryId)
    expect(retrieved).toEqual(updated)
  })

  it('should throw an error when updating a non-existent entry', async () => {
    await expect(
      favaLib.vault.updateEntry('non-existing' as EntryId, newTotpEntry),
    ).rejects.toThrow(EntryNotFoundError)
  })

  it.each([
    ['empty issuer', { issuer: '' }, { issuer: 'Repaired Issuer' }],
    ['oversized name', { name: 'x'.repeat(257) }, { name: 'Repaired Name' }],
  ])(
    'repairs an %s while rejecting invalid replacements',
    async (_label, historical, repair) => {
      const mediator = (favaLib as unknown as { mediator: FavaLibMediator })
        .mediator
      const vaultDataManager = mediator.getComponent('vaultDataManager')
      const legacyEntry = { ...totpEntry, ...historical }
      vaultDataManager.replaceVault([legacyEntry])

      await favaLib.vault.updateEntry(legacyEntry.id, repair)
      const repaired = favaLib.vault.getEntryMeta(legacyEntry.id)
      expect(repaired).toMatchObject(repair)

      await expect(
        favaLib.vault.updateEntry(legacyEntry.id, historical),
      ).rejects.toThrow(/Cannot update entry/)
    },
  )

  it('should search for entries', async () => {
    const id1 = await favaLib.vault.addEntry(newTotpEntry)
    const id2 = await favaLib.vault.addEntry(anotherNewTotpEntry)

    const searchResults = favaLib.vault.searchEntries('test')
    expect(searchResults).toContain(id1)
    expect(searchResults).not.toContain(id2)

    const anotherSearch = favaLib.vault.searchEntries('another')
    expect(anotherSearch).toContain(id2)
    expect(anotherSearch).not.toContain(id1)
  })

  it('should search for entry metas', async () => {
    const id1 = await favaLib.vault.addEntry(newTotpEntry)
    const id2 = await favaLib.vault.addEntry(anotherNewTotpEntry)

    const searchResults = favaLib.vault.searchEntriesMetas('test')
    expect(searchResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id1 })]),
    )
    expect(searchResults).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id2 })]),
    )

    const anotherSearch = favaLib.vault.searchEntriesMetas('another')
    expect(anotherSearch).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id2 })]),
    )
    expect(anotherSearch).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id1 })]),
    )
  })

  it('should list all entry metas', async () => {
    const id1 = await favaLib.vault.addEntry(newTotpEntry)
    const id2 = await favaLib.vault.addEntry(anotherNewTotpEntry)

    const allMetas = favaLib.vault.listEntriesMetas()
    expect(allMetas).toHaveLength(2)
    expect(allMetas[0]).toEqual(expect.objectContaining({ id: id1 }))
    expect(allMetas[1]).toEqual(expect.objectContaining({ id: id2 }))
  })

  it('should generate different OTPs for different timestamps', async () => {
    const entryId = await favaLib.vault.addEntry(newTotpEntry)
    const otp1 = await favaLib.vault.generateTokenForEntry(entryId, 0)
    const otp2 = await favaLib.vault.generateTokenForEntry(entryId, 30000) // 30 seconds later

    expect(otp1.otp).not.toEqual(otp2.otp)
    expect(otp1.validFrom).toBeLessThan(otp2.validFrom)
    expect(otp1.validTill).toBeLessThan(otp2.validTill)
  })

  it('should default the matching fields when they are not supplied', async () => {
    const entryId = await favaLib.vault.addEntry(newTotpEntry)
    const meta = favaLib.vault.getEntryMeta(entryId)

    expect(meta.matchers).toEqual([])
    expect(meta.url).toBeNull()
    expect(meta.inputSelector).toBeNull()
  })

  it("should hand out a copy of the matchers, not the vault's own array", async () => {
    const entryId = await favaLib.vault.addEntry(matcherNewTotpEntry)

    favaLib.vault.getEntryMeta(entryId).matchers.push({
      type: 'Host',
      value: 'injected.example',
    })

    expect(favaLib.vault.getEntryMeta(entryId).matchers).toHaveLength(2)
  })

  it('should set updatedAt when an entry is updated', async () => {
    const entryId = await favaLib.vault.addEntry(newTotpEntry)
    expect(favaLib.vault.getEntryMeta(entryId).updatedAt).toBeNull()

    const updated = await favaLib.vault.updateEntry(entryId, {
      name: 'Renamed',
    })

    expect(updated.updatedAt).toEqual(expect.any(Number))
    expect(favaLib.vault.getEntryMeta(entryId).updatedAt).toEqual(
      expect.any(Number),
    )
  })

  it('should refuse an entry carrying an unusable matcher', async () => {
    await expect(
      favaLib.vault.addEntry({
        ...newTotpEntry,
        matchers: [{ type: 'Regex', value: '(a+)+' }],
      }),
    ).rejects.toThrow(/backtracks unsafely/)
  })

  describe('findEntriesForUrl', () => {
    it('finds an entry by base domain, subdomains included', async () => {
      const entryId = await favaLib.vault.addEntry(matcherNewTotpEntry)

      expect(
        favaLib.vault.findEntriesForUrl('https://gist.github.com/x'),
      ).toEqual([entryId])
    })

    it('does not find a look-alike domain', async () => {
      await favaLib.vault.addEntry(matcherNewTotpEntry)

      expect(
        favaLib.vault.findEntriesForUrl('https://github.com.evil.com/'),
      ).toEqual([])
    })

    it('never returns an entry with no matchers', async () => {
      await favaLib.vault.addEntry(newTotpEntry)

      expect(favaLib.vault.findEntriesForUrl('https://github.com/')).toEqual([])
    })

    it('returns nothing for a url it cannot match against', async () => {
      await favaLib.vault.addEntry(matcherNewTotpEntry)

      expect(favaLib.vault.findEntriesForUrl('not a url')).toEqual([])
      expect(favaLib.vault.findEntriesForUrl('about:blank')).toEqual([])
      expect(
        favaLib.vault.findEntriesForUrl('chrome-extension://abc/popup.html'),
      ).toEqual([])
    })
  })

  describe('findEntryMetasForUrl', () => {
    it.each([false, true])(
      'returns detached matchers (includeTokens=%s)',
      async (includeTokens) => {
        const entryId = await favaLib.vault.addEntry(matcherNewTotpEntry)
        const url = 'https://gist.github.com/x'
        const matches = includeTokens
          ? await favaLib.vault.findEntryMetasForUrl(url, true)
          : favaLib.vault.findEntryMetasForUrl(url)

        matches[0].matchedBy.value = 'injected.example'
        matches[0].matchers[0].value = 'another.example'
        matches[0].matchers.push({ type: 'Regex', value: '.*' })

        expect(favaLib.vault.getEntryMeta(entryId).matchers).toEqual(
          matcherNewTotpEntry.matchers,
        )
        expect(favaLib.vault.findEntriesForUrl(url)).toEqual([entryId])
        expect(
          favaLib.vault.findEntriesForUrl('https://injected.example/'),
        ).toEqual([])
      },
    )

    it('reports which matcher fired', async () => {
      await favaLib.vault.addEntry(matcherNewTotpEntry)

      const [match] = favaLib.vault.findEntryMetasForUrl(
        'https://gist.github.com/x',
      )

      expect(match.matchedBy).toEqual({
        type: 'BaseDomain',
        value: 'github.com',
      })
    })

    it('ranks the most specific matcher first', async () => {
      const broadId = await favaLib.vault.addEntry({
        ...newTotpEntry,
        matchers: [{ type: 'BaseDomain', value: 'example.com' }],
      })
      const hostId = await favaLib.vault.addEntry({
        ...newTotpEntry,
        matchers: [{ type: 'Host', value: 'www.example.com' }],
      })
      const prefixId = await favaLib.vault.addEntry({
        ...newTotpEntry,
        matchers: [
          { type: 'UrlPrefix', value: 'https://www.example.com/login' },
        ],
      })

      expect(
        favaLib.vault.findEntriesForUrl('https://www.example.com/login/step2'),
      ).toEqual([prefixId, hostId, broadId])
    })

    it('breaks a tie between same-type matchers by value length', async () => {
      const shortId = await favaLib.vault.addEntry({
        ...newTotpEntry,
        matchers: [{ type: 'BaseDomain', value: 'example.com' }],
      })
      const longId = await favaLib.vault.addEntry({
        ...newTotpEntry,
        matchers: [{ type: 'BaseDomain', value: 'sso.example.com' }],
      })

      expect(
        favaLib.vault.findEntriesForUrl('https://sso.example.com/'),
      ).toEqual([longId, shortId])
    })

    it('includes tokens when asked', async () => {
      await favaLib.vault.addEntry(matcherNewTotpEntry)

      const matches = await favaLib.vault.findEntryMetasForUrl(
        'https://github.com/',
        true,
      )

      expect(matches).toHaveLength(1)
      expect(matches[0].token.otp).toHaveLength(6)
      expect(matches[0].matchedBy.type).toBe('BaseDomain')
    })

    it('resolves to an empty list for an unmatchable url', async () => {
      await favaLib.vault.addEntry(matcherNewTotpEntry)

      await expect(
        favaLib.vault.findEntryMetasForUrl('not a url', true),
      ).resolves.toEqual([])
    })
  })

  it('should emit changed event when data is changed', async () => {
    const listener = vi.fn()
    favaLib.addEventListener(FavaLibEvent.Changed, listener)
    await favaLib.vault.addEntry(newTotpEntry)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
