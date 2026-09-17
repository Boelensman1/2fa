import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import FavaLib from '../../src/FavaLib.mjs'
import { FavaLibEvent } from '../../src/FavaLibEvent.mjs'
import { CryptoError } from '../../src/FavaLibError.mjs'
import type { SyncCommand } from '../../src/interfaces/CommandTypes.mjs'
import type { SigningSecretKey } from '../../src/interfaces/CryptoLib.mjs'
import type {
  SyncDevice,
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
} from '../../src/interfaces/SyncTypes.mjs'
import type { LockedRepresentationString } from '../../src/interfaces/Vault.mjs'
import type ServerMessage from '../../src/interfaces/protocol/ServerMessage.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import NodeCryptoLib from '../../src/platformProviders/node/cryptoLib.mjs'
import {
  createEncryptionKeyPair,
  createSigningKeyPair,
} from '../../src/platformProviders/shared/curves.mjs'
import {
  buildCommandAad,
  buildCommandSignatureMessage,
} from '../../src/utils/canonical.mjs'
import { getFavaLibVaultCreationUtils } from '../../src/utils/creationUtils.mjs'
import { COMMAND_VERSION } from '../../src/version.mjs'
import { password, testServerSecret, totpEntry } from '../testUtils.mjs'

const crypto = new nodeProviders.CryptoLib()
const receiverId = 'receiver' as DeviceId
const deviceType = 'test' as DeviceType

interface Peer {
  device: Required<SyncDevice>
  signingSecretKey: SigningSecretKey
}

const makePeer = (id: string): Peer => {
  const { publicKey } = createEncryptionKeyPair()
  const { signingPublicKey, signingSecretKey } = createSigningKeyPair()
  return {
    device: {
      deviceId: id as DeviceId,
      publicKey,
      signingPublicKey,
      deviceInfo: { deviceType },
    },
    signingSecretKey,
  }
}

const alice = makePeer('alice')
const bob = makePeer('bob')
let keys: Awaited<ReturnType<typeof crypto.createKeys>>

const makeVault = (peers = [alice, bob]) =>
  new FavaLib(
    deviceType,
    nodeProviders,
    ['test'],
    keys,
    keys.symmetricKey,
    keys.encryptedSecretKeys,
    keys.encryptedSymmetricKey,
    keys.salt,
    keys.macKey,
    keys.kdf,
    keys,
    { deviceId: receiverId },
    [],
    undefined,
    {
      serverUrl: 'ws://localhost:9771',
      serverSecret: testServerSecret,
      devices: peers.map((peer) => structuredClone(peer.device)),
      commandSendQueue: [],
    },
    false,
  )

const observe = (lib: FavaLib) => {
  // Capture the existing socket boundary without opening a real connection.
  const internal = lib.sync! as unknown as {
    sendToServer: (type: string, data: { commandIds: string[] }) => void
    handleServerMessage: (message: ServerMessage) => void
  }
  const send = vi
    .spyOn(internal, 'sendToServer')
    .mockImplementation(() => undefined)
  const logs: { severity: string; message: string }[] = []
  lib.addEventListener(FavaLibEvent.Log, (event) => {
    logs.push(event.detail)
  })
  return {
    internal,
    send,
    logs,
    acknowledgments: () =>
      send.mock.calls
        .filter(([type]) => type === 'syncCommandsExecuted')
        .map(([, data]) => data.commandIds),
  }
}

const addEntry = (id: string, timestamp = Date.now()): SyncCommand => ({
  id,
  timestamp,
  version: COMMAND_VERSION,
  type: 'AddEntry',
  data: { ...totpEntry, id: id as typeof totpEntry.id },
})

const rename = (id: string, timestamp: number): SyncCommand => ({
  id,
  timestamp,
  version: COMMAND_VERSION,
  type: 'ChangeDeviceInfo',
  data: {
    deviceId: receiverId,
    newDeviceInfo: { deviceType, deviceFriendlyName: id as DeviceFriendlyName },
  },
})

const encryptCommand = async (command: SyncCommand, peer = alice) => {
  const payload = JSON.stringify(command)
  const from = peer.device.deviceId
  const signature = await crypto.sign(
    peer.signingSecretKey,
    buildCommandSignatureMessage(command.id, from, receiverId, payload),
  )
  const symmetricKey = await crypto.createSymmetricKey()
  return {
    commandId: command.id,
    encryptedSymmetricKey: await crypto.encrypt(keys.publicKey, symmetricKey),
    encryptedCommand: await crypto.encryptSymmetric(
      symmetricKey,
      JSON.stringify({ from, signature, payload }),
      buildCommandAad(command.id, receiverId),
    ),
  }
}

const reload = async (lib: FavaLib, stored?: LockedRepresentationString) => {
  const { loadFavaLibFromUnlockedSession } = getFavaLibVaultCreationUtils(
    nodeProviders,
    deviceType,
    ['test'],
  )
  return loadFavaLibFromUnlockedSession(
    stored ?? (await lib.storage.persistentStorage.getLockedRepresentation()),
    lib.storage.exportUnlockedSession(),
    { connectToSyncServer: false },
  )
}

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('sync command delivery', () => {
  let lib: FavaLib
  let observed: ReturnType<typeof observe>

  beforeAll(async () => {
    keys = await crypto.createKeys(password)
  })
  beforeEach(() => {
    lib = makeVault()
    observed = observe(lib)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies enrollment before authenticating a later command from the new peer', async () => {
    await lib.sync!.removeSyncDevice(bob.device.deviceId, false)
    const timestamp = Date.now()
    const enroll = await encryptCommand({
      id: 'enroll',
      timestamp,
      type: 'AddSyncDevice',
      data: bob.device,
    })
    const edit = await encryptCommand(addEntry('bob-entry', timestamp + 1), bob)
    // Arrival order is intentionally reversed; execution follows timestamps.
    await lib.sync!.receiveCommands([edit, enroll])
    expect(lib.vault.listEntries()).toContain('bob-entry')
    expect(observed.acknowledgments()).toEqual([['enroll', 'bob-entry']])
  })

  it('refuses a removed peer’s mutation and self-enrollment later in the batch', async () => {
    const timestamp = Date.now()
    const remove = await encryptCommand({
      id: 'remove',
      timestamp,
      type: 'RemoveSyncDevice',
      data: { deviceId: bob.device.deviceId },
    })
    const reenroll = await encryptCommand(
      {
        id: 'reenroll',
        timestamp: timestamp + 1,
        type: 'AddSyncDevice',
        data: bob.device,
      },
      bob,
    )
    const edit = await encryptCommand(
      addEntry('revoked-edit', timestamp + 2),
      bob,
    )
    await lib.sync!.receiveCommands([edit, reenroll, remove])
    expect(
      lib.sync!.getSyncDevices().map((device) => device.deviceId),
    ).not.toContain(bob.device.deviceId)
    expect(lib.vault.size).toBe(0)
    expect(observed.acknowledgments()).toEqual([['remove']])
  })

  it('retains arrival order for equal timestamps', async () => {
    const timestamp = Date.now()
    const commands = await Promise.all(
      ['first', 'second', 'third'].map((id) =>
        encryptCommand(rename(id, timestamp)),
      ),
    )
    await lib.sync!.receiveCommands(commands)
    expect(lib.meta.deviceFriendlyName).toBe('third')
    expect(observed.acknowledgments()).toEqual([['first', 'second', 'third']])
  })

  it('serializes overlapping batches through persistence and authentication', async () => {
    const timestamp = Date.now()
    const remove = await encryptCommand({
      id: 'remove',
      timestamp,
      type: 'RemoveSyncDevice',
      data: { deviceId: bob.device.deviceId },
    })
    const edit = await encryptCommand(
      addEntry('overlapping-edit', timestamp + 1),
      bob,
    )
    const saving = deferred()
    const release = deferred()
    lib.storage.setSaveFunction(async () => {
      saving.resolve()
      await release.promise
    })
    const first = lib.sync!.receiveCommands([remove])
    await saving.promise
    const second = lib.sync!.receiveCommands([edit])
    expect(observed.acknowledgments()).toEqual([])
    release.resolve()
    await Promise.all([first, second])
    expect(lib.vault.size).toBe(0)
    expect(observed.acknowledgments()).toEqual([['remove']])
  })

  it.each(['removal', 'key replacement'])(
    'rechecks the sender after %s during signature verification',
    async (action) => {
      const command = await encryptCommand(addEntry('racing-edit'), bob)
      const verifying = deferred()
      const release = deferred()
      const originalVerify = NodeCryptoLib.prototype.verify.bind(crypto)
      vi.spyOn(NodeCryptoLib.prototype, 'verify').mockImplementationOnce(
        async (...args) => {
          const valid = await originalVerify(...args)
          verifying.resolve()
          await release.promise
          return valid
        },
      )
      const receive = lib.sync!.receiveCommands([command])
      await verifying.promise
      await lib.sync!.removeSyncDevice(bob.device.deviceId, false)
      if (action === 'key replacement') {
        await lib.sync!.addSyncDevice(
          makePeer(bob.device.deviceId).device,
          false,
        )
      }
      release.resolve()
      await receive
      expect(lib.vault.size).toBe(0)
      expect(observed.acknowledgments()).toEqual([])
    },
  )

  it.each(['ascending', 'equal'])(
    'persists all replay protection for over 1,000 commands with %s timestamps',
    async (order) => {
      const timestamp = Date.now()
      const commands = []
      for (let i = 0; i < 1002; i++) {
        commands.push(
          await encryptCommand(
            rename(`burst-${i}`, timestamp + (order === 'equal' ? 0 : i)),
            i === 0 ? bob : alice,
          ),
        )
      }
      await lib.sync!.receiveCommands(commands)
      expect(observed.acknowledgments()[0]).toHaveLength(1002)
      expect(lib.meta.deviceFriendlyName).toBe('burst-1001')
      const record = lib.sync!.getProcessedCommands()!
      expect(record.commands).toHaveLength(1000)
      expect(record.floors[bob.device.deviceId]).toBe(timestamp)
      expect(record.floors[alice.device.deviceId]).toBe(
        timestamp + (order === 'equal' ? 0 : 1),
      )

      const restarted = await reload(lib)
      const restartedObserved = observe(restarted)
      // Exercise both pruned records and an exact duplicate after a real reload.
      await restarted.sync!.receiveCommands([
        commands[0],
        commands[1],
        commands[500],
      ])
      expect(restarted.meta.deviceFriendlyName).toBe('burst-1001')
      expect(restartedObserved.acknowledgments()[0]).toHaveLength(3)
    },
  )

  it('prunes old records per peer without dropping other commands in the batch', async () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000
    const commands = await Promise.all([
      encryptCommand(rename('old-1', old), bob),
      encryptCommand(rename('old-2', old), bob),
      encryptCommand(rename('current', Date.now())),
    ])
    await lib.sync!.receiveCommands(commands)
    const record = lib.sync!.getProcessedCommands()!
    expect(record.commands.map((command) => command.id)).toEqual(['current'])
    expect(record.floors).toEqual({ [bob.device.deviceId]: old })
    expect(observed.acknowledgments()).toEqual([['old-1', 'old-2', 'current']])
    observed.send.mockClear()
    // Alice has no floor even though Bob's old records were pruned.
    await lib.sync!.receiveCommands([
      await encryptCommand(rename('quiet-peer', old)),
    ])
    expect(lib.meta.deviceFriendlyName).toBe('quiet-peer')
  })

  it('acknowledges duplicates within and across batches and after restart without executing again', async () => {
    const command = await encryptCommand(addEntry('once'))
    await lib.sync!.receiveCommands([command, command])
    expect(observed.acknowledgments()).toEqual([['once']])
    await lib.vault.deleteEntry('once' as typeof totpEntry.id)
    observed.send.mockClear()
    await lib.sync!.receiveCommands([command])
    expect(lib.vault.size).toBe(0)
    expect(observed.acknowledgments()).toEqual([['once']])
    const restarted = await reload(lib)
    const restartedObserved = observe(restarted)
    await restarted.sync!.receiveCommands([command])
    expect(restarted.vault.size).toBe(0)
    expect(restartedObserved.acknowledgments()).toEqual([['once']])
    expect(
      [...observed.logs, ...restartedObserved.logs].filter(
        (log) => log.severity === 'warning',
      ),
    ).toEqual([])
  })

  it('acknowledges and warns about authenticated commands at or below the replay floor', async () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000
    const original = await encryptCommand(rename('old', old))
    await lib.sync!.receiveCommands([original])
    observed.send.mockClear()
    const older = await encryptCommand(rename('older', old - 1))
    await lib.sync!.receiveCommands([original, older])
    expect(lib.meta.deviceFriendlyName).toBe('old')
    expect(observed.acknowledgments()).toEqual([['older', 'old']])
    expect(
      observed.logs.filter((log) => log.message.includes('replay floor')),
    ).toHaveLength(2)
  })

  it('does not acknowledge forged or unauthorized replays using an applied ID', async () => {
    const command = addEntry('recorded')
    const valid = await encryptCommand(command)
    await lib.sync!.receiveCommands([valid])
    observed.send.mockClear()
    const forged = await encryptCommand(command, {
      ...alice,
      signingSecretKey: bob.signingSecretKey,
    })
    await lib.sync!.receiveCommands([forged])
    await lib.sync!.removeSyncDevice(alice.device.deviceId, false)
    await lib.sync!.receiveCommands([valid])
    expect(observed.acknowledgments()).toEqual([])
  })

  it('keeps invalid, unsupported, and unsuccessfully executed new commands unacknowledged', async () => {
    const commands = await Promise.all([
      encryptCommand({ ...addEntry('future'), version: '999.0' }),
      encryptCommand({
        id: 'failed',
        timestamp: Date.now(),
        type: 'DeleteEntry',
        data: { entryId: 'missing' as typeof totpEntry.id },
      }),
      encryptCommand({
        ...addEntry('malformed'),
        timestamp: 'bad',
      } as unknown as SyncCommand),
      encryptCommand(addEntry('good')),
    ])
    await lib.sync!.receiveCommands(commands)
    expect(lib.vault.listEntries()).toEqual(['good'])
    expect(observed.acknowledgments()).toEqual([['good']])
    expect(
      lib.sync!.getProcessedCommands()!.commands.map((command) => command.id),
    ).toEqual(['good'])
  })

  it('orders omitted timestamps as zero and rejects non-finite timestamps', async () => {
    const missing = rename('missing-timestamp', 0)
    delete missing.timestamp
    const valid = await encryptCommand(rename('finite', Date.now()))
    const noTimestamp = await encryptCommand(missing)
    // 1e999 is valid JSON but parses to Infinity. Sign those exact payload bytes.
    const payload =
      '{"id":"infinite","timestamp":1e999,"type":"AddEntry","data":{}}'
    const signature = await crypto.sign(
      alice.signingSecretKey,
      buildCommandSignatureMessage(
        'infinite',
        alice.device.deviceId,
        receiverId,
        payload,
      ),
    )
    const key = await crypto.createSymmetricKey()
    const infinite = {
      commandId: 'infinite',
      encryptedSymmetricKey: await crypto.encrypt(keys.publicKey, key),
      encryptedCommand: await crypto.encryptSymmetric(
        key,
        JSON.stringify({ from: alice.device.deviceId, signature, payload }),
        buildCommandAad('infinite', receiverId),
      ),
    }
    await lib.sync!.receiveCommands([valid, infinite, noTimestamp])
    expect(lib.meta.deviceFriendlyName).toBe('finite')
    expect(observed.acknowledgments()).toEqual([
      ['missing-timestamp', 'finite'],
    ])
    expect(
      lib.sync!.getProcessedCommands()!.floors[alice.device.deviceId],
    ).toBe(0)
  })

  it('retries a failed replay-state save before acknowledging a duplicate-only batch', async () => {
    const command = await encryptCommand(addEntry('save-retry'))
    let stored: LockedRepresentationString | undefined
    let writes = 0
    lib.storage.setSaveFunction((data) => {
      writes++
      if (writes === 2) throw new CryptoError('disk full')
      stored = data
    })
    await expect(lib.sync!.receiveCommands([command])).rejects.toThrow(
      'disk full',
    )
    expect(observed.acknowledgments()).toEqual([])
    expect(lib.vault.size).toBe(1)

    const saving = deferred()
    const release = deferred()
    lib.storage.setSaveFunction(async (data) => {
      saving.resolve()
      await release.promise
      stored = data
    })
    const retry = lib.sync!.receiveCommands([command])
    await saving.promise
    expect(observed.acknowledgments()).toEqual([])
    release.resolve()
    await retry
    expect(observed.acknowledgments()).toEqual([['save-retry']])
    expect(stored).toBeDefined()
    const restarted = await reload(lib, stored)
    expect(
      restarted
        .sync!.getProcessedCommands()!
        .commands.map((record) => record.id),
    ).toEqual(['save-retry'])
  })

  it('reports asynchronous socket receive failures and accepts subsequent batches', async () => {
    const first = await encryptCommand(addEntry('socket-save-failure'))
    let writes = 0
    lib.storage.setSaveFunction(() => {
      if (++writes === 2) throw new CryptoError('disk full')
    })
    observed.internal.handleServerMessage({
      type: 'syncCommands',
      data: [first],
    })
    await vi.waitUntil(() =>
      observed.logs.some(
        (log) => log.severity === 'error' && log.message.includes('disk full'),
      ),
    )
    expect(observed.acknowledgments()).toEqual([])
    await lib.sync!.receiveCommands([
      first,
      await encryptCommand(addEntry('after-failure')),
    ])
    expect(lib.vault.listEntries()).toEqual([
      'socket-save-failure',
      'after-failure',
    ])
    expect(observed.acknowledgments()[0]).toHaveLength(2)
  })
})
