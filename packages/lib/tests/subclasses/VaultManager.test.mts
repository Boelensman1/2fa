import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import _ from 'lodash'

import {
  EntryNotFoundError,
  type EntryId,
  type NewEntry,
  type TwoFaLib,
} from '../../src/main.mjs'

import {
  anotherTotpEntry,
  totpEntry,
  clearEntries,
  createTwoFaLibForTests,
} from '../testUtils.js'

describe('VaultManager', () => {
  let twoFaLib: TwoFaLib

  beforeAll(async () => {
    twoFaLib = (await createTwoFaLibForTests()).twoFaLib
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  it('should add and retrieve a Entry', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)
    const retrieved = twoFaLib.vault.getEntryMeta(entryId)

    expect(retrieved).toEqual(
      _.omit(
        {
          ...totpEntry,
          id: entryId,
          order: 0,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
        },
        'payload',
      ),
    )
  })

  it('should generate an otp', async () => {
    const id = await twoFaLib.vault.addEntry(totpEntry)
    const otp = twoFaLib.vault.generateTokenForEntry(id, new Date(0).getTime())

    expect(otp).toEqual({
      otp: '810290',
      validFrom: 0,
      validTill: totpEntry.payload.period * 1000,
    })
  })

  it('should get all Entries', async () => {
    const totpEntry2: NewEntry = {
      ...totpEntry,
      payload: { ...totpEntry.payload, secret: 'Secret2' },
    }

    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(totpEntry2)

    const allEntries = twoFaLib.vault.listEntries()
    expect(allEntries).toHaveLength(2)
    expect(allEntries[0]).toEqual(id1)
    expect(allEntries[1]).toEqual(id2)
  })

  it('should delete a Entry', async () => {
    const id = await twoFaLib.vault.addEntry(totpEntry)
    expect(twoFaLib.vault.listEntries()).toHaveLength(1)

    await twoFaLib.vault.deleteEntry(id)
    expect(twoFaLib.vault.listEntries()).toHaveLength(0)
  })

  it('should throw an error when getting a non-existent Entry', () => {
    expect(() =>
      twoFaLib.vault.getEntryMeta('non-existing' as EntryId),
    ).toThrow('Entry not found')
  })

  it('should throw an error when deleting a non-existent Entry', async () => {
    await expect(() =>
      twoFaLib.vault.deleteEntry('non-existing' as EntryId),
    ).rejects.toThrow('Entry not found')
  })

  it('should update an existing entry', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)
    const updatedEntry = {
      ...totpEntry,
      name: 'Updated TOTP',
      issuer: 'Updated Issuer',
    }

    const updated = await twoFaLib.vault.updateEntry(entryId, updatedEntry)

    expect(updated).toEqual(
      expect.objectContaining({
        id: entryId,
        name: 'Updated TOTP',
        issuer: 'Updated Issuer',
      }),
    )

    const retrieved = twoFaLib.vault.getEntryMeta(entryId)
    expect(retrieved).toEqual(updated)
  })

  it('should throw an error when updating a non-existent entry', async () => {
    await expect(
      twoFaLib.vault.updateEntry('non-existing' as EntryId, totpEntry),
    ).rejects.toThrow(EntryNotFoundError)
  })

  it('should search for entries', async () => {
    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(anotherTotpEntry)

    const searchResults = twoFaLib.vault.searchEntries('test')
    expect(searchResults).toContain(id1)
    expect(searchResults).not.toContain(id2)

    const anotherSearch = twoFaLib.vault.searchEntries('another')
    expect(anotherSearch).toContain(id2)
    expect(anotherSearch).not.toContain(id1)
  })

  it('should search for entry metas', async () => {
    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(anotherTotpEntry)

    const searchResults = twoFaLib.vault.searchEntriesMetas('test')
    expect(searchResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id1 })]),
    )
    expect(searchResults).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id2 })]),
    )

    const anotherSearch = twoFaLib.vault.searchEntriesMetas('another')
    expect(anotherSearch).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id2 })]),
    )
    expect(anotherSearch).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id1 })]),
    )
  })

  it('should list all entry metas', async () => {
    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(anotherTotpEntry)

    const allMetas = twoFaLib.vault.listEntriesMetas()
    expect(allMetas).toHaveLength(2)
    expect(allMetas[0]).toEqual(expect.objectContaining({ id: id1 }))
    expect(allMetas[1]).toEqual(expect.objectContaining({ id: id2 }))
  })

  it('should generate different OTPs for different timestamps', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)
    const otp1 = twoFaLib.vault.generateTokenForEntry(entryId, 0)
    const otp2 = twoFaLib.vault.generateTokenForEntry(entryId, 30000) // 30 seconds later

    expect(otp1.otp).not.toEqual(otp2.otp)
    expect(otp1.validFrom).toBeLessThan(otp2.validFrom)
    expect(otp1.validTill).toBeLessThan(otp2.validTill)
  })
})
