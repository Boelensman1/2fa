import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  FavaLib,
  getFavaLibVaultCreationUtils,
  type DeviceId,
  type MacKey,
  type Password,
  type ServerSecret,
  LockedRepresentation,
  LockedRepresentationString,
  StorageVersionError,
  InitializationError,
  type PublicKey,
  type SigningPublicKey,
  type SymmetricKey,
} from '../../src/main.mjs'
import type {
  VaultState,
  VaultStateString,
} from '../../src/interfaces/Vault.mjs'
import {
  buildEnvelopeMacMessage,
  buildVaultAad,
} from '../../src/utils/canonical.mjs'
import { MAX_SYNC_DEVICES } from '../../src/utils/syncDeviceValidation.mjs'
import {
  createFavaLibForTests,
  newTotpEntry,
  deviceType,
  deviceId,
  password,
  passwordExtraDict,
  testServerSecret,
} from '../testUtils.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'

describe('creationUtils', () => {
  let creationUtils: ReturnType<typeof getFavaLibVaultCreationUtils>
  let lockedRepresentation: LockedRepresentationString
  let macKey: MacKey
  let symmetricKey: SymmetricKey
  let devicePublicKey: PublicKey
  let deviceSigningPublicKey: SigningPublicKey

  beforeAll(async () => {
    const saveFunction = (
      newLockedRepresentation: LockedRepresentationString,
    ) => {
      lockedRepresentation = newLockedRepresentation
    }

    const result = await createFavaLibForTests(saveFunction)
    macKey = result.macKey
    symmetricKey = result.symmetricKey
    devicePublicKey = result.publicKey
    deviceSigningPublicKey = result.signingPublicKey

    await result.favaLib.storage.forceSave()

    creationUtils = getFavaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      passwordExtraDict,
    )
  })

  // Your existing tests
  describe('storageVersion guard', () => {
    const withStorageVersion = (value: unknown): LockedRepresentationString => {
      const parsed = JSON.parse(lockedRepresentation) as Record<string, unknown>
      parsed.storageVersion = value
      return JSON.stringify(parsed) as LockedRepresentationString
    }

    it('refuses a vault written by a newer library, and says why', async () => {
      const rejects = expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(99),
          password,
        ),
      ).rejects
      await rejects.toThrow(StorageVersionError)
      // Naming the version, and not telling them to reset a vault that a newer
      // build can still open.
      await rejects.toThrow(/storage version 99.*only supports up to 2/s)
    })

    it('refuses before attempting any decryption', async () => {
      // The wrong password would normally produce 'Invalid password'. Getting
      // the version error instead is what proves the guard runs first -- which
      // matters because a future format must not reach decryptKeys at all.
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(99),
          'not-the-password' as Password,
        ),
      ).rejects.toThrow(StorageVersionError)
    })

    it.each([
      ['a numeric string', '2'],
      ['a non-integer', 1.5],
      ['zero', 0],
      ['a negative number', -1],
      ['null', null],
      ['an object', {}],
    ])('rejects %s as an invalid storageVersion', async (_label, value) => {
      // '2' is the case that matters most: reading the field through the
      // Partial<LockedRepresentation> cast would coerce it, making '2' > 1
      // true and giving the right answer for the wrong reason.
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(value),
          password,
        ),
      ).rejects.toThrow(StorageVersionError)
    })

    it('does not let libVersion gate a load', async () => {
      // libVersion records which build wrote the vault; it must never decide
      // whether one opens, or a newer library would refuse its own vaults.
      //
      // It IS covered by the envelope MAC, though -- the rule there is
      // "everything but the MAC" -- so changing it means re-issuing the MAC,
      // which is what a legitimate writer would do. The tampering case, where
      // the MAC is left stale, is asserted in envelope-mac.test.mts.
      const parsed = JSON.parse(lockedRepresentation) as LockedRepresentation
      parsed.libVersion = '99.0.0'
      const cryptoLib = new nodeProviders.CryptoLib()
      parsed.envelopeMac = await cryptoLib.createEnvelopeMac(
        macKey,
        buildEnvelopeMacMessage(parsed),
      )

      const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
        JSON.stringify(parsed) as LockedRepresentationString,
        password,
        { connectToSyncServer: false },
      )
      await favaLib.ready
      expect(favaLib.meta.deviceId).toBeTruthy()
      favaLib.sync?.closeServerConnection()
    })
  })

  it('loads offline without a socket and persists queued commands', async () => {
    const result = await createFavaLibForTests()
    const WebSocketLib = vi.fn(nodeProviders.WebSocketLib)
    const offlineProviders = { ...nodeProviders, WebSocketLib }
    let savedRepresentation: LockedRepresentationString | undefined

    const offlineFavaLib = new FavaLib(
      deviceType,
      offlineProviders,
      passwordExtraDict,
      {
        privateKey: result.privateKey,
        signingSecretKey: result.signingSecretKey,
      },
      result.symmetricKey,
      result.encryptedSecretKeys,
      result.encryptedSymmetricKey,
      result.salt,
      result.macKey,
      result.kdf,
      {
        publicKey: result.publicKey,
        signingPublicKey: result.signingPublicKey,
      },
      { deviceId },
      [],
      (representation: LockedRepresentationString) => {
        savedRepresentation = representation
      },
      {
        serverUrl: 'ws://offline.test',
        serverSecret: testServerSecret,
        devices: [
          {
            deviceId: 'other-device' as DeviceId,
            publicKey: result.publicKey,
            signingPublicKey: result.signingPublicKey,
            deviceInfo: { deviceType },
          },
        ],
        commandSendQueue: [],
        removedDevices: { ['removed-peer' as DeviceId]: 1234 },
      },
      false,
    )

    await offlineFavaLib.ready
    await offlineFavaLib.vault.addEntry(newTotpEntry)

    expect(WebSocketLib).not.toHaveBeenCalled()
    expect(offlineFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)
    expect(savedRepresentation).toBeDefined()

    const offlineCreationUtils = getFavaLibVaultCreationUtils(
      offlineProviders,
      deviceType,
      passwordExtraDict,
    )
    const reloadedFavaLib =
      await offlineCreationUtils.loadFavaLibFromLockedRepesentation(
        savedRepresentation!,
        password,
        { connectToSyncServer: false },
      )

    await reloadedFavaLib.ready
    expect(WebSocketLib).not.toHaveBeenCalled()
    expect(reloadedFavaLib.vault.size).toBe(1)
    expect(reloadedFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)
    reloadedFavaLib.sync?.closeServerConnection()

    const syncServer = {
      serverUrl: 'wss://replacement.example.com/sync',
      serverSecret: 'rotated-secret' as ServerSecret,
    }
    const overridden =
      await offlineCreationUtils.loadFavaLibFromLockedRepesentation(
        savedRepresentation!,
        password,
        { connectToSyncServer: false, syncServer },
      )
    await overridden.ready
    expect(WebSocketLib).not.toHaveBeenCalled()
    expect(overridden.sync?.serverUrl).toBe(syncServer.serverUrl)
    expect(overridden.sync?.serverSecret).toBe(syncServer.serverSecret)
    expect(overridden.sync?.getSyncDevices()).toEqual(
      reloadedFavaLib.sync?.getSyncDevices(),
    )
    expect(overridden.sync?.getCommandSendQueue()).toEqual(
      reloadedFavaLib.sync?.getCommandSendQueue(),
    )
    expect(overridden.sync?.getRemovedDevices()).toEqual({
      'removed-peer': 1234,
    })

    const saved =
      await overridden.storage.persistentStorage.getLockedRepresentation()
    const restored =
      await offlineCreationUtils.loadFavaLibFromLockedRepesentation(
        saved,
        password,
        { connectToSyncServer: false },
      )
    expect(restored.sync?.serverUrl).toBe(syncServer.serverUrl)
    expect(restored.sync?.serverSecret).toBe(syncServer.serverSecret)
    overridden.sync?.closeServerConnection()
    restored.sync?.closeServerConnection()
  })

  it('configures a previously unsynced vault on load', async () => {
    const syncServer = {
      serverUrl: 'wss://sync.example.com',
      serverSecret: testServerSecret,
    }
    const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
      lockedRepresentation,
      password,
      { connectToSyncServer: false, syncServer },
    )
    await favaLib.ready
    expect(favaLib.sync?.serverUrl).toBe(syncServer.serverUrl)
    expect(favaLib.sync?.serverSecret).toBe(syncServer.serverSecret)
    expect(favaLib.sync?.webSocketConnected).toBe(false)
    favaLib.sync?.closeServerConnection()
  })

  // Reaching the load path's validation means a blob that is cryptographically
  // perfect and semantically wrong, so every case here re-encrypts under the
  // real symmetric key AND re-issues the envelope MAC -- exactly what a
  // legitimate writer on an older, laxer favalib would have produced.
  describe('vault state validation', () => {
    const cryptoLib = new nodeProviders.CryptoLib()

    const reseal = async (
      mutate: (state: VaultState) => void,
    ): Promise<LockedRepresentationString> => {
      const parsed = JSON.parse(lockedRepresentation) as LockedRepresentation
      const aad = buildVaultAad(
        parsed.storageVersion,
        parsed.salt,
        parsed.kdf,
        await cryptoLib.sha256(parsed.encryptedSecretKeys),
      )
      const state = JSON.parse(
        await cryptoLib.decryptSymmetric(
          symmetricKey,
          parsed.encryptedVaultState,
          aad,
        ),
      ) as VaultState
      mutate(state)
      parsed.encryptedVaultState = await cryptoLib.encryptSymmetric(
        symmetricKey,
        JSON.stringify(state) as VaultStateString,
        aad,
      )
      parsed.envelopeMac = await cryptoLib.createEnvelopeMac(
        macKey,
        buildEnvelopeMacMessage(parsed),
      )
      return JSON.stringify(parsed) as LockedRepresentationString
    }

    const load = (representation: LockedRepresentationString) =>
      creationUtils.loadFavaLibFromLockedRepesentation(
        representation,
        password,
        { connectToSyncServer: false },
      )

    const goodEntry = {
      id: 'good-entry-id',
      name: 'Good',
      issuer: 'Issuer',
      type: 'TOTP',
      matchers: [],
      url: null,
      inputSelector: null,
      addedAt: 1,
      updatedAt: null,
      payload: {
        secret: 'JBSWY3DPEHPK3PXP',
        period: 30,
        algorithm: 'SHA-1',
        digits: 6,
      },
    }

    const goodDevice = () => ({
      deviceId: 'peer-device-id' as DeviceId,
      publicKey: devicePublicKey,
      signingPublicKey: deviceSigningPublicKey,
      deviceInfo: { deviceType },
    })

    it('still opens a resealed but unmodified vault', async () => {
      // Without this the assertions below would pass for the wrong reason:
      // reseal itself has to produce a loadable blob.
      const favaLib = await load(await reseal(() => undefined))
      await favaLib.ready
      expect(favaLib.meta.deviceId).toBeTruthy()
      favaLib.sync?.closeServerConnection()
    })

    it('opens a vault whose entries and devices are all usable', async () => {
      const favaLib = await load(
        await reseal((state) => {
          state.vault = [goodEntry] as unknown as VaultState['vault']
          state.sync.devices = [goodDevice()]
        }),
      )
      await favaLib.ready
      expect(favaLib.vault.size).toBe(1)
      favaLib.sync?.closeServerConnection()
    })

    it('refuses a vault carrying an unusable entry, and names it', async () => {
      // REFUSING, not dropping, the one place this diverges from the tier
      // policy in entryValidation.mts:69-74: a dropped remote command is
      // redelivered by the server, a dropped entry is erased by the next
      // ordinary save.
      const representation = await reseal((state) => {
        state.vault = [
          goodEntry,
          { ...goodEntry, id: 'bad-entry-id', payload: { secret: '' } },
        ] as unknown as VaultState['vault']
      })

      await expect(load(representation)).rejects.toThrow(InitializationError)
      await expect(load(representation)).rejects.toThrow(
        /bad-entry-id.*payload\.secret is missing.*data is intact/s,
      )
    })

    it.each([
      [
        'a non-array vault',
        (state: VaultState) => {
          state.vault = 'nope' as unknown as VaultState['vault']
        },
      ],
      [
        'a non-array device list',
        (state: VaultState) => {
          state.sync.devices = 42 as unknown as VaultState['sync']['devices']
        },
      ],
      [
        'a non-array command queue',
        (state: VaultState) => {
          state.sync.commandSendQueue =
            null as unknown as VaultState['sync']['commandSendQueue']
        },
      ],
    ])('refuses %s', async (_label, mutate) => {
      await expect(load(await reseal(mutate))).rejects.toThrow(
        /incomplete or corrupted/,
      )
    })

    it('refuses a sync device with no publicKey, and names it', async () => {
      const representation = await reseal((state) => {
        state.sync.devices = [
          {
            deviceId: 'peer-device-id' as DeviceId,
            deviceInfo: { deviceType },
          },
        ] as unknown as VaultState['sync']['devices']
      })

      await expect(load(representation)).rejects.toThrow(
        /peer-device-id.*no usable publicKey/s,
      )
    })

    it('accepts a vault with no replay-protection record at all', async () => {
      // Absent means "this device has applied nothing yet", which is true of
      // every vault written before the record existed.
      const favaLib = await load(
        await reseal((state) => {
          delete state.sync.processedCommands
        }),
      )
      await favaLib.ready
      favaLib.sync?.closeServerConnection()
    })

    it.each([
      [
        'a non-array command list',
        (state: VaultState) => {
          state.sync.processedCommands = {
            commands: null as never,
            floors: {},
          }
        },
      ],
      [
        'an entry with no timestamp',
        (state: VaultState) => {
          state.sync.processedCommands = {
            commands: [{ id: 'x', from: 'peer' as DeviceId } as never],
            floors: {},
          }
        },
      ],
      [
        'a non-numeric floor',
        (state: VaultState) => {
          state.sync.processedCommands = {
            commands: [],
            floors: { peer: 'soon' } as never,
          }
        },
      ],
    ])('refuses %s in the replay-protection record', async (_label, mutate) => {
      // REFUSED rather than reset, unlike the dropped remote commands above
      // it: silently starting replay protection over is the one repair whose
      // cost is invisible, because the vault works perfectly afterwards and
      // simply accepts commands it has already applied.
      await expect(load(await reseal(mutate))).rejects.toThrow(
        /replay-protection record is unusable/,
      )
    })

    it('refuses more than MAX_SYNC_DEVICES devices', async () => {
      const representation = await reseal((state) => {
        state.sync.devices = Array.from(
          { length: MAX_SYNC_DEVICES + 1 },
          (_, i) => ({ ...goodDevice(), deviceId: `peer-${i}` as DeviceId }),
        )
      })

      await expect(load(representation)).rejects.toThrow(
        new RegExp(`${MAX_SYNC_DEVICES + 1} sync devices`),
      )
    })

    it('accepts exactly MAX_SYNC_DEVICES devices', async () => {
      // Pins that the cap is not off by one, which is the only way a limit
      // like this ever breaks a real user.
      const favaLib = await load(
        await reseal((state) => {
          state.sync.devices = Array.from(
            { length: MAX_SYNC_DEVICES },
            (_, i) => ({ ...goodDevice(), deviceId: `peer-${i}` as DeviceId }),
          )
        }),
      )
      await favaLib.ready
      favaLib.sync?.closeServerConnection()
    })

    it('accepts a vault with no record of removed devices', async () => {
      // Absent means "this vault has removed nothing", which is true of every
      // vault written before tombstones existed.
      const favaLib = await load(
        await reseal((state) => {
          delete state.sync.removedDevices
        }),
      )
      await favaLib.ready
      favaLib.sync?.closeServerConnection()
    })

    it('refuses an unusable removed-device record', async () => {
      // One representative case. Which shapes are unusable is settled directly
      // in utils/syncDeviceValidation.test.mts; what the load path adds is that
      // it consults that validator at all -- and refuses rather than resetting,
      // the same call the replay record gets and for the same reason: a vault
      // that has quietly forgotten what it revoked works perfectly and accepts
      // a device the user removed.
      await expect(
        load(
          await reseal((state: VaultState) => {
            state.sync.removedDevices = 'old-phone' as never
          }),
        ),
      ).rejects.toThrow(/record of removed devices is unusable/)
    })

    it('refuses a vault that both lists and tombstones a device', async () => {
      // A contradiction this library cannot write: removal splices and
      // tombstones together, and addSyncDevice refuses a tombstoned id. So it
      // is a vault edited from outside, and resolving it in favour of the
      // device list would silently discard a revocation.
      const representation = await reseal((state) => {
        state.sync.devices = [
          { ...goodDevice(), deviceId: 'zombie' as DeviceId },
        ]
        state.sync.removedDevices = { ['zombie' as DeviceId]: 1 }
      })

      await expect(load(representation)).rejects.toThrow(
        /lists sync device zombie and also records it as removed/,
      )
    })
  })

  describe('envelope validation', () => {
    it('reports a truncated file as an InitializationError, not a SyntaxError', async () => {
      // A half-written vault.json used to surface as a bare SyntaxError, which
      // is neither a FavaLibError nor anything a consumer can show a user.
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          lockedRepresentation.slice(0, 40) as LockedRepresentationString,
          password,
        ),
      ).rejects.toThrow(InitializationError)
    })

    it.each([
      ['a numeric salt', 'salt', 12345],
      ['an object salt', 'salt', { value: 'AAAA' }],
      ['a numeric encryptedVaultState', 'encryptedVaultState', 1],
      ['an object encryptedSecretKeys', 'encryptedSecretKeys', {}],
      ['a string kdf', 'kdf', 'argon2id'],
      ['a numeric envelopeMac', 'envelopeMac', 7],
    ])('refuses %s', async (_label, field, value) => {
      // These used to pass a truthiness check behind an unchecked
      // `as Partial<LockedRepresentation>` cast and fail much later, somewhere
      // unrecognisable.
      const parsed = JSON.parse(lockedRepresentation) as Record<string, unknown>
      parsed[field] = value

      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          JSON.stringify(parsed) as LockedRepresentationString,
          password,
        ),
      ).rejects.toThrow(/incomplete or corrupted/)
    })

    it.each(['encryptedSecretKeys', 'kdf', 'envelopeMac'])(
      'refuses a blob with no %s at all',
      async (field) => {
        // While two storage formats existed these three were checked
        // separately, because a version 1 vault legitimately carried none of
        // them and calling it "incomplete" would have been the wrong message.
        // With one format left there is nothing conditional about them.
        const parsed = JSON.parse(lockedRepresentation) as Record<
          string,
          unknown
        >
        delete parsed[field]

        await expect(
          creationUtils.loadFavaLibFromLockedRepesentation(
            JSON.stringify(parsed) as LockedRepresentationString,
            password,
          ),
        ).rejects.toThrow(/incomplete or corrupted/)
      },
    )
  })
})
