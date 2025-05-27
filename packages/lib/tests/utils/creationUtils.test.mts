import { describe, it, expect, beforeAll } from 'vitest'
import {
  getTwoFaLibVaultCreationUtils,
  type CryptoLib,
  type Passphrase,
  LockedRepresentationString,
} from '../../src/main.mjs'
import {
  createTwoFaLibForTests,
  deviceType,
  passphraseExtraDict,
} from '../testUtils.mjs'

describe('creationUtils', () => {
  let cryptoLib: CryptoLib
  let creationUtils: ReturnType<typeof getTwoFaLibVaultCreationUtils>
  let lockedRepresentation: LockedRepresentationString

  beforeAll(async () => {
    const saveFunction = (
      newLockedRepresentation: LockedRepresentationString,
    ) => {
      lockedRepresentation = newLockedRepresentation
    }

    const result = await createTwoFaLibForTests(saveFunction)
    cryptoLib = result.cryptoLib

    await result.twoFaLib.storage.forceSave()

    creationUtils = getTwoFaLibVaultCreationUtils(
      cryptoLib,
      deviceType,
      passphraseExtraDict,
    )
  })

  // Your existing tests
  it('should throw an error on invalid passphrase', async () => {
    await expect(
      creationUtils.loadTwoFaLibFromLockedRepesentation(
        lockedRepresentation,
        'not-the-passphrase' as Passphrase,
      ),
    ).rejects.toThrow('Invalid passphrase')
  })
})
