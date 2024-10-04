export interface WasChangedSinceLastSave {
  lockedRepresentation: boolean
  encryptedPrivateKey: boolean
  encryptedSymmetricKey: boolean
  salt: boolean
}
