import { describe, it, expect, vi } from 'vitest'
import { EntryId, type UrlMatcher } from '../../../src/main.mjs'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import UpdateEntryCommand from '../../../src/Command/commands/UpdateEntryCommand.mjs'
import { InvalidCommandError } from '../../../src/FavaLibError.mjs'
import type VaultDataManager from '../../../src/subclasses/VaultDataManager.mjs'

import { totpEntry, anotherTotpEntry } from '../../testUtils.mjs'

const badMatchers: UrlMatcher[] = [{ type: 'Regex', value: '(a+)+' }]

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

  // That the constructor assigns its arguments is BaseCommand's, and is
  // pinned in Command/BaseCommand.test.ts. The wire type is this class's own.
  it('serialises as UpdateEntry', () => {
    expect(new UpdateEntryCommand(updateData).type).toBe('UpdateEntry')
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

  it('accepts a remote repair whose old entry fails current validation', async () => {
    const command = UpdateEntryCommand.fromJSON({
      id: 'repair-command',
      timestamp: Date.now(),
      version: '1.0',
      data: { ...updateData, oldEntry: { ...totpEntry, issuer: '' } },
    })
    await command.execute(mockFavaLibMediator)
    expect(updateEntry).toHaveBeenLastCalledWith(updateData.updatedEntry)
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

  it('should reject an updatedEntry whose id does not match entryId', () => {
    const command = new UpdateEntryCommand({
      ...updateData,
      updatedEntry: { ...totpEntry, id: 'mismatched' as EntryId },
    })
    expect(command.validate()).toBe(false)
  })

  it('should reject a locally-created update carrying a bad matcher', () => {
    const command = new UpdateEntryCommand({
      ...updateData,
      updatedEntry: {
        ...totpEntry,
        matchers: badMatchers,
      },
    })
    expect(command.validate()).toBe(false)
  })

  it('should accept the same update when it came from a peer', () => {
    const command = UpdateEntryCommand.fromJSON({
      id: 'command-id',
      data: {
        ...updateData,
        updatedEntry: {
          ...totpEntry,
          matchers: badMatchers,
        },
      },
      timestamp: Date.now(),
      version: '1.0',
    })
    expect(command.fromRemote).toBe(true)
    expect(command.validate()).toBe(true)
  })

  it('should throw an error when creating undo command without original entry', () => {
    const command = new UpdateEntryCommand(updateData)
    // @ts-expect-error: Accessing private property for testing
    command.originalEntry = undefined
    expect(() => command.createUndoCommand()).toThrow(InvalidCommandError)
  })
})
