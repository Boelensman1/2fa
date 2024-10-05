import { WebSocketServer, WebSocket } from 'ws'
import type ClientMessage from './types/ClientMessage.mjs'
import type { AddSyncDeviceInitialiseDataMessage } from './types/ClientMessage.mjs'
import ServerMessage from './types/ServerMessage.mjs'

const port = 8080
const wss = new WebSocketServer({ port })
console.log(`Server started on port ${port}`)

const ongoingAddDeviceRequests: (AddSyncDeviceInitialiseDataMessage['data'] & {
  wsInitiator: WebSocket
  wsResponder?: WebSocket
})[] = []
const connectedDevices: { userId: string; ws: WebSocket }[] = []

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
      const { userId } = message.data
      connectedDevices.push({ userId, ws })
      console.log(
        'Connected devices',
        connectedDevices.map((c) => c.userId),
      )
      break
    }
    case 'addSyncDeviceInitialiseData': {
      send(ws, 'confirmAddSyncDeviceInitialiseData', {})
      ongoingAddDeviceRequests.push({ ...message.data, wsInitiator: ws })
      return
    }
    case 'JPAKEPass2': {
      const { initiatorUserIdString } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorUserIdString === initiatorUserIdString,
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
      const { initiatorUserIdString } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorUserIdString === initiatorUserIdString,
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
      const { initiatorUserIdString } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorUserIdString === initiatorUserIdString,
      )
      if (!request) {
        console.error('Request not found')
        return
      }

      send(request.wsInitiator, 'publicKey', message.data)
      return
    }
    case 'vault': {
      const { initiatorUserIdString } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorUserIdString === initiatorUserIdString,
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
    case 'syncCommand': {
      message.data.forEach((data) => {
        const { userId, encryptedCommands, encryptedSymmetricKey } = data

        // find matching connection
        const device = connectedDevices.find((r) => r.userId === userId)
        if (!device) {
          console.error('Request not found')
          return
        }
        send(device.ws, 'syncCommand', {
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

  // ws.send('something')
})
