import { WebSocketServer, WebSocket } from 'ws'

const port = 8080
const wss = new WebSocketServer({ port })
console.log(`Server started on port ${port}`)

interface RegisterAddDeviceFlowRequestMessage {
  type: 'registerAddDeviceFlowRequest'
  data: {
    initiatorDeviceIdentifier: string
    initiatorUserIdString: string
    timestamp: number
    nonce: string
  }
}

interface AddDevicePassPass2ResultMessage {
  type: 'addDevicePassPass2Result'
  data: {
    nonce: string
    pass2Result: {
      round1Result: {
        G1: Record<number, string>
        G2: Record<number, string>
        ZKPx1: Record<number, string>
        ZKPx2: Record<number, string>
      }
      round2Result: {
        A: Record<number, string>
        ZKPx2s: Record<number, string>
      }
    }
    responderUserIdString: string
    responderDeviceIdentifier: string
    initiatorUserIdString: string
  }
}

interface AddDevicePassPass3ResultMessage {
  type: 'addDevicePassPass3Result'
  data: {
    nonce: string
    initiatorUserIdString: string
    pass3Result: Record<number, string>
  }
}

interface AddDeviceSendPublicKey {
  type: 'addDeviceFlowSendPublicKey'
  data: {
    initiatorUserIdString: string
    nonce: string
    encryptedPublicKey: string
  }
}

interface SendInitialVaultData {
  type: 'sendInitialVaultData'
  data: {
    nonce: string
    initiatorUserIdString: string
    encryptedVaultData: string
  }
}

type Message =
  | RegisterAddDeviceFlowRequestMessage
  | AddDevicePassPass2ResultMessage
  | AddDevicePassPass3ResultMessage
  | AddDeviceSendPublicKey
  | SendInitialVaultData

const ongoingAddDeviceRequests: (RegisterAddDeviceFlowRequestMessage['data'] & {
  wsInitiator: WebSocket
  wsResponder?: WebSocket
})[] = []

const handleMessage = (ws: WebSocket, message: Message) => {
  switch (message.type) {
    case 'registerAddDeviceFlowRequest': {
      const result = { type: 'addDeviceFlowRequestRegistered' }
      ws.send(JSON.stringify(result))
      ongoingAddDeviceRequests.push({ ...message.data, wsInitiator: ws })
      return
    }
    case 'addDevicePassPass2Result': {
      const { initiatorUserIdString } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorUserIdString === initiatorUserIdString,
      )
      if (!request) {
        console.error('Request not found')
        return
      }
      request.wsInitiator.send(
        JSON.stringify({
          type: 'addDevicePassPass2Result',
          data: message.data,
        }),
      )
      request.wsResponder = ws
      return
    }
    case 'addDevicePassPass3Result': {
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
      request.wsResponder.send(
        JSON.stringify({
          type: 'addDevicePassPass3Result',
          data: message.data,
        }),
      )
      return
    }
    case 'addDeviceFlowSendPublicKey': {
      const { initiatorUserIdString } = message.data
      // find matching request
      const request = ongoingAddDeviceRequests.find(
        (r) => r.initiatorUserIdString === initiatorUserIdString,
      )
      if (!request) {
        console.error('Request not found')
        return
      }

      request.wsInitiator.send(
        JSON.stringify({
          type: 'receivePublicKey',
          data: message.data,
        }),
      )
      return
    }
    case 'sendInitialVaultData': {
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

      request.wsResponder.send(
        JSON.stringify({
          type: 'receiveInitialVaultData',
          data: message.data,
        }),
      )
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
    handleMessage(ws, messageDecoded as Message)
  })

  // ws.send('something')
})
