import { v4 as genUuidV4 } from 'uuid'

import type Entry from '../interfaces/Entry.mjs'
import type { EntryId, EntryMeta, NewEntry } from '../interfaces/Entry.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'

import AddEntryCommand from '../Command/commands/AddEntryCommand.mjs'
import DeleteEntryCommand from '../Command/commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand from '../Command/commands/UpdateEntryCommand.mjs'
import { EntryNotFoundError } from '../TwoFALibError.mjs'

const getMetaForEntry = (entry: Entry) => ({
  id: entry.id,
  name: entry.name,
  issuer: entry.issuer,
  type: entry.type,
  addedAt: entry.addedAt,
  updatedAt: entry.updatedAt,
})

/**
 * Manages the public operations related to the vault, including adding, deleting, and updating entries.
 */
class VaultManager {
  /**
   * Constructs a new instance of VaultManager.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: TwoFaLibMediator) {}

  private get exportImportManager() {
    return this.mediator.getComponent('exportImportManager')
  }
  private get vaultDataManager() {
    return this.mediator.getComponent('vaultDataManager')
  }
  private get commandManager() {
    return this.mediator.getComponent('commandManager')
  }

  /**
   * @returns The number of entries in the vault.
   */
  get size() {
    return this.vaultDataManager.size
  }

  /**
   * Retrieve metadata for a specific entry.
   * @param entryId - The ID of the entry.
   * @returns The entry's metadata.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  getEntryMeta(entryId: EntryId): EntryMeta {
    return getMetaForEntry(this.vaultDataManager.getFullEntry(entryId))
  }

  /**
   * Search for entry ids matching the provided query.
   * @param query - The search query string.
   * @returns An array of matching entry IDs.
   */
  searchEntries(query: string): EntryId[] {
    const lowercaseQuery = query.toLowerCase()
    const entries = this.vaultDataManager.getAllEntries()
    return entries
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
    const entries = this.vaultDataManager.getAllEntries()
    return entries
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
    return this.vaultDataManager.getAllEntries().map((entry) => entry.id)
  }

  /**
   * Retrieve a list of all entry metas in the library.
   * @returns An array of all entry metas.
   */
  listEntriesMetas(): EntryMeta[] {
    const entries = this.vaultDataManager.getAllEntries()
    return entries.map((entry) => getMetaForEntry(entry))
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
    return this.vaultDataManager.generateTokenForEntry(id, timestamp)
  }

  /**
   * Add a new entry to the library.
   * @param entry - The entry data to add (without an ID, as it will be generated).
   * @returns A promise that resolves to the newly generated EntryId.
   * @throws {InvalidCommandError} If the provided entry data is invalid or incomplete.
   */
  async addEntry(entry: NewEntry): Promise<EntryId> {
    const newId = genUuidV4() as EntryId
    const newEntry: Entry = {
      ...entry,
      id: newId,
      addedAt: Date.now(),
      updatedAt: null,
    }
    const command = AddEntryCommand.create(newEntry)
    await this.commandManager.execute(command)

    return newId
  }

  /**
   * Add a new entry to the library via qr code. Is identical to calling exportImport.importFromQRCode
   * @param imageInput - The image containing the QR code
   * @returns A promise that resolves to the newly generated EntryId.
   * @throws {InvalidCommandError} If the provided entry data is invalid or incomplete.
   */
  async addEntryFromQRCode(
    imageInput: string | File | Uint8Array,
  ): Promise<EntryId> {
    return this.exportImportManager.importFromQRCode(imageInput)
  }

  /**
   * Delete an existing entry from the library.
   * @param entryId - The unique identifier of the entry to delete.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  async deleteEntry(entryId: EntryId): Promise<void> {
    const command = DeleteEntryCommand.create({ entryId })
    await this.commandManager.execute(command)
  }

  /**
   * Update an existing entry in the library.
   * @param entryId - The unique identifier of the entry to update.
   * @param updates - An object containing the fields to update and their new values.
   * @returns A promise that resolves to the updated entry's metadata.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {InvalidCommandError} If the update data is invalid or would result in an invalid entry.
   */
  async updateEntry(
    entryId: EntryId,
    updates: Partial<Omit<Entry, 'id'>>,
  ): Promise<EntryMeta> {
    if (Object.keys(updates).includes('id')) {
      throw new EntryNotFoundError("Can't update id")
    }
    const oldEntry = this.vaultDataManager.getFullEntry(entryId)

    const updatedEntry = { ...oldEntry, ...updates }

    const command = UpdateEntryCommand.create({
      entryId,
      oldEntry,
      updatedEntry,
    })
    await this.commandManager.execute(command)

    return getMetaForEntry(updatedEntry)
  }
}

export default VaultManager
