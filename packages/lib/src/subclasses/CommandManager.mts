import { InvalidCommandError } from '../FavaLibError.mjs'
import type FavaLibMediator from '../FavaLibMediator.mjs'

import commandConstructors from '../Command/commandConstructors.mjs'
import type Command from '../Command/BaseCommand.mjs'
import CommandQueue from '../Command/CommandQueue.mjs'
import { type SyncCommand } from '../interfaces/CommandTypes.mjs'
import type { DeviceId } from '../interfaces/BrandedTypes.mjs'
import { COMMAND_VERSION } from '../version.mjs'

const currentCommandMajorVersion = Number.parseInt(
  COMMAND_VERSION.split('.')[0],
  10,
)

interface CommandConstructor {
  fromJSON(input: unknown, fromDeviceId?: DeviceId): Command
}

/**
 * Manages the execution, undo, and redo of commands.
 */
class CommandManager {
  private executedCommands: Command[] = []
  private undoneCommands: Command[] = []
  private remoteCommandQueue = new CommandQueue()
  private processedCommandIds = new Set<string>()
  // Commands dropped for speaking a newer protocol. Kept separate from
  // processedCommandIds, which also gates execute() and would permanently
  // suppress the command even after this device upgrades. The server re-sends
  // anything it has not been told was executed, so without this set the same
  // warning would be logged on every reconnect.
  private unsupportedCommandIds = new Set<string>()

  /**
   * Constructs a new CommandManager instance.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: FavaLibMediator) {}

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
          } else {
            this.log(
              'warning',
              'Unknown error while processing remote commands',
            )
          }
        }
      }
    }
    return executedIds
  }

  /**
   * Receives a remote command and enqueues it for processing.
   *
   * A command whose major version is newer than this build understands is
   * dropped with a warning and is never reported as executed, so the server
   * keeps it queued and redelivers it once this device is upgraded. SyncManager
   * authenticates and drains one command at a time, so each command sees the
   * peer list left by the previous one.
   * @param remoteCommand - The remote command to process.
   * @param fromDeviceId - The peer whose signature the caller verified over
   * this command. Passed down so a command can act on WHO sent it, not just on
   * what it says: enrolment records its introducer, and a rename is refused
   * unless the sender is the device being renamed.
   * @throws {InvalidCommandError} If the command type is unknown or data is invalid.
   */
  receiveRemoteCommand(
    remoteCommand: SyncCommand,
    fromDeviceId?: DeviceId,
  ): void {
    if (remoteCommand && !this.commandVersionIsSupported(remoteCommand)) {
      return
    }
    if (remoteCommand && typeof remoteCommand.type === 'string') {
      const CommandClass = commandConstructors[
        remoteCommand.type
      ] as CommandConstructor
      if (CommandClass) {
        const command = CommandClass.fromJSON(remoteCommand, fromDeviceId)
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

  /**
   * Checks whether a remote command's protocol version is one this build can
   * apply, logging a warning the first time a command is dropped.
   * @param remoteCommand - The remote command to check.
   * @returns True when the command should be processed.
   */
  private commandVersionIsSupported(remoteCommand: SyncCommand): boolean {
    const major = Number.parseInt(
      (remoteCommand.version ?? COMMAND_VERSION).split('.')[0],
      10,
    )
    // An absent or unparseable version means a peer that predates versioning;
    // treat it the way the storage path treats a missing storageVersion.
    if (Number.isNaN(major) || major <= currentCommandMajorVersion) {
      return true
    }
    if (!this.unsupportedCommandIds.has(remoteCommand.id)) {
      this.unsupportedCommandIds.add(remoteCommand.id)
      this.log(
        'warning',
        `Dropping remote command ${remoteCommand.id} of type ` +
          `${remoteCommand.type}: it uses sync protocol version ` +
          `${String(remoteCommand.version)}, but this version of the library ` +
          `only supports up to ${COMMAND_VERSION}. It will be applied after ` +
          `this device is upgraded.`,
      )
    }
    return false
  }

  private async sendCommandToOtherInstances(command: Command): Promise<void> {
    if (!this.syncManager) {
      return Promise.resolve()
    }

    await this.syncManager.sendCommand(command)
  }
}

export default CommandManager
