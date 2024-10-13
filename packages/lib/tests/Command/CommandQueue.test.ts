import { describe, test, expect, beforeEach } from 'vitest'

import CommandQueue from '../../src/Command/CommandQueue.mjs'
import BaseCommand from '../../src/Command/BaseCommand.mjs'
import { EntryId } from '../../src/main.mjs'

const testData = { entryId: 'test' as EntryId }
class TestCommand extends BaseCommand {
  constructor(id: string, timestamp: number) {
    super('TestCommand', testData, id, timestamp)
  }

  execute(): Promise<void> {
    return Promise.resolve()
  }

  createUndoCommand() {
    return new TestCommand(this.id, this.timestamp)
  }
}

describe('CommandQueue', () => {
  let commandQueue: CommandQueue

  beforeEach(() => {
    commandQueue = new CommandQueue()
  })

  test('should be empty when created', () => {
    expect(commandQueue.isEmpty()).toBe(true)
    expect(commandQueue.size).toBe(0)
  })

  test('should add and remove commands', () => {
    const command1 = new TestCommand('1', 100)
    const command2 = new TestCommand('2', 200)

    commandQueue.enqueue(command1)
    expect(commandQueue.size).toBe(1)
    expect(commandQueue.isEmpty()).toBe(false)

    commandQueue.enqueue(command2)
    expect(commandQueue.size).toBe(2)

    const removedCommand = commandQueue.dequeue()
    expect(removedCommand).toBe(command1)
    expect(commandQueue.size).toBe(1)

    commandQueue.dequeue()
    expect(commandQueue.isEmpty()).toBe(true)
  })

  test('should throw an error when dequeuing from an empty queue', () => {
    expect(() => commandQueue.dequeue()).toThrow('Command queue is empty')
  })

  test('should dequeue commands in order', () => {
    const command1 = new TestCommand('1', 300)
    const command2 = new TestCommand('2', 100)
    const command3 = new TestCommand('3', 200)

    commandQueue.enqueue(command1)
    commandQueue.enqueue(command2)
    commandQueue.enqueue(command3)

    expect(commandQueue.dequeue()).toBe(command2)
    expect(commandQueue.dequeue()).toBe(command3)
    expect(commandQueue.dequeue()).toBe(command1)
    expect(commandQueue.isEmpty()).toBe(true)
  })
})
