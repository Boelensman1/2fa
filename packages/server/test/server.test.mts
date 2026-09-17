// The `expect(ws.close)` assertions below read a vi.fn off a plain object, not
// a class method, so the `this` this rule is about does not exist here.
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'

import { createSyncServerCore } from '../src/createSyncServer.mjs'
import { UNAUTHORIZED_CLOSE_CODE } from '../src/ConnectionAuthManager.mjs'
import UnExecutedSyncCommand from '../src/models/UnExecutedSyncCommand.mjs'
import { config } from '../src/config.mjs'

import { createConnectProof } from 'favalib/protocol/connectAuth'
import type ClientMessage from 'favalib/protocol/ClientMessage'
import type {
  DeviceId,
  Encrypted,
  EncryptedSymmetricKey,
  ServerSecret,
} from 'favalib/types'
import { cleanupTestDatabase, initializeTestDatabase } from './test-setup.mjs'

/**
 * These drive the REAL handler, imported from src.
 *
 * They used to drive a hand-written copy of it, kept in this file, because
 * `server.mts` opened a listener at module scope and could not be imported. A
 * copy passes whatever the copy does: it had already drifted (no duplicate
 * tolerance, no `vault`, no `startResilver`), and it could not have caught
 * anything about the connection gate, since the gate would not have been in it.
 * `createSyncServer.mts` exists so this file can stop guessing.
 */

const sharedSecret = config.sync.sharedSecret as ServerSecret

/**
 * A socket that records what was sent to it and whether it was closed.
 * @returns The fake socket.
 */
const makeWs = () => {
  const ws = {
    send: vi.fn<(data: string) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
    on: vi.fn(),
  }
  return ws as unknown as WebSocket & typeof ws
}

/**
 * Reads back the messages a socket was sent, decoded.
 * @param ws - The socket to read.
 * @returns The decoded messages, in order.
 */
const sentTo = (ws: ReturnType<typeof makeWs>) =>
  ws.send.mock.calls.map(
    ([data]) => JSON.parse(data) as { type: string; data?: unknown },
  )

describe('Server message handling', () => {
  let core: ReturnType<typeof createSyncServerCore>
  let ws: ReturnType<typeof makeWs>

  /**
   * Puts a socket through the connection gate, the way a real client does.
   * @param socket - The socket to authenticate.
   */
  const authenticate = (socket: ReturnType<typeof makeWs>) => {
    const nonce = core.connectionAuth.issueChallenge(socket)
    core.handleMessage(socket, {
      type: 'authProof',
      data: { proof: createConnectProof(sharedSecret, nonce) },
    })
  }

  beforeEach(() => {
    initializeTestDatabase()
    core = createSyncServerCore(sharedSecret)
    ws = makeWs()
    authenticate(ws)
    ws.send.mockClear()
  })

  afterEach(async () => {
    core.connectionAuth.clear()
    vi.clearAllMocks()
    await cleanupTestDatabase()
  })

  describe('the connection gate', () => {
    // The secret is proved, not sent: what crosses the wire is an HMAC over a
    // nonce the server drew.
    it('accepts a proof made with the configured secret', () => {
      const fresh = makeWs()
      const nonce = core.connectionAuth.issueChallenge(fresh)

      core.handleMessage(fresh, {
        type: 'authProof',
        data: { proof: createConnectProof(sharedSecret, nonce) },
      })

      expect(sentTo(fresh)).toEqual([{ type: 'authAccepted', data: {} }])
      expect(fresh.close).not.toHaveBeenCalled()
      expect(core.connectionAuth.isAuthenticated(fresh)).toBe(true)
    })

    it('closes a socket whose proof was made with another secret', () => {
      const fresh = makeWs()
      const nonce = core.connectionAuth.issueChallenge(fresh)

      core.handleMessage(fresh, {
        type: 'authProof',
        data: {
          proof: createConnectProof(
            'a-completely-different-shared-secret!' as ServerSecret,
            nonce,
          ),
        },
      })

      expect(fresh.close).toHaveBeenCalledWith(
        UNAUTHORIZED_CLOSE_CODE,
        'Unauthorized',
      )
      expect(core.connectionAuth.isAuthenticated(fresh)).toBe(false)
    })

    it('gives a socket one guess per connection, not one per message', () => {
      const fresh = makeWs()
      const nonce = core.connectionAuth.issueChallenge(fresh)

      core.handleMessage(fresh, { type: 'authProof', data: { proof: 'wrong' } })
      // The nonce is consumed by the first attempt, so even the right answer to
      // it is refused afterwards. Guessing means reconnecting.
      core.handleMessage(fresh, {
        type: 'authProof',
        data: { proof: createConnectProof(sharedSecret, nonce) },
      })

      expect(core.connectionAuth.isAuthenticated(fresh)).toBe(false)
      expect(sentTo(fresh)).toEqual([])
    })

    it('refuses a connect from a socket that has not proved itself', () => {
      // The hijack this finding is about: claiming someone else's deviceId used
      // to displace them and hand over their queued commands.
      const fresh = makeWs()
      core.connectionAuth.issueChallenge(fresh)

      core.handleMessage(fresh, {
        type: 'connect',
        data: { deviceId: 'device-1' as DeviceId },
      })

      expect(fresh.close).toHaveBeenCalledWith(
        UNAUTHORIZED_CLOSE_CODE,
        'Unauthorized',
      )
      expect(
        core.connectedDevices.getWs('device-1' as DeviceId),
      ).toBeUndefined()
      expect(sentTo(fresh)).toEqual([])
    })

    it.each([
      ['syncCommands', { commands: [] }],
      ['syncCommandsExecuted', { commandIds: [] }],
      ['startResilver', { deviceIds: [] }],
      ['addSyncDeviceInitialiseData', { initiatorDeviceId: 'd', timestamp: 0 }],
    ])('refuses an unauthenticated %s', (type, data) => {
      const fresh = makeWs()
      core.connectionAuth.issueChallenge(fresh)

      core.handleMessage(fresh, { type, data } as unknown as ClientMessage)

      expect(fresh.close).toHaveBeenCalledWith(
        UNAUTHORIZED_CLOSE_CODE,
        'Unauthorized',
      )
      expect(sentTo(fresh)).toEqual([])
    })

    it('does not tell a prober which half it got wrong', () => {
      // A wrong secret and a message sent too early are the same refusal, with
      // the same code and the same reason.
      const wrongSecret = makeWs()
      core.connectionAuth.issueChallenge(wrongSecret)
      core.handleMessage(wrongSecret, {
        type: 'authProof',
        data: { proof: 'wrong' },
      })

      const tooEarly = makeWs()
      core.connectionAuth.issueChallenge(tooEarly)
      core.handleMessage(tooEarly, {
        type: 'connect',
        data: { deviceId: 'device-1' as DeviceId },
      })

      expect(wrongSecret.close.mock.calls).toEqual(tooEarly.close.mock.calls)
    })
  })

  describe('connect message', () => {
    it('should add device to connected devices manager', () => {
      core.handleMessage(ws, {
        type: 'connect',
        data: { deviceId: 'device-1' as DeviceId },
      })

      expect(core.connectedDevices.getWs('device-1' as DeviceId)).toBe(ws)
      expect(core.connectedDevices.getDeviceId(ws)).toBe('device-1')
    })

    it('should query for unexecuted sync commands', async () => {
      const deviceId = 'device-1' as DeviceId
      const commandId = randomUUID()

      await UnExecutedSyncCommand.query().insert({
        commandId,
        deviceId,
        encryptedCommand: randomUUID() as Encrypted<string>,
        encryptedSymmetricKey: 'test-key' as EncryptedSymmetricKey,
      })

      core.handleMessage(ws, { type: 'connect', data: { deviceId } })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(sentTo(ws)).toContainEqual({
        type: 'syncCommands',
        data: expect.arrayContaining([
          expect.objectContaining({
            commandId,
            encryptedSymmetricKey: 'test-key',
          }),
        ]) as unknown,
      })
    })
  })

  describe('addSyncDeviceInitialiseData message', () => {
    it('should send confirmation and add to ongoing requests', () => {
      core.handleMessage(ws, {
        type: 'addSyncDeviceInitialiseData',
        data: {
          initiatorDeviceId: 'device-1' as DeviceId,
          timestamp: Date.now(),
        },
      })

      expect(sentTo(ws)).toEqual([
        { type: 'confirmAddSyncDeviceInitialiseData', data: {} },
      ])
      expect(core.ongoingAddDeviceRequests).toHaveLength(1)
      expect(core.ongoingAddDeviceRequests[0]).toMatchObject({
        initiatorDeviceId: 'device-1',
        wsInitiator: ws,
      })
    })
  })

  describe('JPAKEPass2 message', () => {
    const pass2Data = {
      pass2Result: {
        round1Result: {
          G1: { 0: 1, 1: 2, 2: 3 },
          G2: { 0: 4, 1: 5, 2: 6 },
          ZKPx1: { 0: 7, 1: 8, 2: 9 },
          ZKPx2: { 0: 10, 1: 11, 2: 12 },
        },
        round2Result: {
          A: { 0: 13, 1: 14, 2: 15 },
          ZKPx2s: { 0: 16, 1: 17, 2: 18 },
        },
      },
      responderDeviceId: 'device-2' as DeviceId,
      initiatorDeviceId: 'device-1' as DeviceId,
    }

    it('should forward message to initiator and set responder', () => {
      const initiatorWs = makeWs()
      authenticate(initiatorWs)
      core.ongoingAddDeviceRequests.push({
        initiatorDeviceId: 'device-1' as DeviceId,
        wsInitiator: initiatorWs,
        timestamp: Date.now(),
      })

      core.handleMessage(ws, { type: 'JPAKEPass2', data: pass2Data })

      expect(sentTo(initiatorWs)).toContainEqual({
        type: 'JPAKEPass2',
        data: pass2Data,
      })
      expect(core.ongoingAddDeviceRequests[0].wsResponder).toBe(ws)
    })

    it('should handle request not found error', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      core.handleMessage(ws, {
        type: 'JPAKEPass2',
        data: {
          ...pass2Data,
          initiatorDeviceId: 'non-existent-device' as DeviceId,
        },
      })

      expect(consoleSpy).toHaveBeenCalledWith('Request not found')
      consoleSpy.mockRestore()
    })
  })

  describe('syncCommands message', () => {
    it('should insert commands and send to target devices', async () => {
      const targetWs = makeWs()
      authenticate(targetWs)
      core.handleMessage(targetWs, {
        type: 'connect',
        data: { deviceId: 'device-1' as DeviceId },
      })

      const commandId = randomUUID()
      core.handleMessage(ws, {
        type: 'syncCommands',
        data: {
          commands: [
            {
              commandId,
              deviceId: 'device-1' as DeviceId,
              encryptedCommand: randomUUID() as Encrypted<string>,
              encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
            },
          ],
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const insertedCommand = await UnExecutedSyncCommand.query()
        .where({ commandId, deviceId: 'device-1' })
        .first()

      expect(insertedCommand).toBeDefined()
      expect(insertedCommand!.encryptedCommand).toBeDefined()
      expect(insertedCommand!.encryptedSymmetricKey).toBe('encrypted-key')

      expect(sentTo(ws)).toContainEqual({
        type: 'syncCommandsReceived',
        data: { commandIds: [commandId] },
      })
      expect(sentTo(targetWs)).toContainEqual({
        type: 'syncCommands',
        data: [expect.objectContaining({ commandId }) as unknown],
      })
    })
  })

  describe('syncCommandsExecuted message', () => {
    it('should delete executed commands from database', async () => {
      const deviceId = 'device-1' as DeviceId
      core.handleMessage(ws, { type: 'connect', data: { deviceId } })

      const cmd1Id = randomUUID()
      const cmd2Id = randomUUID()
      const cmd3Id = randomUUID()

      await UnExecutedSyncCommand.query().insert(
        [cmd1Id, cmd2Id, cmd3Id].map((commandId, index) => ({
          commandId,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: `key${index}` as EncryptedSymmetricKey,
        })),
      )

      core.handleMessage(ws, {
        type: 'syncCommandsExecuted',
        data: { commandIds: [cmd1Id, cmd2Id] },
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const remaining = await UnExecutedSyncCommand.query().where({ deviceId })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].commandId).toBe(cmd3Id)
    })
  })

  describe('addSyncDeviceCancelled message', () => {
    it('should remove request and notify initiator', () => {
      const initiatorWs = makeWs()
      authenticate(initiatorWs)
      core.ongoingAddDeviceRequests.push({
        initiatorDeviceId: 'device-1' as DeviceId,
        wsInitiator: initiatorWs,
        wsResponder: ws,
        timestamp: Date.now(),
      })

      core.handleMessage(ws, {
        type: 'addSyncDeviceCancelled',
        data: { initiatorDeviceId: 'device-1' as DeviceId },
      })

      expect(core.ongoingAddDeviceRequests).toHaveLength(0)
      expect(sentTo(initiatorWs)).toContainEqual({
        type: 'addSyncDeviceCancelled',
      })
    })

    it('should handle request not found', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      core.handleMessage(ws, {
        type: 'addSyncDeviceCancelled',
        data: { initiatorDeviceId: 'non-existent-device' as DeviceId },
      })

      expect(consoleSpy).toHaveBeenCalledWith('Request not found')
      consoleSpy.mockRestore()
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle missing device connections gracefully', () => {
      const commandId = randomUUID()

      expect(() =>
        core.handleMessage(ws, {
          type: 'syncCommands',
          data: {
            commands: [
              {
                commandId,
                deviceId: 'offline-device' as DeviceId,
                encryptedCommand: randomUUID() as Encrypted<string>,
                encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
              },
            ],
          },
        }),
      ).not.toThrow()
    })

    it('should handle database constraint violations gracefully', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const duplicateCommandId = randomUUID()

      await UnExecutedSyncCommand.query().insert({
        commandId: duplicateCommandId,
        deviceId: 'device-1' as DeviceId,
        encryptedCommand: randomUUID() as Encrypted<string>,
        encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
      })

      expect(() =>
        core.handleMessage(ws, {
          type: 'syncCommands',
          data: {
            commands: [
              {
                commandId: duplicateCommandId,
                deviceId: 'device-1' as DeviceId,
                encryptedCommand: randomUUID() as Encrypted<string>,
                encryptedSymmetricKey:
                  'encrypted-key-2' as EncryptedSymmetricKey,
              },
            ],
          },
        }),
      ).not.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 50))

      consoleSpy.mockRestore()
    })
  })
})
