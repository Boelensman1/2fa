import { vi } from 'vitest'
import NodeCryptoProvider from '../src/CryptoProviders/node/index.mjs'
import type ServerMessage from '2faserver/ServerMessage'
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

/**
 * Creates a TwoFaLib instance that can be used for testing.
 * @returns A promise that resolves to the TwoFaLib instance.
 */
export const createTwoFaLibForTests = async () => {
  const cryptoLib = new NodeCryptoProvider()
  const { createNewTwoFaLibVault } = getTwoFaLibVaultCreationUtils(cryptoLib)
  const result = await createNewTwoFaLibVault(deviceType, passphrase, ['test'])

  result.twoFaLib.addEventListener(TwoFaLibEvent.Log, (event) =>
    console.log(event.detail),
  )

  return { cryptoLib, passphrase, ...result }
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
  senderWsInstance,
  receiverWsInstance,
}: {
  senderTwoFaLib: TwoFaLib
  receiverTwoFaLib: TwoFaLib
  server: WS
  senderWsInstance: WsClient
  receiverWsInstance: WsClient
}) {
  if (!senderTwoFaLib.sync || !receiverTwoFaLib.sync) {
    // eslint-disable-next-line no-restricted-globals
    throw new Error('Sync manager not initialized')
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
    { type: 'vault', sender: receiverWsInstance },
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
    // eslint-disable-next-line no-restricted-globals
    throw new Error('Device connection failed')
  }
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
