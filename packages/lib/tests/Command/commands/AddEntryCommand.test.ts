import { describe, it, expect, vi } from 'vitest'
import { EntryId } from '../../../src/main.mjs'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import AddEntryCommand from '../../../src/Command/commands/AddEntryCommand.mjs'
import DeleteEntryCommand from '../../../src/Command/commands/DeleteEntryCommand.mjs'
import { InvalidCommandError } from '../../../src/FavaLibError.mjs'
import type VaultDataManager from '../../../src/subclasses/VaultDataManager.mjs'

import { totpEntry } from '../../testUtils.mjs'

describe('AddEntryCommand', () => {
  const addEntry = vi.fn()
  const mockVaultManager: VaultDataManager = {
    addEntry,
  } as unknown as VaultDataManager
  const mockFavaLibMediator = {
    getComponent: () => mockVaultManager,
  } as unknown as FavaLibMediator

  it('should create an AddEntryCommand instance', () => {
    const command = new AddEntryCommand(totpEntry)
    expect(command).toBeInstanceOf(AddEntryCommand)
    expect(command.type).toBe('AddEntry')
    expect(command.data).toEqual(totpEntry)
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

  it('should throw an error when executing with invalid data', async () => {
    const invalidCommand = new AddEntryCommand({
      ...totpEntry,
      id: undefined as unknown as EntryId,
    })
    await expect(invalidCommand.execute(mockFavaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })
})
