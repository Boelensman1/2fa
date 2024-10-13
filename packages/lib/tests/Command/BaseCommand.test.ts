import { describe, it, expect, vi } from 'vitest'
import BaseCommand from '../../src/Command/BaseCommand.mjs'
import type { EntryId } from '../../src/main.mjs'

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mocked-uuid'),
}))

const testData = { entryId: 'test' as EntryId }
describe('BaseCommand', () => {
  class TestCommand extends BaseCommand<{ entryId: EntryId }> {
    constructor(
      data: { entryId: EntryId },
      id?: string,
      timestamp?: number,
      version?: string,
      fromRemote = false,
    ) {
      super('TestCommand', data, id, timestamp, version, fromRemote)
    }

    execute(): Promise<void> {
      return Promise.resolve()
    }

    createUndoCommand(): BaseCommand {
      return new TestCommand({ entryId: 'undo' as EntryId })
    }
  }

  it('should create a command with default values', () => {
    const command = new TestCommand(testData)
    expect(command.id).toBe('mocked-uuid')
    expect(command.type).toBe('TestCommand')
    expect(command.data).toEqual(testData)
    expect(command.timestamp).toBeLessThanOrEqual(Date.now())
    expect(command.version).toBe('1.0')
    expect(command.fromRemote).toBe(false)
  })

  it('should create a command with custom values', () => {
    const customId = 'custom-id'
    const customTimestamp = 1234567890
    const customVersion = '2.0'
    const command = new TestCommand(
      testData,
      customId,
      customTimestamp,
      customVersion,
      true,
    )
    expect(command.id).toBe(customId)
    expect(command.type).toBe('TestCommand')
    expect(command.data).toEqual(testData)
    expect(command.timestamp).toBe(customTimestamp)
    expect(command.version).toBe(customVersion)
    expect(command.fromRemote).toBe(true)
  })

  it('should create a command using the static create method', () => {
    const command = TestCommand.create(testData)
    expect(command).toBeInstanceOf(TestCommand)
    expect(command.data).toEqual(testData)
  })

  it('should create a command from JSON using the static fromJSON method', () => {
    const jsonData = {
      id: 'json-id',
      type: 'TestCommand',
      data: testData,
      timestamp: 1234567890,
      version: '3.0',
    }
    const command = TestCommand.fromJSON(jsonData)
    expect(command).toBeInstanceOf(TestCommand)
    expect(command.id).toBe(jsonData.id)
    expect(command.type).toBe(jsonData.type)
    expect(command.data).toEqual(jsonData.data)
    expect(command.timestamp).toBe(jsonData.timestamp)
    expect(command.version).toBe(jsonData.version)
    expect(command.fromRemote).toBe(true)
  })

  it('should convert the command to JSON', () => {
    const command = new TestCommand(testData, 'json-id', 1234567890, '4.0')
    const json = command.toJSON()
    expect(json).toEqual({
      id: 'json-id',
      type: 'TestCommand',
      data: testData,
      timestamp: 1234567890,
      version: '4.0',
    })
  })
})
