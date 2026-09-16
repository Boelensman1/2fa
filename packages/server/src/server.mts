import { WebSocketServer, WebSocket } from 'ws'
import { Model, UniqueViolationError } from 'objection'
import createKnex from 'knex'

import UnExecutedSyncCommand from './models/UnExecutedSyncCommand.mjs'

import knexConfig from '../knexfile.js'
import ConnectedDevicesManager from './ConnectedDevicesManager.mjs'

import type ClientMessage from 'favalib/protocol/ClientMessage'
import type {
  AddSyncDeviceInitialiseDataClientMessage,
  SyncCommandFromClient,
} from 'favalib/protocol/ClientMessage'
import type OutgoingMessage from 'favalib/protocol/ServerMessage'

const knex = createKnex(knexConfig)
Model.knex(knex)

const port = Number(process.env.PORT ?? 8080)
const wss = new WebSocketServer({ port })
console.log(`Server started on port ${port}`)

const ongoingAddDeviceRequests: (AddSyncDeviceInitialiseDataClientMessage['data'] & {
  wsInitiator: WebSocket
  wsResponder?: WebSocket
})[] = []
const connectedDevices = new ConnectedDevicesManager()

const send = <T extends OutgoingMessage['type']>(
  ws: WebSocket,
  type: T,
  data?: Extract<OutgoingMessage, { type: T }>['data'],
) => {
  ws.send(JSON.stringify({ type, data }))
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

const handleMessage = (ws: WebSocket, message: ClientMessage) => {
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
      if (ws === request.wsResponder) {
        send(request.wsInitiator, 'addSyncDeviceCancelled')
      } else {
        send(request.wsInitiator, 'addSyncDeviceCancelled')
      }

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
          commandIds: commandIds.filter((commandId) => commandId !== undefined),
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

wss.on('connection', function connection(ws) {
  console.log('Connection!')
  ws.on('error', console.error)

  ws.on('message', function message(data) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const messageDecoded = JSON.parse(data.toString()) as unknown
    handleMessage(ws, messageDecoded as ClientMessage)
  })

  ws.on('close', function close() {
    console.log('Connection closed!')
    // find matching connected device
    connectedDevices.removeDeviceByWs(this)

    // find matching ongoing add device request
    const request = ongoingAddDeviceRequests.find(
      (r) => r.wsInitiator === this || r.wsResponder === this,
    )
    if (request) {
      // remove from ongoing add device requests
      ongoingAddDeviceRequests.splice(
        ongoingAddDeviceRequests.indexOf(request),
        1,
      )
    }
  })
})
