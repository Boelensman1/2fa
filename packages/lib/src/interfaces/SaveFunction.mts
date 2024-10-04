import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
} from '../interfaces/CryptoLib.mjs'
import type TwoFaLib from '../TwoFaLib.mjs'
import type { UserId } from './SyncTypes.mjs'
import { WasChangedSinceLastSave } from './WasChangedSinceLastSave.mjs'

export interface SaveFunctionData {
  lockedRepresentation: string
  encryptedPrivateKey: EncryptedPrivateKey
  encryptedSymmetricKey: EncryptedSymmetricKey
  salt: Salt
  userId: UserId
  syncDevices: string
}
export type SaveFunction = (
  data: SaveFunctionData,
  changed: WasChangedSinceLastSave,
  twoFaLib: TwoFaLib,
) => Promise<void>
