import type Entry from '../interfaces/Entry.mjs'
import type {
  EntryId,
  EntryMeta,
  EntryMetaWithToken,
  NewEntry,
  Token,
} from '../interfaces/Entry.mjs'

import type FavaLibMediator from '../FavaLibMediator.mjs'

import AddEntryCommand from '../Command/commands/AddEntryCommand.mjs'
import DeleteEntryCommand from '../Command/commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand from '../Command/commands/UpdateEntryCommand.mjs'
import { EntryNotFoundError } from '../FavaLibError.mjs'

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
class VaultOperationsManager {
  private get platformProviders() {
    return this.mediator.getComponent('libraryLoader').getPlatformProviders()
  }

  /**
   * Constructs a new instance of VaultManager.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: FavaLibMediator) {}

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
   * @param includeTokens - When true, includes current tokens with the metas.
   * @returns An array of matching entry metas, optionally with tokens.
   */
  searchEntriesMetas(query: string, includeTokens: true): EntryMetaWithToken[]
  /**
   * @inheritdoc
   */
  searchEntriesMetas(query: string, includeTokens?: false): EntryMeta[]
  /**
   * @inheritdoc
   */
  searchEntriesMetas(
    query: string,
    includeTokens?: boolean,
  ): (EntryMeta & { token?: Token })[] {
    const lowercaseQuery = query.toLowerCase()
    const entries = this.vaultDataManager.getAllEntries()
    return entries
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowercaseQuery) ||
          entry.issuer.toLowerCase().includes(lowercaseQuery),
      )
      .map((entry) => {
        const meta = getMetaForEntry(entry)
        if (includeTokens) {
          return {
            ...meta,
            token: this.generateTokenForEntry(entry.id),
          }
        }
        return meta
      })
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
   * @param includeTokens - When true, includes current tokens with the metas.
   * @returns An array of all entry metas, optionally with tokens.
   */
  listEntriesMetas(includeTokens: true): EntryMetaWithToken[]
  /**
   * @inheritdoc
   */
  listEntriesMetas(includeTokens?: false): EntryMeta[]
  /**
   * @inheritdoc
   */
  listEntriesMetas(includeTokens?: boolean): (EntryMeta & { token?: Token })[] {
    const entries = this.vaultDataManager.getAllEntries()
    return entries.map((entry) => {
      const meta = getMetaForEntry(entry)
      if (includeTokens) {
        return {
          ...meta,
          token: this.generateTokenForEntry(entry.id),
        }
      }
      return meta
    })
  }

  /**
   * Generate a time-based one-time password (TOTP) for a specific entry.
   * @param id - The unique identifier of the entry.
   * @param timestamp - Optional timestamp to use for token generation (default is current time).
   * @returns An object containing the token and between which timestamps it is valid
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {TokenGenerationError} If token generation fails due to invalid entry data or technical issues.
   */
  generateTokenForEntry(id: EntryId, timestamp?: number): Token {
    return this.vaultDataManager.generateTokenForEntry(id, timestamp)
  }

  /**
   * Add a new entry to the library.
   * @param entry - The entry data to add (without an ID, as it will be generated).
   * @returns A promise that resolves to the newly generated EntryId.
   * @throws {InvalidCommandError} If the provided entry data is invalid or incomplete.
   */
  async addEntry(entry: NewEntry): Promise<EntryId> {
    const newId = this.platformProviders.genUuidV4() as EntryId
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

export default VaultOperationsManager
