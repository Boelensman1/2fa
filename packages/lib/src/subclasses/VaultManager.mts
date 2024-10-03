import { TOTP } from 'totp-generator'
import { v4 as genUuidV4 } from 'uuid'

import type Entry from '../interfaces/Entry.js'
import type { EntryId, EntryMeta, NewEntry } from '../interfaces/Entry.js'

import { EntryNotFoundError, TokenGenerationError } from '../TwoFALibError.mjs'

import {
  SUPPORTED_ALGORITHMS,
  SupportedAlgorithmsType,
} from '../utils/constants.mjs'

import type PersistentStorageManager from './PersistentStorageManager.mjs'
import { Vault } from '../interfaces/Vault.js'

const getMetaForEntry = (entry: Entry) => ({
  id: entry.id,
  name: entry.name,
  issuer: entry.issuer,
  type: entry.type,
  order: entry.order,
  addedAt: entry.addedAt,
  updatedAt: entry.updatedAt,
})

class VaultManager {
  private vault: Vault = []

  constructor(private persistentStorageManager: PersistentStorageManager) {}

  /**
   * Retrieve metadata for a specific entry.
   * @param entryId - The unique identifier of the entry.
   * @returns The entry's metadata.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  getEntryMeta(entryId: EntryId): EntryMeta {
    const entry = this.vault.find((e) => e.id === entryId)
    if (!entry) throw new EntryNotFoundError('Entry not found')
    return getMetaForEntry(entry)
  }

  /**
   * Search for entries matching the provided query.
   * @param query - The search query string.
   * @returns An array of matching entry IDs.
   */
  searchEntries(query: string): EntryId[] {
    const lowercaseQuery = query.toLowerCase()
    return this.vault
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowercaseQuery) ||
          entry.issuer.toLowerCase().includes(lowercaseQuery),
      )
      .map((entry) => entry.id)
  }

  /**
   * Search for entries matching the provided query.
   * @param query - The search query string.
   * @returns An array of matching entry metas.
   */
  searchEntriesMetas(query: string): EntryMeta[] {
    const lowercaseQuery = query.toLowerCase()
    return this.vault
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowercaseQuery) ||
          entry.issuer.toLowerCase().includes(lowercaseQuery),
      )
      .map((entry) => getMetaForEntry(entry))
  }

  /**
   * Retrieve a list of all entry IDs in the library.
   * @returns An array of all entry IDs.
   */
  listEntries(): EntryId[] {
    return this.vault.map((entry) => entry.id)
  }

  /**
   * Retrieve a list of all entry metas in the library.
   * @returns An array of all entry metas.
   */
  listEntriesMetas(): EntryMeta[] {
    return this.vault.map((entry) => getMetaForEntry(entry))
  }

  /**
   * Generate a time-based one-time password (TOTP) for a specific entry.
   * @param id - The unique identifier of the entry.
   * @param timestamp - Optional timestamp to use for token generation (default is current time).
   * @returns An object containing the token and between which timestamps it is valid
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {TokenGenerationError} If token generation fails due to invalid entry data or technical issues.
   */
  generateTokenForEntry(
    id: EntryId,
    timestamp?: number,
  ): { validFrom: number; validTill: number; otp: string } {
    const entry = this.vault.find((e) => e.id === id)
    if (!entry || entry.type !== 'TOTP') {
      throw new EntryNotFoundError('TOTP entry not found')
    }

    const { secret, period, algorithm, digits } = entry.payload

    if (!SUPPORTED_ALGORITHMS.includes(algorithm as SupportedAlgorithmsType)) {
      throw new TokenGenerationError(`Algorithm ${algorithm} is not supported`)
    }

    const totpOptions = {
      digits,
      period,
      algorithm: algorithm as SupportedAlgorithmsType,
      timestamp: timestamp ?? Date.now(),
    }

    const { otp, expires } = TOTP.generate(secret, totpOptions)
    return { otp, validFrom: expires - period * 1000, validTill: expires }
  }

  /**
   * Add a new entry to the library.
   * @param entry - The entry data to add (without an ID, as it will be generated).
   * @returns A promise that resolves to the newly generated EntryId.
   * @throws {InvalidInputError} If the provided entry data is invalid or incomplete.
   */
  async addEntry(entry: NewEntry): Promise<EntryId> {
    const newId = genUuidV4() as EntryId
    const newEntry: Entry = {
      ...entry,
      id: newId,
      order: entry.order ?? 0,
      addedAt: Date.now(),
      updatedAt: null,
    }
    this.vault.push(newEntry)

    this.persistentStorageManager.__updateWasChangedSinceLastSave([
      'lockedRepresentation',
    ])

    await this.persistentStorageManager.save()

    return newId
  }

  /**
   * Delete an existing entry from the library.
   * @param entryId - The unique identifier of the entry to delete.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  async deleteEntry(entryId: EntryId): Promise<void> {
    const index = this.vault.findIndex((e) => e.id === entryId)
    if (index === -1) throw new EntryNotFoundError('Entry not found')
    this.vault.splice(index, 1)

    this.persistentStorageManager.__updateWasChangedSinceLastSave([
      'lockedRepresentation',
    ])
    await this.persistentStorageManager.save()
  }

  /**
   * Update an existing entry in the library.
   * @param id - The unique identifier of the entry to update.
   * @param updates - An object containing the fields to update and their new values.
   * @returns A promise that resolves to the updated entry's metadata.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {InvalidInputError} If the update data is invalid or would result in an invalid entry.
   */
  async updateEntry(
    id: EntryId,
    updates: Partial<Omit<Entry, 'id'>>,
  ): Promise<EntryMeta> {
    const index = this.vault.findIndex((e) => e.id === id)
    if (index === -1) throw new EntryNotFoundError('Entry not found')

    this.vault[index] = { ...this.vault[index], ...updates, id }

    this.persistentStorageManager.__updateWasChangedSinceLastSave([
      'lockedRepresentation',
    ])
    await this.persistentStorageManager.save()

    return this.getEntryMeta(id)
  }

  replaceVault(newVault: Vault) {
    this.vault = newVault
  }

  __getEntriesForExport() {
    return this.vault
  }
}

export default VaultManager
