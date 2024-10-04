import type InternalVaultManager from './InternalVaultManager.mjs'
import type SyncManager from './SyncManager.mjs'

import type Command from '../Command/BaseCommand.mjs'
import CommandQueue from '../Command/CommandQueue.mjs'
import {
  commandConstructors,
  type RemoteCommand,
} from '../Command/commandTypes.mjs'

interface CommandConstructor {
  fromJSON(input: unknown): Command
}

class CommandManager {
  private syncManager?: SyncManager

  private executedCommands: Command[] = []
  private undoneCommands: Command[] = []
  private remoteCommandQueue = new CommandQueue()
  private processedCommandIds = new Set<string>()

  constructor(private readonly internalVaultManager: InternalVaultManager) {}

  setSyncManager(syncManager: SyncManager) {
    this.syncManager = syncManager
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
      try {
        await command.execute(this.internalVaultManager)
        this.executedCommands.push(command)
      } catch (error) {
        console.error(
          `Error redoing command: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
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

  receiveRemoteCommand(remoteCommand: RemoteCommand): void {
    if (remoteCommand && typeof remoteCommand.type === 'string') {
      const CommandClass = commandConstructors[
        remoteCommand.type
      ] as CommandConstructor
      if (CommandClass) {
        const command = CommandClass.fromJSON(remoteCommand)
        this.remoteCommandQueue.enqueue(command)
      } else {
        throw new Error(`Unknown command type: ${remoteCommand.type}`)
      }
    } else {
      throw new Error('Invalid command data received')
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
