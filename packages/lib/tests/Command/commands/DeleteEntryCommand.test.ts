import { describe, it, expect, vi } from 'vitest'
import { EntryId } from '../../../src/main.mjs'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import DeleteEntryCommand from '../../../src/Command/commands/DeleteEntryCommand.mjs'
import AddEntryCommand from '../../../src/Command/commands/AddEntryCommand.mjs'
import { InvalidCommandError } from '../../../src/FavaLibError.mjs'
import type VaultDataManager from '../../../src/subclasses/VaultDataManager.mjs'

import { totpEntry } from '../../testUtils.mjs'

describe('DeleteEntryCommand', () => {
  const deleteEntry = vi.fn()
  const getFullEntry = vi.fn().mockReturnValue(totpEntry)
  const mockVaultManager: VaultDataManager = {
    deleteEntry,
    getFullEntry,
  } as unknown as VaultDataManager
  const mockFavaLibMediator = {
    getComponent: () => mockVaultManager,
  } as unknown as FavaLibMediator

  // That the constructor assigns its arguments is BaseCommand's, and is
  // pinned in Command/BaseCommand.test.ts. The wire type is this class's own.
  it('serialises as DeleteEntry', () => {
    expect(new DeleteEntryCommand({ entryId: totpEntry.id }).type).toBe(
      'DeleteEntry',
    )
  })

  it('should execute the command', async () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    await command.execute(mockFavaLibMediator)
    expect(deleteEntry).toHaveBeenCalledWith(totpEntry.id)
  })

  it('should create an undo command', async () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    await command.execute(mockFavaLibMediator)
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
    await expect(invalidCommand.execute(mockFavaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should throw an error when entry does not exist', async () => {
    const nonExistentEntryId = '9999' as EntryId
    const command = new DeleteEntryCommand({ entryId: nonExistentEntryId })
    getFullEntry.mockReturnValueOnce(undefined)
    await expect(command.execute(mockFavaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should throw an error when creating undo command without executing first', () => {
    const command = new DeleteEntryCommand({ entryId: totpEntry.id })
    expect(() => command.createUndoCommand()).toThrow(InvalidCommandError)
  })
})
