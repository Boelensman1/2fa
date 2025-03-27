/* eslint-disable no-restricted-globals */
import { vi } from 'vitest'
import NodeCryptoProvider from '../src/CryptoProviders/node/index.mjs'
import type WS from 'vitest-websocket-mock'
import {
  getTwoFaLibVaultCreationUtils,
  DeviceId,
  DeviceType,
  type NewEntry,
  type Passphrase,
  type TwoFaLib,
  Entry,
  EntryId,
  TwoFaLibEvent,
} from '../src/main.mjs'
import type { Client as WsClient } from 'mock-socket'
import { PassphraseExtraDict } from '../src/interfaces/PassphraseExtraDict.js'

import type ServerMessage from 'favaserver/ServerMessage'
import type {
  SyncCommandsClientMessage,
  SyncCommandsExecutedClientMessage,
} from 'favaserver/ClientMessage'

export const newTotpEntry: NewEntry = {
  name: 'Test TOTP',
  issuer: 'Test Issuer',
  type: 'TOTP',
  payload: {
    secret: 'TESTSECRET',
    period: 30,
    algorithm: 'SHA-1',
    digits: 6,
  },
}
export const totpEntry: Entry = {
  ...newTotpEntry,
  id: '0000' as EntryId,
  addedAt: Date.now(),
  updatedAt: 0,
}

export const anotherNewTotpEntry: NewEntry = {
  ...newTotpEntry,
  name: 'Another TOTP',
  issuer: 'Another Issuer',
}
export const anotherTotpEntry: Entry = {
  ...newTotpEntry,
  id: '1111' as EntryId,
  addedAt: Date.now(),
  updatedAt: 0,
}

export const deviceId = 'device-id' as DeviceId
export const deviceType = 'test-device' as DeviceType
export const passphrase = 'w!22M@#GdRKqp#58#9&e' as Passphrase

export const passphraseExtraDict: PassphraseExtraDict = ['test']

/**
 * Creates a TwoFaLib instance that can be used for testing.
 * @returns A promise that resolves to the TwoFaLib instance.
 */
export const createTwoFaLibForTests = async () => {
  const cryptoLib = new NodeCryptoProvider()
  const { createNewTwoFaLibVault } = getTwoFaLibVaultCreationUtils(
    cryptoLib,
    deviceType,
    passphraseExtraDict,
  )
  const result = await createNewTwoFaLibVault(passphrase)
  const keys = await cryptoLib.decryptKeys(
    result.encryptedPrivateKey,
    result.encryptedSymmetricKey,
    result.salt,
    passphrase,
  )

  addTestLogEventListener(result.twoFaLib)

  return { cryptoLib, passphrase, ...result, ...keys }
}

/**
 * Clears all entries from the vault.
 * @param twoFaLib - The TwoFaLib instance.
 */
export const clearEntries = async (twoFaLib: TwoFaLib) => {
  const entries = twoFaLib.vault.listEntries()
  for (const entryId of entries) {
    await twoFaLib.vault.deleteEntry(entryId)
  }
}

/**
 * Omits the specified keys from an object.
 * @param obj - The object to omit keys from.
 * @param keys - The keys to omit.
 * @returns A new object with the specified keys omitted.
 */
export const omit = (obj: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))

/**
 * Connects two TwoFaLib instances for syncing
 * @param params - The connection parameters
 * @param params.senderTwoFaLib - The TwoFaLib instance initiating the connection
 * @param params.receiverTwoFaLib - The TwoFaLib instance being added
 * @param params.server - The WebSocket mock server
 * @param params.senderWsInstance - The sender's WebSocket client
 * @param params.receiverWsInstance - The receiver's WebSocket client
 * @returns A promise that resolves when the connection is complete
 * @throws If sync manager is not initialized or connection fails
 */
export async function connectDevices({
  senderTwoFaLib,
  receiverTwoFaLib,
  server,
  wsInstancesMap,
}: {
  senderTwoFaLib: TwoFaLib
  receiverTwoFaLib: TwoFaLib
  server: WS
  wsInstancesMap: Map<DeviceId, WsClient>
}) {
  if (!senderTwoFaLib.sync || !receiverTwoFaLib.sync) {
    throw new Error('Sync manager not initialized')
  }

  const senderWsInstance = wsInstancesMap.get(senderTwoFaLib.deviceId)
  const receiverWsInstance = wsInstancesMap.get(receiverTwoFaLib.deviceId)

  if (!senderWsInstance || !receiverWsInstance) {
    throw new Error('Sender/receiver ws instance not found')
  }

  // Initiate add device flow
  const initiateResultPromise = senderTwoFaLib.sync.initiateAddDeviceFlow({
    qr: false,
    text: true,
  })

  await server.nextMessage
  send(senderWsInstance, 'confirmAddSyncDeviceInitialiseData')

  // Connect the devices
  const initiateResult = await initiateResultPromise
  await receiverTwoFaLib.sync.respondToAddDeviceFlow(
    initiateResult.text,
    'text',
  )

  // Connect the devices
  // Handle the message flow
  const messages = [
    { type: 'JPAKEPass2', sender: senderWsInstance },
    { type: 'JPAKEPass3', sender: receiverWsInstance },
    { type: 'publicKey', sender: senderWsInstance },
    { type: 'initialVault', sender: receiverWsInstance },
  ] as const

  for (const { type, sender } of messages) {
    const message = (await server.nextMessage) as { data: unknown }
    send(sender, type, message.data)
  }

  // Wait for connection to complete
  await vi.waitUntil(() => !receiverTwoFaLib.sync?.inAddDeviceFlow, {
    timeout: 200,
    interval: 5,
  })

  // Verify connection was successful
  if (
    senderTwoFaLib.sync.inAddDeviceFlow ||
    receiverTwoFaLib.sync.inAddDeviceFlow
  ) {
    throw new Error('Device connection failed')
  }

  await handleSyncCommands(server, senderTwoFaLib.deviceId, wsInstancesMap)
}

/**
 * Sends a message through a WebSocket connection
 * @param ws - The WebSocket client instance
 * @param type - The type of message to send
 * @param data - The data payload to send (defaults to empty object)
 */
export const send = <T extends ServerMessage['type']>(
  ws: WsClient,
  type: T,
  data: unknown = {},
) => {
  ws.send(JSON.stringify({ type, data }))
}

/**
 * Adds an event listener to relay warning logs
 * @param lib - The TwoFaLib to add the event listener to
 */
export const addTestLogEventListener = (lib: TwoFaLib) => {
  lib.addEventListener(TwoFaLibEvent.Log, (event) => {
    if (event.detail.severity !== 'info') {
      console.log(event.detail.message)
    }
  })
}

/**
 * Mocks the responses to the sync commands flow by the server
 * @param server - The WebSocket mock server
 * @param senderDeviceId - The device ID of the sender
 * @param wsInstancesMap - The map of client ids to WebSocket clients
 * @returns The sync commands message and the executed messages
 */
export const handleSyncCommands = async (
  server: WS,
  senderDeviceId: DeviceId,
  wsInstancesMap: Map<DeviceId, WsClient>,
) => {
  const senderWsInstance = wsInstancesMap.get(senderDeviceId)
  if (!senderWsInstance) {
    throw new Error('Could not find sender ws instance')
  }

  // Wait for the command to be re-sent
  const syncCommandsMsg =
    (await server.nextMessage) as SyncCommandsClientMessage

  if (syncCommandsMsg.type !== 'syncCommands') {
    throw new Error(
      `Wrong message received:\n ${JSON.stringify(syncCommandsMsg, null, 2)} `,
    )
  }

  // Send confirmation of received commands
  send(senderWsInstance, 'syncCommandsReceived', {
    commandIds: syncCommandsMsg.data.commands.map((c) => c.commandId),
  })

  const syncCommandsExecutedMsgs = new Map<
    DeviceId,
    SyncCommandsExecutedClientMessage
  >()

  for (const command of syncCommandsMsg.data.commands) {
    const receiverWsInstance = wsInstancesMap.get(command.deviceId)
    if (!receiverWsInstance) {
      throw new Error(`Could not find receiverWsInstance ${command.deviceId}`)
    }

    // Send commands to receiver
    send(receiverWsInstance, 'syncCommands', syncCommandsMsg.data.commands)

    const executedMsg =
      (await server.nextMessage) as SyncCommandsExecutedClientMessage
    if (executedMsg.type !== 'syncCommandsExecuted') {
      throw new Error(
        `Expected "syncCommandsExecuted" type but got "${executedMsg.type as string}"`,
      )
    }
    syncCommandsExecutedMsgs.set(command.deviceId, executedMsg)
  }

  return {
    syncCommandsMessage: syncCommandsMsg,
    syncCommandsExecutedMessages: syncCommandsExecutedMsgs,
  }
}
