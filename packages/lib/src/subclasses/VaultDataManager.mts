import { TOTP } from 'totp-generator'

import type Entry from '../interfaces/Entry.mjs'
import type { EntryId, Token } from '../interfaces/Entry.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'
import { EntryNotFoundError, TokenGenerationError } from '../TwoFALibError.mjs'

import {
  SUPPORTED_ALGORITHMS,
  SupportedAlgorithmsType,
} from '../utils/constants.mjs'

import { Vault } from '../interfaces/Vault.mjs'

/**
 * Manages the data within the vault. This class should only be used internally
 * by the library, for public methods, see VaultOperationsManager.
 */
class VaultDataManager {
  private vault: Vault = []

  /**
   * Constructs a new VaultDataManager instance.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: TwoFaLibMediator) {}

  private get persistentStorageManager() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * @returns The number of entries in the vault.
   */
  get size() {
    return this.vault.length
  }

  /**
   * Retrieve a specific entry.
   * @param entryId - The unique identifier of the entry.
   * @returns The entry.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  getFullEntry(entryId: EntryId): Entry {
    const entry = this.vault.find((e) => e.id === entryId)
    if (!entry) throw new EntryNotFoundError('Entry not found')
    return entry
  }

  /**
   * Retrieve all entries in the vault.
   * @returns An array of all entries.
   */
  getAllEntries() {
    return this.vault
  }

  /**
   * Generate a time-based one-time password (TOTP) for a specific entry.
   * @param id - The unique identifier of the entry.
   * @param timestamp - Optional timestamp to use for token generation (default is current time).
   * @returns An object containing the token and the validity period.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {TokenGenerationError} If token generation fails due to invalid entry data or technical issues.
   */
  generateTokenForEntry(id: EntryId, timestamp?: number): Token {
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
   * Add a new entry to the vault.
   * @param entry - The entry data to add (without an ID, as it will be generated).
   * @returns A promise that resolves when the entry is added.
   */
  async addEntry(entry: Entry): Promise<void> {
    this.vault.push(entry)

    await this.persistentStorageManager.save()
  }

  /**
   * Delete an entry from the vault.
   * @param entryId - The identifier of the entry to delete.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  async deleteEntry(entryId: EntryId): Promise<void> {
    const index = this.vault.findIndex((e) => e.id === entryId)
    if (index === -1) throw new EntryNotFoundError('Entry not found')
    this.vault.splice(index, 1)

    await this.persistentStorageManager.save()
  }

  /**
   * Update an existing entry in the vault.
   * @param updatedEntry - An object containing the updated entry.
   * @returns A promise that resolves when the entry is updated.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  async updateEntry(updatedEntry: Entry): Promise<void> {
    const { id } = updatedEntry
    const index = this.vault.findIndex((e) => e.id === id)
    if (index === -1) throw new EntryNotFoundError('Entry not found')

    this.vault[index] = updatedEntry

    await this.persistentStorageManager.save()
  }

  /**
   * Replace the current vault with a new one.
   * @param newVault - The new vault data to replace the existing vault.
   */
  replaceVault(newVault: Vault) {
    this.vault = newVault
  }
}

export default VaultDataManager
