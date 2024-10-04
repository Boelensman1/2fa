import {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  TwoFaLib,
  UserId,
} from '2falib'

const saveFunction =
  (syncWithStore: (twoFaLib: TwoFaLib) => void) =>
  (
    data: {
      lockedRepresentation: string
      encryptedPrivateKey: EncryptedPrivateKey
      encryptedSymmetricKey: EncryptedSymmetricKey
      salt: Salt
      userId: UserId
    },
    changed: {
      lockedRepresentation: boolean
      encryptedPrivateKey: boolean
      encryptedSymmetricKey: boolean
      salt: boolean
      userId: boolean
    },
    twoFaLib: TwoFaLib,
  ) => {
    Object.entries(changed).forEach(([key, isChanged]) => {
      if (isChanged) {
        localStorage.setItem(key, data[key as keyof typeof changed])
      }
    })
    console.log(syncWithStore, twoFaLib)
    syncWithStore(twoFaLib)
    return Promise.resolve()
  }

export default saveFunction
