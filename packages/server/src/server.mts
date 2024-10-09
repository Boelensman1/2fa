import { WebSocketServer, WebSocket } from 'ws'

import ConnectedDevicesManager from './ConnectedDevicesManager.mjs'

import type ClientMessage from './types/ClientMessage.mjs'
import type { AddSyncDeviceInitialiseDataMessage } from './types/ClientMessage.mjs'
import type ServerMessage from './types/ServerMessage.mjs'

const port = 8080
const wss = new WebSocketServer({ port })
console.log(`Server started on port ${port}`)

const ongoingAddDeviceRequests: (AddSyncDeviceInitialiseDataMessage['data'] & {
  wsInitiator: WebSocket
  wsResponder?: WebSocket
})[] = []
const connectedDevices = new ConnectedDevicesManager()

const send = <T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T,
  data?: Extract<ServerMessage, { type: T }>['data'],
) => {
  ws.send(JSON.stringify({ type, data }))
}

const handleMessage = (ws: WebSocket, message: ClientMessage) => {
  console.log('message', message.type)
  switch (message.type) {
    case 'connect': {
      const { deviceId } = message.data
      connectedDevices.addDevice(deviceId, ws)
      console.log('Connected devices', connectedDevices.size)
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
    case 'vault': {
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

      send(request.wsResponder, 'vault', message.data)
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
    case 'syncCommand': {
      message.data.forEach((data) => {
        const { deviceId, encryptedCommands, encryptedSymmetricKey } = data

        // find matching connection
        const deviceWs = connectedDevices.getWs(deviceId)
        if (!deviceWs) {
          console.error('Request not found')
          return
        }
        send(deviceWs, 'syncCommand', {
          encryptedSymmetricKey,
          encryptedCommands,
        })
      })
      return
    }
  }
}

wss.on('connection', function connection(ws) {
  console.log('Connection!')
  ws.on('error', console.error)

  ws.on('message', function message(data) {
    const messageDecoded = JSON.parse(String(data)) as unknown
    // console.log(JSON.stringify(messageDecoded))
    handleMessage(ws, messageDecoded as ClientMessage)
  })

  ws.on('close', function close() {
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
