import { describe, it, expect, vi } from 'vitest'
import { EntryId } from '../../../src/main.mjs'
import DeleteEntryCommand from '../../../src/Command/commands/DeleteEntryCommand.mjs'
import AddEntryCommand from '../../../src/Command/commands/AddEntryCommand.mjs'
import { InvalidCommandError } from '../../../src/TwoFALibError.mjs'
import type VaultDataManager from '../../../src/subclasses/VaultDataManager.mjs'

import { totpEntry } from '../../testUtils.mjs'

describe('DeleteEntryCommand', () => {
  const deleteEntry = vi.fn()
  const getFullEntry = vi.fn().mockReturnValue(totpEntry)
  const mockVaultManager: VaultDataManager = {
    deleteEntry,
    getFullEntry,
  } as unknown as VaultDataManager

  it('should create a DeleteEntryCommand instance', () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    expect(command).toBeInstanceOf(DeleteEntryCommand)
    expect(command.type).toBe('DeleteEntry')
    expect(command.data).toEqual({ entryId: totpEntry.id })
  })

  it('should execute the command', async () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    await command.execute(mockVaultManager)
    expect(deleteEntry).toHaveBeenCalledWith(totpEntry.id)
  })

  it('should create an undo command', async () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    await command.execute(mockVaultManager)
    const undoCommand = command.createUndoCommand()
    expect(undoCommand).toBeInstanceOf(AddEntryCommand)
    expect((undoCommand as AddEntryCommand).data).toEqual(totpEntry)
  })

  it('should validate the command data', () => {
    const validCommand = new DeleteEntryCommand({ entryId: totpEntry.id })
    expect(validCommand.validate()).toBe(true)

    const invalidCommand = new DeleteEntryCommand({
      entryId: undefined as unknown as EntryId,
    })
    expect(invalidCommand.validate()).toBe(false)
  })

  it('should throw an error when executing with invalid data', async () => {
    const invalidCommand = new DeleteEntryCommand({
      entryId: undefined as unknown as EntryId,
    })
    await expect(invalidCommand.execute(mockVaultManager)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should throw an error when entry does not exist', async () => {
    const nonExistentEntryId = '9999' as EntryId
    const command = new DeleteEntryCommand({ entryId: nonExistentEntryId })
    getFullEntry.mockReturnValueOnce(undefined)
    await expect(command.execute(mockVaultManager)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should throw an error when creating undo command without executing first', () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    expect(() => command.createUndoCommand()).toThrow(InvalidCommandError)
  })
})
