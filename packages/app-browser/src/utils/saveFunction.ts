import { EncryptedPrivateKey, EncryptedSymmetricKey, Salt } from '2falib'

const saveFunction = (
  data: {
    lockedRepresentation: string
    encryptedPrivateKey: EncryptedPrivateKey
    encryptedSymmetricKey: EncryptedSymmetricKey
    salt: Salt
  },
  changed: {
    lockedRepresentation: boolean
    encryptedPrivateKey: boolean
    encryptedSymmetricKey: boolean
    salt: boolean
  },
) => {
  Object.entries(changed).forEach(([key, isChanged]) => {
    if (isChanged) {
      localStorage.setItem(key, data[key as keyof typeof changed])
    }
  })
  return Promise.resolve()
}

export default saveFunction
