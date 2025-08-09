import { describe, it, expect, beforeAll } from 'vitest'
import {
  getFavaLibVaultCreationUtils,
  type Password,
  LockedRepresentationString,
} from '../../src/main.mjs'
import {
  createFavaLibForTests,
  deviceType,
  passwordExtraDict,
} from '../testUtils.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'

describe('creationUtils', () => {
  let creationUtils: ReturnType<typeof getFavaLibVaultCreationUtils>
  let lockedRepresentation: LockedRepresentationString

  beforeAll(async () => {
    const saveFunction = (
      newLockedRepresentation: LockedRepresentationString,
    ) => {
      lockedRepresentation = newLockedRepresentation
    }

    const result = await createFavaLibForTests(saveFunction)

    await result.favaLib.storage.forceSave()

    creationUtils = getFavaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      passwordExtraDict,
    )
  })

  // Your existing tests
  it('should throw an error on invalid password', async () => {
    await expect(
      creationUtils.loadFavaLibFromLockedRepesentation(
        lockedRepresentation,
        'not-the-password' as Password,
      ),
    ).rejects.toThrow('Invalid password')
  })
})
