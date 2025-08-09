import { describe, it, expect, vi } from 'vitest'
import { EntryId } from '../../../src/main.mjs'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import UpdateEntryCommand from '../../../src/Command/commands/UpdateEntryCommand.mjs'
import { InvalidCommandError } from '../../../src/FavaLibError.mjs'
import type VaultDataManager from '../../../src/subclasses/VaultDataManager.mjs'

import { totpEntry, anotherTotpEntry } from '../../testUtils.mjs'

describe('UpdateEntryCommand', () => {
  const updateEntry = vi.fn()
  const getFullEntry = vi.fn().mockReturnValue(anotherTotpEntry)
  const mockVaultManager: VaultDataManager = {
    updateEntry,
    getFullEntry,
  } as unknown as VaultDataManager
  const mockFavaLibMediator = {
    getComponent: () => mockVaultManager,
  } as unknown as FavaLibMediator

  const updateData = {
    entryId: totpEntry.id,
    oldEntry: totpEntry,
    updatedEntry: { ...totpEntry, name: 'Updated TOTP' },
  }

  it('should create an UpdateEntryCommand instance', () => {
    const command = new UpdateEntryCommand(updateData)
    expect(command).toBeInstanceOf(UpdateEntryCommand)
    expect(command.type).toBe('UpdateEntry')
    expect(command.data).toEqual(updateData)
  })

  it('should execute the command', async () => {
    const command = new UpdateEntryCommand(updateData)
    await command.execute(mockFavaLibMediator)
    expect(updateEntry).toHaveBeenCalledWith(updateData.updatedEntry)
  })

  it('should create an undo command', async () => {
    const command = new UpdateEntryCommand(updateData)
    await command.execute(mockFavaLibMediator)
    const undoCommand = command.createUndoCommand()
    expect(undoCommand).toBeInstanceOf(UpdateEntryCommand)
    expect((undoCommand as UpdateEntryCommand).data).toEqual({
      entryId: updateData.entryId,
      oldEntry: updateData.updatedEntry,
      updatedEntry: updateData.oldEntry,
    })
  })

  it('should validate the command data', () => {
    const validCommand = new UpdateEntryCommand(updateData)
    expect(validCommand.validate()).toBe(true)

    const invalidCommand = new UpdateEntryCommand({
      ...updateData,
      entryId: undefined as unknown as EntryId,
    })
    expect(invalidCommand.validate()).toBe(false)
  })

  it('should throw an error when executing with invalid data', async () => {
    const invalidCommand = new UpdateEntryCommand({
      ...updateData,
      entryId: undefined as unknown as EntryId,
    })
    await expect(invalidCommand.execute(mockFavaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should throw an error when creating undo command without original entry', () => {
    const command = new UpdateEntryCommand(updateData)
    // @ts-expect-error: Accessing private property for testing
    command.originalEntry = undefined
    expect(() => command.createUndoCommand()).toThrow(InvalidCommandError)
  })
})
