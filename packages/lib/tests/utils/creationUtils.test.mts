import { describe, it, expect, beforeAll } from 'vitest'
import {
  getTwoFaLibVaultCreationUtils,
  type Password,
  LockedRepresentationString,
} from '../../src/main.mjs'
import {
  createTwoFaLibForTests,
  deviceType,
  passwordExtraDict,
} from '../testUtils.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'

describe('creationUtils', () => {
  let creationUtils: ReturnType<typeof getTwoFaLibVaultCreationUtils>
  let lockedRepresentation: LockedRepresentationString

  beforeAll(async () => {
    const saveFunction = (
      newLockedRepresentation: LockedRepresentationString,
    ) => {
      lockedRepresentation = newLockedRepresentation
    }

    const result = await createTwoFaLibForTests(saveFunction)

    await result.twoFaLib.storage.forceSave()

    creationUtils = getTwoFaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      passwordExtraDict,
    )
  })

  // Your existing tests
  it('should throw an error on invalid password', async () => {
    await expect(
      creationUtils.loadTwoFaLibFromLockedRepesentation(
        lockedRepresentation,
        'not-the-password' as Password,
      ),
    ).rejects.toThrow('Invalid password')
  })
})
