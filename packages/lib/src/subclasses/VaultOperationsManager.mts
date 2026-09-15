import type Entry from '../interfaces/Entry.mjs'
import type {
  EntryId,
  EntryMeta,
  EntryMetaForUrl,
  EntryMetaForUrlWithToken,
  EntryMetaWithToken,
  NewEntry,
  Token,
  UrlMatcher,
} from '../interfaces/Entry.mjs'

import type FavaLibMediator from '../FavaLibMediator.mjs'

import AddEntryCommand from '../Command/commands/AddEntryCommand.mjs'
import DeleteEntryCommand from '../Command/commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand from '../Command/commands/UpdateEntryCommand.mjs'
import { EntryNotFoundError, InvalidCommandError } from '../FavaLibError.mjs'
import { validateEntryStrict } from '../utils/entryValidation.mjs'
import {
  MATCHER_SPECIFICITY,
  buildUrlMatchContext,
  findMatcherForUrl,
} from '../utils/urlMatching.mjs'

const getMetaForEntry = (entry: Entry): EntryMeta => ({
  id: entry.id,
  name: entry.name,
  issuer: entry.issuer,
  type: entry.type,
  // Copied: this is the only non-primitive to leave the vault, and handing out
  // the live array would let a caller mutate vault state behind the commands.
  matchers: entry.matchers.map((matcher) => ({ ...matcher })),
  url: entry.url,
  inputSelector: entry.inputSelector,
  addedAt: entry.addedAt,
  updatedAt: entry.updatedAt,
})

/**
 * Ranks entries that all match the same url, most specific first, so a
 * consumer can preselect the best guess.
 * @param a - The first entry to compare.
 * @param b - The second entry to compare.
 * @returns A standard comparator result.
 */
const byMatchSpecificity = (a: EntryMetaForUrl, b: EntryMetaForUrl): number =>
  MATCHER_SPECIFICITY[b.matchedBy.type] -
    MATCHER_SPECIFICITY[a.matchedBy.type] ||
  b.matchedBy.value.length - a.matchedBy.value.length ||
  (b.updatedAt ?? b.addedAt) - (a.updatedAt ?? a.addedAt) ||
  a.id.localeCompare(b.id)

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
  searchEntriesMetas(
    query: string,
    includeTokens: true,
  ): Promise<EntryMetaWithToken[]>
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
  ): EntryMeta[] | Promise<EntryMetaWithToken[]> {
    const lowercaseQuery = query.toLowerCase()
    const entries = this.vaultDataManager
      .getAllEntries()
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowercaseQuery) ||
          entry.issuer.toLowerCase().includes(lowercaseQuery),
      )
    if (includeTokens) {
      return Promise.all(
        entries.map(async (entry) => ({
          ...getMetaForEntry(entry),
          token: await this.generateTokenForEntry(entry.id),
        })),
      )
    }
    return entries.map((entry) => getMetaForEntry(entry))
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
  listEntriesMetas(includeTokens: true): Promise<EntryMetaWithToken[]>
  /**
   * @inheritdoc
   */
  listEntriesMetas(includeTokens?: false): EntryMeta[]
  /**
   * @inheritdoc
   */
  listEntriesMetas(
    includeTokens?: boolean,
  ): EntryMeta[] | Promise<EntryMetaWithToken[]> {
    const entries = this.vaultDataManager.getAllEntries()
    if (includeTokens) {
      return Promise.all(
        entries.map(async (entry) => ({
          ...getMetaForEntry(entry),
          token: await this.generateTokenForEntry(entry.id),
        })),
      )
    }
    return entries.map((entry) => getMetaForEntry(entry))
  }

  /**
   * Collect the entries whose matchers cover a url, most specific first.
   * @param url - The url to match against.
   * @returns The matching entries, each with the matcher that made it match.
   */
  private matchEntriesForUrl(url: string): EntryMetaForUrl[] {
    const ctx = buildUrlMatchContext(url)
    if (!ctx) {
      return []
    }

    return this.vaultDataManager
      .getAllEntries()
      .reduce<EntryMetaForUrl[]>((matched, entry) => {
        const matchedBy: UrlMatcher | null = findMatcherForUrl(
          entry.matchers,
          ctx,
        )
        if (matchedBy) {
          matched.push({
            ...getMetaForEntry(entry),
            matchedBy: { ...matchedBy },
          })
        }
        return matched
      }, [])
      .sort(byMatchSpecificity)
  }

  /**
   * Find the ids of the entries that belong to a url, most specific first.
   *
   * Entries with no matchers are never returned, and an unparseable url, or
   * one whose scheme is not http(s), yields an empty list rather than an
   * error.
   *
   * Regex matchers run synchronously and can block the calling thread.
   * @param url - The url to match against.
   * @returns The matching entry ids.
   */
  findEntriesForUrl(url: string): EntryId[] {
    return this.matchEntriesForUrl(url).map((entry) => entry.id)
  }

  /**
   * Find the entries that belong to a url, most specific first.
   * @param url - The url to match against.
   * @param includeTokens - When true, includes current tokens with the metas.
   * @returns The matching entry metas, optionally with tokens.
   */
  findEntryMetasForUrl(
    url: string,
    includeTokens: true,
  ): Promise<EntryMetaForUrlWithToken[]>
  /**
   * @inheritdoc
   */
  findEntryMetasForUrl(url: string, includeTokens?: false): EntryMetaForUrl[]
  /**
   * @inheritdoc
   */
  findEntryMetasForUrl(
    url: string,
    includeTokens?: boolean,
  ): EntryMetaForUrl[] | Promise<EntryMetaForUrlWithToken[]> {
    const matched = this.matchEntriesForUrl(url)
    if (includeTokens) {
      return Promise.all(
        matched.map(async (entry) => ({
          ...entry,
          token: await this.generateTokenForEntry(entry.id),
        })),
      )
    }
    return matched
  }

  /**
   * Generate a time-based one-time password (TOTP) for a specific entry.
   * @param id - The unique identifier of the entry.
   * @param timestamp - Optional timestamp to use for token generation (default is current time).
   * @returns A promise resolving to an object containing the token and between which timestamps it is valid
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {TokenGenerationError} If token generation fails due to invalid entry data or technical issues.
   */
  generateTokenForEntry(id: EntryId, timestamp?: number): Promise<Token> {
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
      matchers: [],
      url: null,
      inputSelector: null,
      ...entry,
      id: newId,
      addedAt: Date.now(),
      updatedAt: null,
    }
    const reason = validateEntryStrict(newEntry)
    if (reason) {
      throw new InvalidCommandError(`Cannot add entry: ${reason}`)
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

    // updatedAt goes after the spread so a caller cannot clobber it.
    const updatedEntry: Entry = {
      ...oldEntry,
      ...updates,
      updatedAt: Date.now(),
    }

    const reason = validateEntryStrict(updatedEntry)
    if (reason) {
      throw new InvalidCommandError(`Cannot update entry: ${reason}`)
    }

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
