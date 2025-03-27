import fs from 'node:fs'
import { WebSocketServer, WebSocket } from 'ws'
import { Model } from 'objection'
import type { Knex } from 'knex'
import createKnex from 'knex'

import ConnectedDevicesManager from './ConnectedDevicesManager.mjs'
import UnExecutedSyncCommand from './models/UnExecutedSyncCommand.mjs'

import type ClientMessage from './types/ClientMessage.mjs'
import type { AddSyncDeviceInitialiseDataClientMessage } from './types/ClientMessage.mjs'
import type OutgoingMessage from './types/ServerMessage.mjs'

const config = JSON.parse(
  fs.readFileSync('./knexfile.json').toString(),
) as Knex.Config
const knex = createKnex(config)
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
    case 'publicKey': {
      const { initiatorDeviceId } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorDeviceId === initiatorDeviceId,
      )
      if (!request) {
        console.error('Request not found')
        return
      }

      send(request.wsInitiator, 'publicKey', message.data)
      return
    }
    case 'initialVault': {
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
        message.data.commands.map(async (data) => {
          const {
            commandId,
            deviceId,
            encryptedCommand,
            encryptedSymmetricKey,
          } = data

          const unExecutedSyncCommand =
            await UnExecutedSyncCommand.query().insert({
              commandId,
              deviceId,
              encryptedCommand,
              encryptedSymmetricKey,
            })

          // find matching connection
          const deviceWs = connectedDevices.getWs(deviceId)
          if (!deviceWs) {
            console.error('Connection not found')
            return
          }
          send(deviceWs, 'syncCommands', [
            {
              commandId: unExecutedSyncCommand.commandId,
              encryptedSymmetricKey,
              encryptedCommand,
            },
          ])
        }),
      ).then(() => {
        send(ws, 'syncCommandsReceived', {
          commandIds: message.data.commands.map((command) => command.commandId),
        })
      })
      return
    }
    case 'syncCommandsExecuted': {
      // sync commands executed, can be removed
      const { commandIds } = message.data
      void UnExecutedSyncCommand.query()
        .whereIn('commandId', commandIds)
        .del()
        .execute()
      return
    }
    case 'startResilver': {
      const { deviceIds } = message.data
      for (const deviceId of deviceIds) {
        // find matching device
        const deviceWs = connectedDevices.getWs(deviceId)
        if (!deviceWs) {
          // device is offline, cannot start resilver
          return
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
    const messageDecoded = JSON.parse(String(data)) as unknown
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
