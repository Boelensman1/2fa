import { describe, it, expect, beforeAll } from 'vitest'
import {
  getTwoFaLibVaultCreationUtils,
  type CryptoLib,
  type Passphrase,
  LockedRepresentationString,
  TwoFaLibEvent,
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
    const result = await createTwoFaLibForTests()
    cryptoLib = result.cryptoLib

    result.twoFaLib.addEventListener(TwoFaLibEvent.Changed, (evt) => {
      lockedRepresentation = evt.detail.newLockedRepresentationString
    })
    await result.twoFaLib.forceSave()

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
