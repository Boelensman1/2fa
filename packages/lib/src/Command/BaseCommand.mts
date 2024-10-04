import { v4 as uuidv4 } from 'uuid'
import type InternalVaultManager from '../subclasses/InternalVaultManager.mjs'

import { CommandData } from './commandTypes.mjs'

abstract class BaseCommand<T extends CommandData = CommandData> {
  readonly id: string
  readonly type: string
  readonly timestamp: number
  readonly version: string
  readonly data: T
  readonly fromRemote: boolean

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

  abstract execute(internalVaultManager: InternalVaultManager): Promise<void>
  abstract createUndoCommand(
    internalVaultManager: InternalVaultManager,
  ): BaseCommand

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
