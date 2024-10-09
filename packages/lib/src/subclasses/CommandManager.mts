import { InvalidCommandError } from '../TwoFALibError.mjs'
import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'

import type Command from '../Command/BaseCommand.mjs'
import CommandQueue from '../Command/CommandQueue.mjs'
import {
  commandConstructors,
  type SyncCommand,
} from '../Command/commandTypes.mjs'

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

  private get vaultDataManager() {
    return this.mediator.getComponent('vaultDataManager')
  }

  private get syncManager() {
    if (!this.mediator.componentIsInitialised('syncManager')) {
      return null
    }
    return this.mediator.getComponent('syncManager')
  }

  /**
   * Executes a command and manages its state.
   * @param command - The command to execute.
   */
  async execute(command: Command): Promise<void> {
    if (this.processedCommandIds.has(command.id)) {
      console.error(`Command ${command.id} has already been processed`)
      return
    }

    await command.execute(this.vaultDataManager)
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
      const undoCommand = command.createUndoCommand(this.vaultDataManager)
      await undoCommand.execute(this.vaultDataManager)
      this.undoneCommands.push(command)
    }
  }

  /**
   * Redoes the last undone command.
   */
  async redo(): Promise<void> {
    const command = this.undoneCommands.pop()
    if (command) {
      await command.execute(this.vaultDataManager)
      this.executedCommands.push(command)
    }
  }

  /**
   * Processes all commands in the remote command queue.
   */
  async processRemoteCommands(): Promise<void> {
    while (!this.remoteCommandQueue.isEmpty()) {
      const command = this.remoteCommandQueue.dequeue()
      if (command) {
        await this.execute(command)
      }
    }
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
    if (!this.syncManager?.shouldSendCommands) {
      return Promise.resolve()
    }

    await this.syncManager.sendCommand(command)
  }
}

export default CommandManager
