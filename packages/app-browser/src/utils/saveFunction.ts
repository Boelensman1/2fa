import {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  UserId,
} from '2falib'

const saveFunction = (
  changed: {
    lockedRepresentation: boolean
    encryptedPrivateKey: boolean
    encryptedSymmetricKey: boolean
    salt: boolean
    userId: boolean
  },
  data: {
    lockedRepresentation: string
    encryptedPrivateKey: EncryptedPrivateKey
    encryptedSymmetricKey: EncryptedSymmetricKey
    salt: Salt
    userId: UserId
  },
) => {
  Object.entries(changed).forEach(([key, isChanged]) => {
    if (isChanged) {
      localStorage.setItem(key, data[key as keyof typeof changed])
    }
  })
}

export default saveFunction
