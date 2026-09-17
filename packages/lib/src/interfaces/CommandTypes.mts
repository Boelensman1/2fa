import type { DeviceId, Signature } from './BrandedTypes.mjs'
import type { AddEntryData } from '../Command/commands/AddEntryCommand.mjs'
import type { DeleteEntryData } from '../Command/commands/DeleteEntryCommand.mjs'
import type { UpdateEntryData } from '../Command/commands/UpdateEntryCommand.mjs'
import type { AddSyncDeviceData } from '../Command/commands/AddSyncDeviceCommand.mjs'
import type { ChangeDeviceInfoData } from '../Command/commands/ChangeDeviceInfoCommand.mjs'
import type { RemoveSyncDeviceData } from '../Command/commands/RemoveSyncDeviceCommand.mjs'

export type SyncCommand = (
  | { type: 'AddEntry'; data: AddEntryData }
  | { type: 'DeleteEntry'; data: DeleteEntryData }
  | { type: 'UpdateEntry'; data: UpdateEntryData }
  | { type: 'AddSyncDevice'; data: AddSyncDeviceData }
  | { type: 'ChangeDeviceInfo'; data: ChangeDeviceInfoData }
  | { type: 'RemoveSyncDevice'; data: RemoveSyncDeviceData }
) & {
  id: string
  // Serialised by BaseCommand.toJSON and read back by fromJSON, so these are
  // genuinely on the wire. Optional because a peer on an older build may omit
  // them, and because the type predates them.
  version?: string
  timestamp?: number
}
/**
 * What a sync command actually travels as, inside the encrypted envelope.
 *
 * The signature covers `payload` verbatim rather than a re-serialisation of the
 * parsed command, which is why the command is carried as a string rather than
 * as an object: JSON.stringify of a parsed object is only byte-identical while
 * two builds agree about key order and number formatting, and a signature that
 * depends on that holds until the day someone upgrades one device.
 *
 * All three fields are inside the ciphertext, so the server relays them without
 * learning who is talking to whom -- and without being able to remove them,
 * since a payload arriving without a signature is refused.
 */
export interface SignedCommandEnvelope {
  /** The device that signed this command, as its peers know it. */
  from: DeviceId
  /** Ed25519 over buildCommandSignatureMessage. */
  signature: Signature
  /** The serialised command: exactly the bytes that were signed. */
  payload: string
}

export type CommandData =
  | AddEntryData
  | DeleteEntryData
  | UpdateEntryData
  | AddSyncDeviceData
  | ChangeDeviceInfoData
  | RemoveSyncDeviceData
