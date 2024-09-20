import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
} from '../interfaces/CryptoLib.js'

export interface SaveFunctionData {
  lockedRepresentation: string
  encryptedPrivateKey: EncryptedPrivateKey
  encryptedSymmetricKey: EncryptedSymmetricKey
  salt: Salt
}
export type SaveFunction = (
  data: SaveFunctionData,
  changed: {
    lockedRepresentation: boolean
    encryptedPrivateKey: boolean
    encryptedSymmetricKey: boolean
    salt: boolean
  },
) => Promise<void>
