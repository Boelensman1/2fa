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

class CommandManager {
  private executedCommands: Command[] = []
  private undoneCommands: Command[] = []
  private remoteCommandQueue = new CommandQueue()
  private processedCommandIds = new Set<string>()

  constructor(private readonly mediator: TwoFaLibMediator) {}

  get internalVaultManager() {
    return this.mediator.getInternalVaultManager()
  }
  get syncManager() {
    return this.mediator.getSyncManager()
  }

  async execute(command: Command): Promise<void> {
    if (this.processedCommandIds.has(command.id)) {
      console.error(`Command ${command.id} has already been processed`)
      return
    }

    await command.execute(this.internalVaultManager)
    this.processedCommandIds.add(command.id)
    if (!command.fromRemote) {
      this.executedCommands.push(command)
      await this.sendCommandToOtherInstances(command)
    }
    this.undoneCommands = []
  }

  async undo(): Promise<void> {
    const command = this.executedCommands.pop()
    if (command) {
      const undoCommand = command.createUndoCommand(this.internalVaultManager)
      await undoCommand.execute(this.internalVaultManager)
      this.undoneCommands.push(command)
    }
  }

  async redo(): Promise<void> {
    const command = this.undoneCommands.pop()
    if (command) {
      await command.execute(this.internalVaultManager)
      this.executedCommands.push(command)
    }
  }

  async processRemoteCommands(): Promise<void> {
    while (!this.remoteCommandQueue.isEmpty()) {
      const command = this.remoteCommandQueue.dequeue()
      if (command) {
        await this.execute(command)
      }
    }
  }

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
