import { v4 as uuidv4 } from 'uuid'
import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'

import { CommandData } from '../interfaces/CommandTypes.mjs'

/**
 * Abstract base class for commands that interact with the vault.
 * @template T - The type of command data, extending CommandData.
 */
abstract class BaseCommand<T extends CommandData = CommandData> {
  readonly id: string
  readonly type: string
  readonly timestamp: number
  readonly version: string
  readonly data: T
  readonly fromRemote: boolean

  /**
   * Creates a new BaseCommand instance.
   * @param type - The type of the command.
   * @param data - The data associated with the command.
   * @param id - The unique identifier for the command. If not provided, a new UUID will be generated.
   * @param timestamp - The timestamp of when the command was created. If not provided, the current timestamp will be used.
   * @param version - The version of the command. Defaults to '1.0'.
   * @param fromRemote - Indicates if the command originated from a remote source. Defaults to false.
   */
  constructor(
    type: string,
    data: T,
    id: string = uuidv4(),
    timestamp: number = Date.now(),
    version = '1.0',
    fromRemote = false,
  ) {
    this.id = id
    this.type = type
    this.timestamp = timestamp
    this.version = version
    this.data = data
    this.fromRemote = fromRemote
  }

  /**
   * Executes the command using the provided mediator, which can be used to access the other classes.
   * @param VaultDataManager - The TwoFaLibMediator instance to use for execution.
   * @returns A Promise that resolves when the execution is complete.
   */
  abstract execute(twoFaLibMediator: TwoFaLibMediator): Promise<void>

  /**
   * Creates an undo command that, when executed, reverses the effects of this command.
   * @param VaultDataManager - The TwoFaLibMediator instance to use for creating the undo command.
   * @returns A BaseCommand instance that undoes this command or false if this command has no undo.
   */
  abstract createUndoCommand(
    TwoFaLibMediator: TwoFaLibMediator,
  ): BaseCommand | false

  /**
   * Creates a new instance of the command with the provided data.
   * @param data - The data to use for creating the new command instance.
   * @returns A new instance of the command.
   */
  static create<T extends CommandData, C extends BaseCommand<T>>(
    this: new (
      data: T,
      id?: string,
      timestamp?: number,
      version?: string,
      fromRemote?: boolean,
    ) => C,
    data: T,
  ): C {
    return new this(data)
  }

  /**
   * Creates a new instance of the command from JSON data.
   * @param input - The JSON input containing the command data.
   * @returns A new instance of the command created from the JSON data.
   */
  static fromJSON<T extends CommandData, C extends BaseCommand<T>>(
    this: new (
      data: T,
      id: string,
      timestamp: number,
      version: string,
      fromRemote: boolean,
    ) => C,
    input: {
      data: T
      id: string
      timestamp: number
      version: string
    },
  ): C {
    return new this(input.data, input.id, input.timestamp, input.version, true)
  }

  /**
   * Converts the command instance to a JSON-serializable object.
   * @returns An object representation of the command.
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
      version: this.version,
    }
  }
}

export default BaseCommand
