import { InvalidCommandError } from '../TwoFALibError.mjs'
import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'

import commandConstructors from '../Command/commandConstructors.mjs'
import type Command from '../Command/BaseCommand.mjs'
import CommandQueue from '../Command/CommandQueue.mjs'
import { type SyncCommand } from '../interfaces/CommandTypes.mjs'

interface CommandConstructor {
  fromJSON(input: unknown): Command
}

/**
 * Manages the execution, undo, and redo of commands.
 */
class CommandManager {
  private executedCommands: Command[] = []
  private undoneCommands: Command[] = []
  private remoteCommandQueue = new CommandQueue()
  private processedCommandIds = new Set<string>()

  /**
   * Constructs a new CommandManager instance.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: TwoFaLibMediator) {}

  private get syncManager() {
    if (!this.mediator.componentIsInitialised('syncManager')) {
      return null
    }
    return this.mediator.getComponent('syncManager')
  }

  private get log() {
    return this.mediator.getComponent('log')
  }

  /**
   * Executes a command and manages its state.
   * @param command - The command to execute.
   */
  async execute(command: Command): Promise<void> {
    if (this.processedCommandIds.has(command.id)) {
      this.log('warning', `Command ${command.id} has already been processed`)
      return
    }

    await command.execute(this.mediator)
    this.processedCommandIds.add(command.id)
    if (!command.fromRemote) {
      this.executedCommands.push(command)
      await this.sendCommandToOtherInstances(command)
    }
    this.undoneCommands = []
  }

  /**
   * Undoes the last executed command.
   */
  async undo(): Promise<void> {
    const command = this.executedCommands.pop()
    if (command) {
      const undoCommand = command.createUndoCommand(this.mediator)
      // check if the last command was undoable
      if (undoCommand) {
        await undoCommand.execute(this.mediator)
        this.undoneCommands.push(command)
      } else {
        // if it was not, skip it
        await this.undo()
      }
    }
  }

  /**
   * Redoes the last undone command.
   */
  async redo(): Promise<void> {
    const command = this.undoneCommands.pop()
    if (command) {
      await command.execute(this.mediator)
      this.executedCommands.push(command)
    }
  }

  /**
   * Processes all commands in the remote command queue.
   * @returns An array of the IDs of the succesfully executed commands.
   */
  async processRemoteCommands(): Promise<string[]> {
    const executedIds = []
    while (!this.remoteCommandQueue.isEmpty()) {
      const command = this.remoteCommandQueue.dequeue()
      if (command) {
        try {
          await this.execute(command)
          executedIds.push(command.id)
        } catch (err) {
          // eslint-disable-next-line no-restricted-globals
          if (err instanceof Error) {
            this.log(
              'warning',
              'Error while processing remote commands: ' + err.message,
            )
          }
          this.log('warning', 'Unknown error while processing remote commands')
        }
      }
    }
    return executedIds
  }

  /**
   * Receives a remote command and enqueues it for processing.
   * @param remoteCommand - The remote command to process.
   * @throws {InvalidCommandError} If the command type is unknown or data is invalid.
   */
  receiveRemoteCommand(remoteCommand: SyncCommand): void {
    if (remoteCommand && typeof remoteCommand.type === 'string') {
      const CommandClass = commandConstructors[
        remoteCommand.type
      ] as CommandConstructor
      if (CommandClass) {
        const command = CommandClass.fromJSON(remoteCommand)
        this.remoteCommandQueue.enqueue(command)
      } else {
        throw new InvalidCommandError(
          `Unknown command type: ${remoteCommand.type}`,
        )
      }
    } else {
      throw new InvalidCommandError('Invalid command data received')
    }
  }

  private async sendCommandToOtherInstances(command: Command): Promise<void> {
    if (!this.syncManager) {
      return Promise.resolve()
    }

    await this.syncManager.sendCommand(command)
  }
}

export default CommandManager
