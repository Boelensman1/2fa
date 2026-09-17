import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

import UnExecutedSyncCommand from '../src/models/UnExecutedSyncCommand.mjs'
import { cleanupTestDatabase, initializeTestDatabase } from './test-setup.mjs'

import { createConnectProof } from 'favalib/protocol/connectAuth'
import type { SyncCommandFromClient } from 'favalib/protocol/ClientMessage'
import type {
  DeviceId,
  Encrypted,
  EncryptedSymmetricKey,
  ServerSecret,
} from 'favalib/types'
import { config } from '../src/config.mjs'

/**
 * These tests drive the real `src/server.mts` in a child process, rather than a
 * copy of its message handling, because the failure they guard against is the
 * process dying: a rejected insert that nothing catches becomes an unhandled
 * rejection, which takes the whole sync server down for every connected device.
 */

// The same secret the spawned server reads from config/, because both this
// process and that one load the test config.
const SHARED_SECRET = config.sync.sharedSecret as ServerSecret

const TEST_PORT = 8282
const SERVER_URL = `ws://127.0.0.1:${TEST_PORT}`
const STARTUP_TIMEOUT = 30_000
const MESSAGE_TIMEOUT = 5000
const TEST_TIMEOUT = 60_000

interface ServerMessage {
  type: string
  data?: unknown
}

interface RunningServer {
  process: ChildProcess
  /** Everything the server wrote to stdout and stderr, for failure messages. */
  output: () => string
  isRunning: () => boolean
}

const startServer = async (): Promise<RunningServer> => {
  // detached, so that stopping the server can take down the whole process
  // group: `pnpm exec` is a wrapper around the node process that actually
  // holds the port, and killing the wrapper alone would leave it listening
  const child = spawn('pnpm', ['exec', 'tsx', './src/server.mts'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))

  const server: RunningServer = {
    process: child,
    output: () => output,
    isRunning: () => child.exitCode === null && child.signalCode === null,
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start within ${STARTUP_TIMEOUT}ms`))
    }, STARTUP_TIMEOUT)

    const poll = setInterval(() => {
      if (output.includes(`Server started on port ${TEST_PORT}`)) {
        clearInterval(poll)
        clearTimeout(timer)
        resolve()
      }
    }, 50)

    child.once('exit', (code) => {
      clearInterval(poll)
      clearTimeout(timer)
      reject(new Error(`Server exited with code ${code} while starting`))
    })
  })

  return server
}

const stopServer = async (server: RunningServer) => {
  const { pid } = server.process
  if (!server.isRunning() || pid === undefined) {
    return
  }
  const exited = new Promise<void>((resolve) => {
    server.process.once('exit', () => resolve())
  })
  process.kill(-pid, 'SIGKILL')
  await exited
}

interface TestClient {
  ws: WebSocket
  /** Messages received from the server that have not been taken yet. */
  inbox: ServerMessage[]
  take: (type: string, timeoutMs?: number) => Promise<ServerMessage>
  /** Resolves with the close code, once the server or the client closes. */
  closed: Promise<number>
}

const openClient = async (): Promise<TestClient> => {
  const ws = new WebSocket(SERVER_URL)
  const inbox: ServerMessage[] = []

  ws.on('message', (data) => {
    inbox.push(JSON.parse((data as Buffer).toString()) as ServerMessage)
  })

  const closed = new Promise<number>((resolve) => {
    ws.once('close', (code) => resolve(code))
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Connection timeout')),
      MESSAGE_TIMEOUT,
    )
    ws.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.once('error', reject)
  })

  const take = (type: string, timeoutMs = MESSAGE_TIMEOUT) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const attempt = () => {
        const index = inbox.findIndex((message) => message.type === type)
        if (index === -1) {
          return false
        }
        resolve(inbox.splice(index, 1)[0])
        return true
      }

      if (attempt()) {
        return
      }

      const poll = setInterval(() => {
        if (attempt()) {
          clearInterval(poll)
          clearTimeout(timer)
        }
      }, 10)
      const timer = setTimeout(() => {
        clearInterval(poll)
        reject(new Error(`Timed out waiting for a '${type}' message`))
      }, timeoutMs)
    })

  return { ws, inbox, take, closed }
}

/**
 * Opens a client, proves the shared secret, and announces a device.
 *
 * The proof is what the server asks for before it will act on anything: the
 * secret itself never crosses the wire, only an HMAC over the nonce the server
 * opens with. See key-hierarchy-review/16-server-authentication.md.
 * @param deviceId - The device to announce once the server lets us in.
 * @param secret - The secret to prove, so a test can get it wrong on purpose.
 * @returns The connected, authenticated client.
 */
const connectClient = async (
  deviceId: DeviceId,
  secret: ServerSecret = SHARED_SECRET,
): Promise<TestClient> => {
  const client = await openClient()

  const challenge = (await client.take('authChallenge')) as {
    type: string
    data: { nonce: string }
  }
  client.ws.send(
    JSON.stringify({
      type: 'authProof',
      data: { proof: createConnectProof(secret, challenge.data.nonce) },
    }),
  )
  await client.take('authAccepted')

  // every client announces itself first, and the server answers with the
  // commands it still has stored for that device
  client.ws.send(JSON.stringify({ type: 'connect', data: { deviceId } }))
  await client.take('syncCommands')

  return client
}

const makeCommand = (deviceId: DeviceId): SyncCommandFromClient => ({
  commandId: randomUUID(),
  deviceId,
  encryptedCommand: `encrypted-${randomUUID()}` as Encrypted<string>,
  encryptedSymmetricKey: `key-${randomUUID()}` as EncryptedSymmetricKey,
})

const sendCommands = (
  client: TestClient,
  commands: SyncCommandFromClient[],
) => {
  client.ws.send(
    JSON.stringify({
      type: 'syncCommands',
      data: { nonce: randomUUID(), commands },
    }),
  )
}

const commandIdsOf = (message: ServerMessage) =>
  (message.data as { commandIds: string[] }).commandIds

describe('re-sent sync commands', () => {
  let server: RunningServer
  let clients: TestClient[] = []

  beforeEach(async () => {
    initializeTestDatabase()
    await cleanupTestDatabase()
    server = await startServer()
  }, STARTUP_TIMEOUT)

  afterEach(async () => {
    clients.forEach((client) => client.ws.close())
    clients = []
    await stopServer(server)
    await cleanupTestDatabase()
  })

  it(
    'stays up and acknowledges a command that is sent twice',
    async () => {
      const senderDeviceId = 'sender-device' as DeviceId
      const targetDeviceId = 'target-device' as DeviceId

      const target = await connectClient(targetDeviceId)
      const sender = await connectClient(senderDeviceId)
      clients.push(target, sender)

      const command = makeCommand(targetDeviceId)

      sendCommands(sender, [command])
      expect(commandIdsOf(await sender.take('syncCommandsReceived'))).toEqual([
        command.commandId,
      ])
      await target.take('syncCommands')

      // The client re-sends whatever is still in its send queue every time it
      // connects, so a command whose acknowledgement was lost arrives a second
      // time and hits the (commandId, deviceId) unique constraint.
      sendCommands(sender, [command])

      const secondAck = await sender.take('syncCommandsReceived')
      expect(commandIdsOf(secondAck)).toEqual([command.commandId])

      expect(
        server.isRunning(),
        `server process died:\n${server.output()}`,
      ).toBe(true)

      const stored = await UnExecutedSyncCommand.query().where({
        commandId: command.commandId,
        deviceId: targetDeviceId,
      })
      expect(stored).toHaveLength(1)
    },
    TEST_TIMEOUT,
  )

  it(
    'stores and acknowledges the new commands in a batch that also holds a duplicate',
    async () => {
      const senderDeviceId = 'sender-device' as DeviceId
      const targetDeviceId = 'target-device' as DeviceId

      const target = await connectClient(targetDeviceId)
      const sender = await connectClient(senderDeviceId)
      clients.push(target, sender)

      const alreadySent = makeCommand(targetDeviceId)
      sendCommands(sender, [alreadySent])
      await sender.take('syncCommandsReceived')
      await target.take('syncCommands')

      const fresh = makeCommand(targetDeviceId)
      sendCommands(sender, [alreadySent, fresh])

      const ack = await sender.take('syncCommandsReceived')
      expect(commandIdsOf(ack)).toEqual(
        expect.arrayContaining([alreadySent.commandId, fresh.commandId]),
      )

      expect(
        server.isRunning(),
        `server process died:\n${server.output()}`,
      ).toBe(true)

      const stored = await UnExecutedSyncCommand.query().where({
        deviceId: targetDeviceId,
      })
      expect(stored.map((command) => command.commandId).sort()).toEqual(
        [alreadySent.commandId, fresh.commandId].sort(),
      )
    },
    TEST_TIMEOUT,
  )
})

describe('the connection gate', () => {
  let server: RunningServer
  let clients: TestClient[] = []

  beforeEach(async () => {
    initializeTestDatabase()
    await cleanupTestDatabase()
    server = await startServer()
  }, STARTUP_TIMEOUT)

  afterEach(async () => {
    clients.forEach((client) => client.ws.close())
    clients = []
    await stopServer(server)
    await cleanupTestDatabase()
  })

  it(
    'challenges a socket before it has said anything',
    async () => {
      const client = await openClient()
      clients.push(client)

      const challenge = (await client.take('authChallenge')) as {
        data: { nonce: string }
      }
      // 32 bytes of base64. The nonce is what keeps the secret off the wire and
      // a captured proof worthless on the next connection.
      expect(challenge.data.nonce).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    },
    TEST_TIMEOUT,
  )

  it(
    'issues a different nonce to each connection',
    async () => {
      const first = await openClient()
      const second = await openClient()
      clients.push(first, second)

      const nonceOf = async (client: TestClient) =>
        ((await client.take('authChallenge')) as { data: { nonce: string } })
          .data.nonce

      expect(await nonceOf(first)).not.toBe(await nonceOf(second))
    },
    TEST_TIMEOUT,
  )

  it(
    'closes a connection whose proof is made with the wrong secret',
    async () => {
      const client = await openClient()
      clients.push(client)

      const challenge = (await client.take('authChallenge')) as {
        data: { nonce: string }
      }
      client.ws.send(
        JSON.stringify({
          type: 'authProof',
          data: {
            proof: createConnectProof(
              'the-wrong-shared-secret-entirely!!!!' as ServerSecret,
              challenge.data.nonce,
            ),
          },
        }),
      )

      await expect(client.closed).resolves.toBe(4401)
      expect(
        server.isRunning(),
        `server process died:\n${server.output()}`,
      ).toBe(true)
    },
    TEST_TIMEOUT,
  )

  it(
    'refuses a connect that skips the handshake, and hands over nothing',
    async () => {
      // The hijack finding 16 is about: claiming a deviceId used to evict
      // whoever held it and ship them that device's queued commands.
      const deviceId = 'gated-device' as DeviceId
      await UnExecutedSyncCommand.query().insert({
        commandId: randomUUID(),
        deviceId,
        encryptedCommand: `encrypted-${randomUUID()}` as Encrypted<string>,
        encryptedSymmetricKey: `key-${randomUUID()}` as EncryptedSymmetricKey,
      })

      const client = await openClient()
      clients.push(client)
      await client.take('authChallenge')

      client.ws.send(JSON.stringify({ type: 'connect', data: { deviceId } }))

      await expect(client.closed).resolves.toBe(4401)
      expect(
        client.inbox.some((message) => message.type === 'syncCommands'),
      ).toBe(false)

      // And the queue is untouched, so the real device still gets it.
      const stored = await UnExecutedSyncCommand.query().where({ deviceId })
      expect(stored).toHaveLength(1)
    },
    TEST_TIMEOUT,
  )

  it(
    'survives a frame that is not JSON at all',
    async () => {
      const client = await openClient()
      clients.push(client)
      await client.take('authChallenge')

      client.ws.send('{not json')

      // The parse used to throw inside the message listener. Nothing about one
      // client's malformed frame should reach anybody else's connection.
      const other = await connectClient('still-working' as DeviceId)
      clients.push(other)
      expect(
        server.isRunning(),
        `server process died:\n${server.output()}`,
      ).toBe(true)
    },
    TEST_TIMEOUT,
  )
})
