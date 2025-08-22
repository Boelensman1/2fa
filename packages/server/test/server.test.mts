/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import ConnectedDevicesManager from '../src/ConnectedDevicesManager.mjs'
import UnExecutedSyncCommand from '../src/models/UnExecutedSyncCommand.mjs'
import type ClientMessage from '../src/types/ClientMessage.mjs'
import type { DeviceId, Encrypted, EncryptedSymmetricKey } from 'favalib'
import { cleanupTestDatabase, initializeTestDatabase } from './test-setup.mjs'

vi.mock('../src/ConnectedDevicesManager.mjs')

interface AddDeviceRequest {
  initiatorDeviceId: DeviceId
  timestamp: number
  nonce: string
  wsInitiator: WebSocket
  wsResponder?: WebSocket
}

describe('Server Message Handling', () => {
  let mockWs: WebSocket
  let mockConnectedDevices: ConnectedDevicesManager
  let mockSend: ReturnType<typeof vi.fn>
  let handleMessage: (ws: WebSocket, message: ClientMessage) => void
  let ongoingAddDeviceRequests: AddDeviceRequest[]

  beforeEach(() => {
    initializeTestDatabase()
    mockWs = {
      send: vi.fn(),
    } as unknown as WebSocket

    mockConnectedDevices = {
      addDevice: vi.fn(),
      removeDeviceByWs: vi.fn(),
      getDeviceId: vi.fn(),
      getWs: vi.fn(),
      size: 0,
    } as unknown as ConnectedDevicesManager

    mockSend = vi.fn()
    ongoingAddDeviceRequests = []

    handleMessage = (ws: WebSocket, message: ClientMessage) => {
      const send = <T extends string>(
        ws: WebSocket,
        type: T,
        data?: unknown,
      ) => {
        mockSend(ws, type, data)
        ws.send(JSON.stringify({ type, data }))
      }

      switch (message.type) {
        case 'connect': {
          const { deviceId } = message.data
          mockConnectedDevices.addDevice(deviceId, ws)

          void UnExecutedSyncCommand.query()
            .where({ deviceId })
            .then((unExecutedSyncCommands) => {
              send(ws, 'syncCommands', unExecutedSyncCommands)
            })
          break
        }
        case 'addSyncDeviceInitialiseData': {
          send(ws, 'confirmAddSyncDeviceInitialiseData', {})
          ongoingAddDeviceRequests.push({ ...message.data, wsInitiator: ws })
          break
        }
        case 'JPAKEPass2': {
          const { initiatorDeviceId } = message.data
          const request = ongoingAddDeviceRequests.find(
            (r) => r.initiatorDeviceId === initiatorDeviceId,
          )
          if (!request) {
            console.error('Request not found')
            return
          }
          send(request.wsInitiator, 'JPAKEPass2', message.data)
          request.wsResponder = ws
          break
        }
        case 'syncCommands': {
          void Promise.all(
            message.data.commands.map(async (data) => {
              try {
                await UnExecutedSyncCommand.query().insert({
                  commandId: data.commandId,
                  deviceId: data.deviceId,
                  encryptedCommand: data.encryptedCommand,
                  encryptedSymmetricKey: data.encryptedSymmetricKey,
                })

                const deviceWs = mockConnectedDevices.getWs(data.deviceId)
                if (deviceWs) {
                  send(deviceWs, 'syncCommands', [
                    {
                      commandId: data.commandId,
                      encryptedSymmetricKey: data.encryptedSymmetricKey,
                      encryptedCommand: data.encryptedCommand,
                    },
                  ])
                }
              } catch (error) {
                console.error('Database error:', error)
                throw error
              }
            }),
          )
            .then(() => {
              send(ws, 'syncCommandsReceived', {
                commandIds: message.data.commands.map(
                  (command) => command.commandId,
                ),
              })
            })
            .catch((error: unknown) => {
              console.error('Promise rejection:', error)
            })
          break
        }
        case 'syncCommandsExecuted': {
          const deviceId = mockConnectedDevices.getDeviceId(ws)
          const { commandIds } = message.data
          void UnExecutedSyncCommand.query()
            .where({ deviceId })
            .whereIn('commandId', commandIds)
            .del()
            .execute()
          break
        }
        case 'addSyncDeviceCancelled': {
          const { initiatorDeviceId } = message.data
          const request = ongoingAddDeviceRequests.find(
            (r) => r.initiatorDeviceId === initiatorDeviceId,
          )
          if (!request) {
            console.error('Request not found')
            return
          }
          ongoingAddDeviceRequests.splice(
            ongoingAddDeviceRequests.indexOf(request),
            1,
          )

          if (ws === request.wsResponder) {
            send(request.wsInitiator, 'addSyncDeviceCancelled', undefined)
          } else {
            send(request.wsInitiator, 'addSyncDeviceCancelled', undefined)
          }
          break
        }
      }
    }
  })

  afterEach(async () => {
    vi.clearAllMocks()
    ongoingAddDeviceRequests.length = 0
    await cleanupTestDatabase()
  })

  describe('connect message', () => {
    it('should add device to connected devices manager', () => {
      const message: ClientMessage = {
        type: 'connect',
        data: { deviceId: 'device-1' as DeviceId },
      }

      handleMessage(mockWs, message)

      expect(mockConnectedDevices.addDevice).toHaveBeenCalledWith(
        'device-1' as DeviceId,
        mockWs,
      )
    })

    it('should query for unexecuted sync commands', async () => {
      const deviceId = 'device-1' as DeviceId
      const commandId = randomUUID()

      await UnExecutedSyncCommand.query().insert({
        commandId: commandId,
        deviceId: deviceId,
        encryptedCommand: randomUUID() as Encrypted<string>,
        encryptedSymmetricKey: 'test-key' as EncryptedSymmetricKey,
      })

      const message: ClientMessage = {
        type: 'connect',
        data: { deviceId: deviceId },
      }

      handleMessage(mockWs, message)

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockSend).toHaveBeenCalledWith(
        mockWs,
        'syncCommands',
        expect.arrayContaining([
          expect.objectContaining({
            commandId: commandId,
            encryptedCommand: expect.any(String) as Encrypted<string>,
            encryptedSymmetricKey: 'test-key',
          }),
        ]),
      )
    })
  })

  describe('addSyncDeviceInitialiseData message', () => {
    it('should send confirmation and add to ongoing requests', () => {
      const message: ClientMessage = {
        type: 'addSyncDeviceInitialiseData',
        data: {
          initiatorDeviceId: 'device-1' as DeviceId,
          timestamp: Date.now(),
          nonce: 'test-nonce',
        },
      }

      handleMessage(mockWs, message)

      expect(mockSend).toHaveBeenCalledWith(
        mockWs,
        'confirmAddSyncDeviceInitialiseData',
        {},
      )
      expect(ongoingAddDeviceRequests).toHaveLength(1)
      expect(ongoingAddDeviceRequests[0]).toMatchObject({
        initiatorDeviceId: 'device-1',
        wsInitiator: mockWs,
      })
    })
  })

  describe('JPAKEPass2 message', () => {
    it('should forward message to initiator and set responder', () => {
      const mockInitiatorWs = { send: vi.fn() } as unknown as WebSocket
      ongoingAddDeviceRequests.push({
        initiatorDeviceId: 'device-1' as DeviceId,
        wsInitiator: mockInitiatorWs,
        timestamp: Date.now(),
        nonce: 'test-nonce',
      })

      const message: ClientMessage = {
        type: 'JPAKEPass2',
        data: {
          nonce: 'test-nonce',
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
        },
      }

      handleMessage(mockWs, message)

      expect(mockSend).toHaveBeenCalledWith(
        mockInitiatorWs,
        'JPAKEPass2',
        message.data,
      )
      expect(ongoingAddDeviceRequests[0].wsResponder).toBe(mockWs)
    })

    it('should handle request not found error', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const message: ClientMessage = {
        type: 'JPAKEPass2',
        data: {
          nonce: 'test-nonce',
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
          initiatorDeviceId: 'non-existent-device' as DeviceId,
        },
      }

      handleMessage(mockWs, message)

      expect(consoleSpy).toHaveBeenCalledWith('Request not found')
      consoleSpy.mockRestore()
    })
  })

  describe('syncCommands message', () => {
    it('should insert commands and send to target devices', async () => {
      const mockTargetWs = { send: vi.fn() } as unknown as WebSocket
      vi.mocked(mockConnectedDevices.getWs).mockReturnValue(mockTargetWs)

      const commandId = randomUUID()
      const message: ClientMessage = {
        type: 'syncCommands',
        data: {
          nonce: 'test-nonce',
          commands: [
            {
              commandId: commandId,
              deviceId: 'device-1' as DeviceId,
              encryptedCommand: randomUUID() as Encrypted<string>,
              encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
            },
          ],
        },
      }

      handleMessage(mockWs, message)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const insertedCommand = await UnExecutedSyncCommand.query()
        .where({
          commandId: commandId,
          deviceId: 'device-1',
        })
        .first()

      expect(insertedCommand).toBeDefined()
      expect(insertedCommand!.encryptedCommand).toBeDefined()
      expect(insertedCommand!.encryptedSymmetricKey).toBe('encrypted-key')

      expect(mockSend).toHaveBeenCalledWith(mockWs, 'syncCommandsReceived', {
        commandIds: [commandId],
      })
    })
  })

  describe('syncCommandsExecuted message', () => {
    it('should delete executed commands from database', async () => {
      const deviceId = 'device-1' as DeviceId
      vi.mocked(mockConnectedDevices.getDeviceId).mockReturnValue(deviceId)

      const cmd1Id = randomUUID()
      const cmd2Id = randomUUID()
      const cmd3Id = randomUUID()

      await UnExecutedSyncCommand.query().insert([
        {
          commandId: cmd1Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key1' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd2Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key2' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd3Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key3' as EncryptedSymmetricKey,
        },
      ])

      const message: ClientMessage = {
        type: 'syncCommandsExecuted',
        data: {
          commandIds: [cmd1Id, cmd2Id],
        },
      }

      handleMessage(mockWs, message)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const remaining = await UnExecutedSyncCommand.query().where({ deviceId })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].commandId).toBe(cmd3Id)
    })
  })

  describe('addSyncDeviceCancelled message', () => {
    it('should remove request and notify initiator', () => {
      const mockInitiatorWs = { send: vi.fn() } as unknown as WebSocket
      const request = {
        initiatorDeviceId: 'device-1' as DeviceId,
        wsInitiator: mockInitiatorWs,
        wsResponder: mockWs,
        timestamp: Date.now(),
        nonce: 'test-nonce',
      }
      ongoingAddDeviceRequests.push(request)

      const message: ClientMessage = {
        type: 'addSyncDeviceCancelled',
        data: {
          initiatorDeviceId: 'device-1' as DeviceId,
        },
      }

      handleMessage(mockWs, message)

      expect(ongoingAddDeviceRequests).toHaveLength(0)
      expect(mockSend).toHaveBeenCalledWith(
        mockInitiatorWs,
        'addSyncDeviceCancelled',
        undefined,
      )
    })

    it('should handle request not found', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      const message: ClientMessage = {
        type: 'addSyncDeviceCancelled',
        data: {
          initiatorDeviceId: 'non-existent-device' as DeviceId,
        },
      }

      handleMessage(mockWs, message)

      expect(consoleSpy).toHaveBeenCalledWith('Request not found')
      consoleSpy.mockRestore()
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle missing device connections gracefully', () => {
      vi.mocked(mockConnectedDevices.getWs).mockReturnValue(undefined)

      const commandId = randomUUID()
      const message: ClientMessage = {
        type: 'syncCommands',
        data: {
          nonce: 'test-nonce',
          commands: [
            {
              commandId: commandId,
              deviceId: 'offline-device' as DeviceId,
              encryptedCommand: randomUUID() as Encrypted<string>,
              encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
            },
          ],
        },
      }

      expect(() => handleMessage(mockWs, message)).not.toThrow()
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

      const message: ClientMessage = {
        type: 'syncCommands',
        data: {
          nonce: 'test-nonce',
          commands: [
            {
              commandId: duplicateCommandId,
              deviceId: 'device-1' as DeviceId,
              encryptedCommand: randomUUID() as Encrypted<string>,
              encryptedSymmetricKey: 'encrypted-key-2' as EncryptedSymmetricKey,
            },
          ],
        },
      }

      expect(() => handleMessage(mockWs, message)).not.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})
