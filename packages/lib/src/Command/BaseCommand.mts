import { v4 as uuidv4 } from 'uuid'
import type FavaLibMediator from '../FavaLibMediator.mjs'

import { CommandData } from '../interfaces/CommandTypes.mjs'
import type { DeviceId } from '../interfaces/BrandedTypes.mjs'
import { COMMAND_VERSION } from '../version.mjs'

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
   * The peer that sent this command, as VERIFIED, not as claimed.
   *
   * Set only by `fromJSON`, from the device id
   * `SyncManager.verifyCommandEnvelope` matched a signature against -- never
   * from anything inside the payload, which the sender chooses. Undefined for
   * a command this device created.
   *
   * It is deliberately absent from `toJSON`: it is this device's conclusion
   * about who spoke, not a field of the command, and serialising it would
   * invite a receiver to read the sender's own claim about itself.
   */
  readonly fromDeviceId?: DeviceId

  /**
   * Creates a new BaseCommand instance.
   * @param type - The type of the command.
   * @param data - The data associated with the command.
   * @param id - The unique identifier for the command. If not provided, a new UUID will be generated.
   * @param timestamp - The timestamp of when the command was created. If not provided, the current timestamp will be used.
   * @param version - The sync protocol version of the command. Defaults to
   * what this build speaks. It used to default to the literal '1.0' while
   * COMMAND_VERSION said '2.0', so every command this library created went out
   * stamped with a version it was not written in -- harmless only because the
   * receiving gate accepts older majors.
   * @param fromRemote - Indicates if the command originated from a remote source. Defaults to false.
   * @param fromDeviceId - The verified sender, when this command arrived from
   * a peer. Never taken from the payload; see the field.
   */
  constructor(
    type: string,
    data: T,
    id: string = uuidv4(),
    timestamp: number = Date.now(),
    version = COMMAND_VERSION,
    fromRemote = false,
    fromDeviceId?: DeviceId,
  ) {
    this.id = id
    this.type = type
    this.timestamp = timestamp
    this.version = version
    this.data = data
    this.fromRemote = fromRemote
    this.fromDeviceId = fromDeviceId
  }

  /**
   * Executes the command using the provided mediator, which can be used to access the other classes.
   * @param VaultDataManager - The FavaLibMediator instance to use for execution.
   * @returns A Promise that resolves when the execution is complete.
   */
  abstract execute(favaLibMediator: FavaLibMediator): Promise<void>

  /**
   * Creates an undo command that, when executed, reverses the effects of this command.
   * @param VaultDataManager - The FavaLibMediator instance to use for creating the undo command.
   * @returns A BaseCommand instance that undoes this command or false if this command has no undo.
   */
  abstract createUndoCommand(
    FavaLibMediator: FavaLibMediator,
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
      fromDeviceId?: DeviceId,
    ) => C,
    data: T,
  ): C {
    return new this(data)
  }

  /**
   * Creates a new instance of the command from JSON data.
   * @param input - The JSON input containing the command data.
   * @param fromDeviceId - The device whose signature was verified over this
   * command, which the caller must have established rather than read.
   * @returns A new instance of the command created from the JSON data.
   */
  static fromJSON<T extends CommandData, C extends BaseCommand<T>>(
    this: new (
      data: T,
      id: string,
      timestamp: number,
      version: string,
      fromRemote: boolean,
      fromDeviceId?: DeviceId,
    ) => C,
    input: {
      data: T
      id: string
      timestamp: number
      version: string
    },
    fromDeviceId?: DeviceId,
  ): C {
    return new this(
      input.data,
      input.id,
      input.timestamp,
      input.version,
      true,
      fromDeviceId,
    )
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
