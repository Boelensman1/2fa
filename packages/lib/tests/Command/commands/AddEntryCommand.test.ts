import { describe, it, expect, vi } from 'vitest'
import { EntryId, type UrlMatcher } from '../../../src/main.mjs'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import AddEntryCommand from '../../../src/Command/commands/AddEntryCommand.mjs'
import DeleteEntryCommand from '../../../src/Command/commands/DeleteEntryCommand.mjs'
import { InvalidCommandError } from '../../../src/FavaLibError.mjs'
import type VaultDataManager from '../../../src/subclasses/VaultDataManager.mjs'

import { totpEntry } from '../../testUtils.mjs'

const badMatchers: UrlMatcher[] = [{ type: 'Regex', value: '(a+)+' }]

describe('AddEntryCommand', () => {
  const addEntry = vi.fn()
  const mockVaultManager: VaultDataManager = {
    addEntry,
  } as unknown as VaultDataManager
  const mockFavaLibMediator = {
    getComponent: () => mockVaultManager,
  } as unknown as FavaLibMediator

  // That the constructor assigns its arguments is BaseCommand's, and is
  // pinned in Command/BaseCommand.test.ts. The wire type is this class's own.
  it('serialises as AddEntry', () => {
    expect(new AddEntryCommand(totpEntry).type).toBe('AddEntry')
  })

  it('should execute the command', async () => {
    const command = new AddEntryCommand(totpEntry)
    await command.execute(mockFavaLibMediator)
    expect(addEntry).toHaveBeenCalledWith(totpEntry)
  })

  it('should create an undo command', () => {
    const command = new AddEntryCommand(totpEntry)
    const undoCommand = command.createUndoCommand()
    expect(undoCommand).toBeInstanceOf(DeleteEntryCommand)
    expect((undoCommand as DeleteEntryCommand).data.entryId).toBe(totpEntry.id)
  })

  it('should validate the command data', () => {
    const validCommand = new AddEntryCommand(totpEntry)
    expect(validCommand.validate()).toBe(true)

    const invalidCommand = new AddEntryCommand({
      ...totpEntry,
      id: undefined as unknown as EntryId,
    })
    expect(invalidCommand.validate()).toBe(false)
  })

  it('should throw a named error when executing with invalid data', async () => {
    const invalidCommand = new AddEntryCommand({
      ...totpEntry,
      id: undefined as unknown as EntryId,
    })
    const rejects = expect(invalidCommand.execute(mockFavaLibMediator)).rejects
    await rejects.toThrow(InvalidCommandError)
    await rejects.toThrow(/entry has no id/)
  })

  it('should reject a locally-created entry carrying a bad matcher', () => {
    const command = new AddEntryCommand({
      ...totpEntry,
      matchers: badMatchers,
    })
    expect(command.validate()).toBe(false)
  })

  it('should accept the same entry when it came from a peer', () => {
    // A remote command that throws is dropped and never retried, so a
    // repairable matcher must not cost the entry. VaultDataManager sanitises.
    const command = AddEntryCommand.fromJSON({
      id: 'command-id',
      data: { ...totpEntry, matchers: badMatchers },
      timestamp: Date.now(),
      version: '1.0',
    })
    expect(command.fromRemote).toBe(true)
    expect(command.validate()).toBe(true)
  })

  it('should still reject a fatally broken entry from a peer', () => {
    const command = AddEntryCommand.fromJSON({
      id: 'command-id',
      data: { ...totpEntry, payload: { ...totpEntry.payload, secret: '' } },
      timestamp: Date.now(),
      version: '1.0',
    })
    expect(command.validate()).toBe(false)
  })
})
