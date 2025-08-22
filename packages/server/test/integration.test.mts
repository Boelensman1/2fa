import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest'
import { randomUUID } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { cleanupTestDatabase, initializeTestDatabase } from './test-setup.mjs'

interface WebSocketMessage {
  type: string
  data?: {
    commandIds?: string[]
    commands?: { commandId: string }[]
    [key: string]: unknown
  }
}

const TEST_PORT = 8181

describe('WebSocket Server Integration Tests', () => {
  let wss: WebSocketServer
  let clients: WebSocket[] = []
  let wsErrors: Error[] = []

  beforeAll(() => {
    process.env.PORT = TEST_PORT.toString()
  })

  afterAll(() => {
    delete process.env.PORT
  })

  beforeEach(async () => {
    initializeTestDatabase()
    wsErrors = []
    wss = new WebSocketServer({ port: TEST_PORT })

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(
            data as unknown as string,
          ) as WebSocketMessage

          switch (message.type) {
            case 'connect':
              ws.send(
                JSON.stringify({
                  type: 'syncCommands',
                  data: [],
                }),
              )
              break

            case 'addSyncDeviceInitialiseData':
              ws.send(
                JSON.stringify({
                  type: 'confirmAddSyncDeviceInitialiseData',
                  data: {},
                }),
              )
              break

            case 'syncCommands':
              ws.send(
                JSON.stringify({
                  type: 'syncCommandsReceived',
                  data: {
                    commandIds:
                      message.data?.commands?.map(
                        (cmd: { commandId: string }) => cmd.commandId,
                      ) ?? [],
                  },
                }),
              )
              break
          }
        } catch (error) {
          wsErrors.push(
            error instanceof Error ? error : new Error(String(error)),
          )
        }
      })
    })

    await new Promise<void>((resolve) => {
      wss.on('listening', () => resolve())
    })
  })

  afterEach(async () => {
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close()
      }
    })
    clients = []

    if (wss) {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
      })
    }

    await cleanupTestDatabase()
  })

  const createClient = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`)

      ws.on('open', () => {
        clients.push(ws)
        resolve(ws)
      })

      ws.on('error', reject)

      setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)
    })
  }

  const waitForMessage = (
    ws: WebSocket,
    timeout = 1000,
  ): Promise<WebSocketMessage> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Message timeout'))
      }, timeout)

      ws.once('message', (data) => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(data as unknown as string) as WebSocketMessage)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  }

  describe('WebSocket Connection Lifecycle', () => {
    it('should accept WebSocket connections', async () => {
      const ws = await createClient()
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(wsErrors).toHaveLength(0)
    })

    it('should handle multiple concurrent connections', async () => {
      const connections = await Promise.all([
        createClient(),
        createClient(),
        createClient(),
      ])

      connections.forEach((ws) => {
        expect(ws.readyState).toBe(WebSocket.OPEN)
      })
      expect(wsErrors).toHaveLength(0)
    })

    it('should handle connection close gracefully', async () => {
      const ws = await createClient()

      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', () => resolve())
      })

      ws.close()
      await closePromise

      expect(ws.readyState).toBe(WebSocket.CLOSED)
      expect(wsErrors).toHaveLength(0)
    })
  })

  describe('Message Protocol', () => {
    it('should handle connect message and respond with sync commands', async () => {
      const ws = await createClient()

      ws.send(
        JSON.stringify({
          type: 'connect',
          data: { deviceId: 'test-device-1' },
        }),
      )

      const response = await waitForMessage(ws)
      expect(response.type).toBe('syncCommands')
      expect(Array.isArray(response.data)).toBe(true)
      expect(wsErrors).toHaveLength(0)
    })

    it('should handle addSyncDeviceInitialiseData message', async () => {
      const ws = await createClient()

      ws.send(
        JSON.stringify({
          type: 'addSyncDeviceInitialiseData',
          data: {
            initiatorDeviceId: 'device-1',
            timestamp: Date.now(),
            nonce: 'test-nonce',
          },
        }),
      )

      const response = await waitForMessage(ws)
      expect(response.type).toBe('confirmAddSyncDeviceInitialiseData')
      expect(response.data).toEqual({})
      expect(wsErrors).toHaveLength(0)
    })

    it('should handle syncCommands message and respond with confirmation', async () => {
      const ws = await createClient()
      const commandId = randomUUID()

      ws.send(
        JSON.stringify({
          type: 'syncCommands',
          data: {
            nonce: 'test-nonce',
            commands: [
              {
                commandId: commandId,
                deviceId: 'device-1',
                encryptedCommand: randomUUID(),
                encryptedSymmetricKey: 'encrypted-key',
              },
            ],
          },
        }),
      )

      const response = await waitForMessage(ws)
      expect(response.type).toBe('syncCommandsReceived')
      expect(response.data?.commandIds).toEqual([commandId])
      expect(wsErrors).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      const ws = await createClient()

      ws.send('invalid json')

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(wsErrors).toHaveLength(1)
      expect(wsErrors[0]).toBeInstanceOf(SyntaxError)
      expect(wsErrors[0].message).toContain('not valid JSON')
    })

    it('should handle unknown message types', async () => {
      const ws = await createClient()

      ws.send(
        JSON.stringify({
          type: 'unknownMessageType',
          data: {},
        }),
      )

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(wsErrors).toHaveLength(0)
    })

    it('should handle messages with missing data', async () => {
      const ws = await createClient()

      ws.send(
        JSON.stringify({
          type: 'connect',
        }),
      )

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(wsErrors).toHaveLength(0)
    })
  })

  describe('Multi-Client Scenarios', () => {
    it('should handle device pairing flow between two clients', async () => {
      const initiator = await createClient()
      await createClient()

      initiator.send(
        JSON.stringify({
          type: 'addSyncDeviceInitialiseData',
          data: {
            initiatorDeviceId: 'device-1',
            timestamp: Date.now(),
            nonce: 'test-nonce',
          },
        }),
      )

      const initiatorResponse = await waitForMessage(initiator)
      expect(initiatorResponse.type).toBe('confirmAddSyncDeviceInitialiseData')
      expect(wsErrors).toHaveLength(0)
    })

    it('should handle concurrent sync command submissions', async () => {
      const clients = await Promise.all([createClient(), createClient()])
      const commandIds = [randomUUID(), randomUUID()]

      const responses = await Promise.all(
        clients.map(async (ws, index) => {
          ws.send(
            JSON.stringify({
              type: 'syncCommands',
              data: {
                nonce: `nonce-${index}`,
                commands: [
                  {
                    commandId: commandIds[index],
                    deviceId: `device-${index}`,
                    encryptedCommand: randomUUID(),
                    encryptedSymmetricKey: 'encrypted-key',
                  },
                ],
              },
            }),
          )

          return waitForMessage(ws)
        }),
      )

      responses.forEach((response, index) => {
        expect(response.type).toBe('syncCommandsReceived')
        expect(response.data?.commandIds).toEqual([commandIds[index]])
      })
      expect(wsErrors).toHaveLength(0)
    })
  })

  describe('Performance and Stress Testing', () => {
    it('should handle rapid message sending', async () => {
      const ws = await createClient()
      const messageCount = 50
      const responses: WebSocketMessage[] = []

      const responsePromise = new Promise<void>((resolve) => {
        let receivedCount = 0
        ws.on('message', (data) => {
          responses.push(
            JSON.parse(data as unknown as string) as WebSocketMessage,
          )
          receivedCount++
          if (receivedCount === messageCount) {
            resolve()
          }
        })
      })

      for (let i = 0; i < messageCount; i++) {
        ws.send(
          JSON.stringify({
            type: 'connect',
            data: { deviceId: `device-${i}` },
          }),
        )
      }

      await responsePromise
      expect(responses).toHaveLength(messageCount)
      responses.forEach((response) => {
        expect(response.type).toBe('syncCommands')
      })
      expect(wsErrors).toHaveLength(0)
    })

    it('should maintain connection stability under load', async () => {
      const clientCount = 10
      const clients = await Promise.all(
        Array(clientCount)
          .fill(0)
          .map(() => createClient()),
      )

      const allResponses = await Promise.all(
        clients.map(async (ws, index) => {
          ws.send(
            JSON.stringify({
              type: 'connect',
              data: { deviceId: `load-device-${index}` },
            }),
          )
          return waitForMessage(ws)
        }),
      )

      expect(allResponses).toHaveLength(clientCount)
      clients.forEach((ws) => {
        expect(ws.readyState).toBe(WebSocket.OPEN)
      })
      expect(wsErrors).toHaveLength(0)
    })
  })
})
