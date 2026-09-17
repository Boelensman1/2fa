import { WebSocketServer, WebSocket } from 'ws'
import { UniqueViolationError } from 'objection'

import UnExecutedSyncCommand from './models/UnExecutedSyncCommand.mjs'
import ConnectedDevicesManager from './ConnectedDevicesManager.mjs'
import ConnectionAuthManager, {
  UNAUTHORIZED_CLOSE_CODE,
  UNAUTHORIZED_CLOSE_REASON,
} from './ConnectionAuthManager.mjs'

import type ClientMessage from 'favalib/protocol/ClientMessage'
import type {
  AddSyncDeviceInitialiseDataClientMessage,
  SyncCommandFromClient,
} from 'favalib/protocol/ClientMessage'
import type OutgoingMessage from 'favalib/protocol/ServerMessage'
import type { ServerSecret } from 'favalib/types'

/**
 * The sync server, as a thing that can be constructed rather than a script that
 * runs on import.
 *
 * It used to be the latter: `server.mts` opened a listener at module scope, so
 * nothing could import it, and `test/server.test.mts` kept a hand-written copy
 * of `handleMessage` to test against instead. A copy of the code under test
 * passes whatever the copy does, which was tolerable while the handler only
 * relayed messages and became untenable the moment it started refusing them.
 * The handler and its state live here now, and `server.mts` is the script that
 * starts one.
 */

/** An add-device request in flight, with the sockets on either side of it. */
type OngoingAddDeviceRequest =
  AddSyncDeviceInitialiseDataClientMessage['data'] & {
    wsInitiator: WebSocket
    wsResponder?: WebSocket
  }

/**
 * Stores a sync command, tolerating one the server already has.
 *
 * A client re-sends everything still in its send queue every time it connects,
 * so a command whose acknowledgement never made it back arrives a second time
 * and collides with the row that is already waiting for the device. That is a
 * repeat of a command the server accepted, not a failure, so it counts as
 * stored: the client may drop it from its queue.
 *
 * Nothing here is allowed to reject. The caller runs these unawaited, and an
 * unhandled rejection takes the whole server down - and with it every other
 * device's connection - over one client's duplicate.
 * @param command - The command as the client sent it.
 * @returns True when the command is stored, by this call or an earlier one.
 */
const storeSyncCommand = async (command: SyncCommandFromClient) => {
  const { commandId, deviceId, encryptedCommand, encryptedSymmetricKey } =
    command

  try {
    await UnExecutedSyncCommand.query().insert({
      commandId,
      deviceId,
      encryptedCommand,
      encryptedSymmetricKey,
    })
    return true
  } catch (error) {
    if (!(error instanceof UniqueViolationError)) {
      console.error('Could not store sync command', error)
      return false
    }

    // Make sure the collision really is this command, and not some other row
    // that happens to occupy one of the unique columns.
    try {
      const existing = await UnExecutedSyncCommand.query().findOne({
        commandId,
        deviceId,
      })
      if (!existing) {
        console.error('Could not store sync command', error)
        return false
      }
    } catch (lookupError) {
      console.error('Could not look up existing sync command', lookupError)
      return false
    }

    return true
  }
}

/**
 * Everything one running sync server owns.
 *
 * Exposed so a test can drive the real handler over fake sockets, and so
 * `server.mts` can start one without knowing what is inside it.
 */
export interface SyncServer {
  wss: WebSocketServer
  connectedDevices: ConnectedDevicesManager
  connectionAuth: ConnectionAuthManager
  handleMessage: (ws: WebSocket, message: ClientMessage) => void
  handleConnection: (ws: WebSocket) => void
  close: () => Promise<void>
}

/**
 * Builds a sync server's state and message handling, without listening.
 *
 * Split from `createSyncServer` only so tests can have the handler without a
 * socket bound to a port.
 * @param sharedSecret - The static secret clients must prove to connect.
 * @returns The handler, the connection wiring, and the state both use.
 */
export const createSyncServerCore = (sharedSecret: ServerSecret) => {
  const ongoingAddDeviceRequests: OngoingAddDeviceRequest[] = []
  const connectedDevices = new ConnectedDevicesManager()

  const send = <T extends OutgoingMessage['type']>(
    ws: WebSocket,
    type: T,
    data?: Extract<OutgoingMessage, { type: T }>['data'],
  ) => {
    ws.send(JSON.stringify({ type, data }))
  }

  // The timeout path has already dropped its own state before calling this,
  // which is why it does not go through `refuse` below.
  const connectionAuth = new ConnectionAuthManager(sharedSecret, (ws) => {
    ws.close(UNAUTHORIZED_CLOSE_CODE, UNAUTHORIZED_CLOSE_REASON)
  })

  /**
   * Refuses a socket, for any of the three reasons there are.
   *
   * Always the same code and the same reason: see UNAUTHORIZED_CLOSE_CODE.
   * @param ws - The socket to refuse.
   */
  const refuse = (ws: WebSocket) => {
    connectionAuth.remove(ws)
    ws.close(UNAUTHORIZED_CLOSE_CODE, UNAUTHORIZED_CLOSE_REASON)
  }

  /**
   * Handles one decoded message from a client.
   * @param ws - The socket it arrived on.
   * @param message - The decoded message, which is NOT known to have this shape.
   */
  const handleMessage = (ws: WebSocket, message: ClientMessage) => {
    // The connection gate, ahead of the switch rather than inside it. A socket
    // gets to say exactly one thing before it has proved the shared secret, and
    // anything else -- including a `connect` that would otherwise displace a
    // real device and drain its queue -- closes it.
    if (message.type === 'authProof') {
      if (!connectionAuth.submitProof(ws, message.data?.proof)) {
        refuse(ws)
        return
      }
      send(ws, 'authAccepted', {})
      return
    }
    if (!connectionAuth.isAuthenticated(ws)) {
      refuse(ws)
      return
    }

    switch (message.type) {
      case 'connect': {
        const { deviceId } = message.data
        connectedDevices.addDevice(deviceId, ws)
        console.log('Connected devices', connectedDevices.size)

        // check if there are still unExecutedSyncCommands
        void UnExecutedSyncCommand.query()
          .where({
            deviceId,
          })
          .then((unExecutedSyncCommands) => {
            send(ws, 'syncCommands', unExecutedSyncCommands)
          })
          .catch((error: unknown) => {
            console.error('Could not load unexecuted sync commands', error)
          })
        break
      }
      case 'addSyncDeviceInitialiseData': {
        send(ws, 'confirmAddSyncDeviceInitialiseData', {})
        ongoingAddDeviceRequests.push({ ...message.data, wsInitiator: ws })
        return
      }
      case 'JPAKEPass2': {
        const { initiatorDeviceId } = message.data
        // find matching request
        const request = ongoingAddDeviceRequests.find(
          (r) => r.initiatorDeviceId === initiatorDeviceId,
        )
        if (!request) {
          console.error('Request not found')
          return
        }
        send(request.wsInitiator, 'JPAKEPass2', message.data)
        request.wsResponder = ws
        return
      }
      case 'JPAKEPass3': {
        const { initiatorDeviceId } = message.data
        // find matching request
        const request = ongoingAddDeviceRequests.find(
          (r) => r.initiatorDeviceId === initiatorDeviceId,
        )
        if (!request) {
          console.error('Request not found')
          return
        }
        if (!request.wsResponder) {
          console.error('Request not in correct state')
          return
        }
        send(request.wsResponder, 'JPAKEPass3', message.data)
        return
      }
      case 'publicKeyAndDeviceInfo': {
        const { initiatorDeviceId } = message.data
        const request = ongoingAddDeviceRequests.find(
          (r) => r.initiatorDeviceId === initiatorDeviceId,
        )
        if (!request) {
          console.error('Request not found')
          return
        }

        send(request.wsInitiator, 'publicKeyAndDeviceInfo', message.data)
        return
      }
      case 'initialVault': {
        const { initiatorDeviceId } = message.data
        const request = ongoingAddDeviceRequests.find(
          (r) => r.initiatorDeviceId === initiatorDeviceId,
        )
        if (!request) {
          console.error('Request not found')
          return
        }
        if (!request.wsResponder) {
          console.error('Request not in correct state')
          return
        }

        send(request.wsResponder, 'initialVault', message.data)
        return
      }
      case 'vault': {
        const { forDeviceId } = message.data
        const fromDeviceId = connectedDevices.getDeviceId(ws)
        if (!fromDeviceId) {
          console.error('fromDeviceId not found when resilvering')
          return
        }

        // find matching device
        const forDeviceWs = connectedDevices.getWs(forDeviceId)
        if (!forDeviceWs) {
          // device is offline, cannot resilver
          return
        }

        send(forDeviceWs, 'vault', {
          ...message.data,
          fromDeviceId,
        })
        return
      }
      case 'addSyncDeviceCancelled': {
        const { initiatorDeviceId } = message.data
        // find matching request
        const request = ongoingAddDeviceRequests.find(
          (r) => r.initiatorDeviceId === initiatorDeviceId,
        )
        if (!request) {
          console.error('Request not found')
          return
        }
        // remove from ongoing add device requests
        ongoingAddDeviceRequests.splice(
          ongoingAddDeviceRequests.indexOf(request),
          1,
        )

        // notify other device that the request has been cancelled
        send(request.wsInitiator, 'addSyncDeviceCancelled')

        return
      }
      case 'syncCommands': {
        void Promise.all(
          message.data.commands.map(async (command) => {
            const {
              commandId,
              deviceId,
              encryptedCommand,
              encryptedSymmetricKey,
            } = command

            const stored = await storeSyncCommand(command)
            if (!stored) {
              // leave it out of the acknowledgement, so the client keeps it in
              // its send queue and tries again later
              return undefined
            }

            // find matching connection
            const deviceWs = connectedDevices.getWs(deviceId)
            if (!deviceWs) {
              // device is offline, it picks the command up when it connects
              console.error('Connection not found')
              return commandId
            }
            send(deviceWs, 'syncCommands', [
              {
                commandId,
                encryptedSymmetricKey,
                encryptedCommand,
              },
            ])
            return commandId
          }),
        ).then((commandIds) => {
          send(ws, 'syncCommandsReceived', {
            commandIds: commandIds.filter(
              (commandId) => commandId !== undefined,
            ),
          })
        })
        return
      }
      case 'syncCommandsExecuted': {
        // sync commands executed, can be removed (for this device)
        const deviceId = connectedDevices.getDeviceId(ws)
        const { commandIds } = message.data
        void UnExecutedSyncCommand.query()
          .where({ deviceId })
          .whereIn('commandId', commandIds)
          .del()
          .execute()
          .catch((error: unknown) => {
            console.error('Could not remove executed sync commands', error)
          })
        return
      }
      case 'startResilver': {
        const { deviceIds } = message.data
        for (const deviceId of deviceIds) {
          // find matching device
          const deviceWs = connectedDevices.getWs(deviceId)
          if (!deviceWs) {
            // device is offline, cannot start resilver
            continue
          }

          send(deviceWs, 'startResilver', message.data)
        }
        return
      }
    }
  }

  /**
   * Wires up one newly accepted socket.
   *
   * The server speaks first now: a challenge goes out before the client has
   * said anything, and nothing it sends is acted on until it answers.
   * @param ws - The accepted socket.
   */
  const handleConnection = (ws: WebSocket) => {
    console.log('Connection!')
    ws.on('error', console.error)

    send(ws, 'authChallenge', { nonce: connectionAuth.issueChallenge(ws) })

    ws.on('message', (data) => {
      let decoded: unknown
      try {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        decoded = JSON.parse(data.toString())
      } catch {
        // A frame that is not JSON used to throw out of this listener. Drop it:
        // it tells us nothing, and the socket may yet behave.
        console.error('Could not parse message')
        return
      }
      if (typeof decoded !== 'object' || decoded === null) {
        console.error('Could not parse message')
        return
      }
      handleMessage(ws, decoded as ClientMessage)
    })

    ws.on('close', () => {
      console.log('Connection closed!')
      connectionAuth.remove(ws)

      // find matching connected device
      connectedDevices.removeDeviceByWs(ws)

      // find matching ongoing add device request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.wsInitiator === ws || r.wsResponder === ws,
      )
      if (request) {
        // remove from ongoing add device requests
        ongoingAddDeviceRequests.splice(
          ongoingAddDeviceRequests.indexOf(request),
          1,
        )
      }
    })
  }

  return {
    connectedDevices,
    connectionAuth,
    handleMessage,
    handleConnection,
    ongoingAddDeviceRequests,
    send,
  }
}

/**
 * Starts a sync server listening on a port.
 * @param options - How to start.
 * @param options.port - The port to listen on.
 * @param options.sharedSecret - The static secret clients must prove to connect.
 * @returns The running server.
 */
export const createSyncServer = ({
  port,
  sharedSecret,
}: {
  port: number
  sharedSecret: ServerSecret
}): SyncServer => {
  const core = createSyncServerCore(sharedSecret)
  const wss = new WebSocketServer({ port })

  wss.on('connection', core.handleConnection)

  return {
    wss,
    connectedDevices: core.connectedDevices,
    connectionAuth: core.connectionAuth,
    handleMessage: core.handleMessage,
    handleConnection: core.handleConnection,
    close: () =>
      new Promise<void>((resolve, reject) => {
        core.connectionAuth.clear()
        wss.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
