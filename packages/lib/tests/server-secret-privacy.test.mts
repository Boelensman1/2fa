import { describe, it, expect, beforeAll } from 'vitest'

import {
  DeviceId,
  DeviceType,
  FavaLib,
  PlatformProviders,
  SymmetricKey,
} from '../src/main.mjs'
import type { EncryptedVaultStateString } from '../src/interfaces/BrandedTypes.mjs'
import type { VaultState } from '../src/interfaces/Vault.mjs'
import type PersistentStorageManager from '../src/subclasses/PersistentStorageManager.mjs'
import { buildVaultDataAad } from '../src/utils/canonical.mjs'
import { createFavaLibForTests, testServerSecret } from './testUtils.mjs'

/**
 * The sync server's shared secret is STORED, and never sent.
 *
 * `getEncryptedVaultState` builds both the at-rest vault state and the two
 * peer-bound ones (the initial vault of a pairing flow, and a resilver) from a
 * single object literal, so "the secret is not in the one sent to a peer" is a
 * single `forDeviceId` branch -- and exactly the sort of thing a later edit to
 * that literal silently undoes. See
 * key-hierarchy-review/16-server-authentication.md.
 */

const ownDeviceId = 'secret-privacy-device' as DeviceId
const peerDeviceId = 'secret-privacy-peer' as DeviceId
const serverUrl = 'wss://sync.example.com'

describe('the sync server secret never leaves the device', () => {
  let platformProviders: PlatformProviders
  let symmetricKey: SymmetricKey
  let storage: PersistentStorageManager

  beforeAll(async () => {
    const result = await createFavaLibForTests()
    platformProviders = result.platformProviders
    symmetricKey = result.symmetricKey

    const favaLib = new FavaLib(
      'secret-privacy' as DeviceType,
      platformProviders,
      ['test'],
      {
        privateKey: result.privateKey,
        signingSecretKey: result.signingSecretKey,
      },
      symmetricKey,
      result.encryptedSecretKeys,
      result.encryptedSymmetricKey,
      result.salt,
      result.macKey,
      result.kdf,
      {
        publicKey: result.publicKey,
        signingPublicKey: result.signingPublicKey,
      },
      { deviceId: ownDeviceId },
      [],
      undefined,
      {
        serverUrl,
        serverSecret: testServerSecret,
        devices: [],
        commandSendQueue: [],
      },
      // Do not open a socket: this is about what gets serialised, not sent.
      false,
    )

    // @ts-expect-error Accessing a private property for testing.
    storage = favaLib.mediator.getComponent('persistentStorageManager')
  })

  const aad = () => buildVaultDataAad(ownDeviceId, peerDeviceId)

  /**
   * Decrypts a vault state the way its recipient would.
   * @param encrypted - The sealed vault state.
   * @returns The vault state.
   */
  const open = async (encrypted: EncryptedVaultStateString) => {
    const cryptoLib = new platformProviders.CryptoLib()
    return JSON.parse(
      await cryptoLib.decryptSymmetric(symmetricKey, encrypted, aad()),
    ) as VaultState
  }

  it('keeps the secret in the vault state stored on this device', async () => {
    // The other half of the branch: a device that forgot its own secret on save
    // could never reconnect after a reload.
    const atRest = await open(
      await storage.getEncryptedVaultState(symmetricKey, undefined, aad()),
    )

    expect(atRest.sync.serverSecret).toBe(testServerSecret)
    expect(atRest.sync.serverUrl).toBe(serverUrl)
  })

  it('leaves the secret out of the vault state sent to a peer', async () => {
    const forPeer = await storage.getEncryptedVaultState(
      symmetricKey,
      peerDeviceId,
      aad(),
    )

    expect((await open(forPeer)).sync.serverSecret).toBeUndefined()
    // Not even inside the ciphertext, which is where a reader of this test
    // would reasonably go looking.
    const cryptoLib = new platformProviders.CryptoLib()
    expect(
      await cryptoLib.decryptSymmetric(symmetricKey, forPeer, aad()),
    ).not.toContain(testServerSecret)
  })

  it('still sends the server url, which is a deliberate difference', async () => {
    // `serverUrl` crosses and is IGNORED on arrival -- importVaultState reads
    // only `sync.devices`, which is what makes finding 12's "serverUrl cannot be
    // redirected by a forged vault state" true. The secret is held to a stricter
    // rule than that: it does not travel at all.
    const forPeer = await open(
      await storage.getEncryptedVaultState(symmetricKey, peerDeviceId, aad()),
    )

    expect(forPeer.sync.serverUrl).toBe(serverUrl)
  })
})
