/**
 * Pairing and syncing between the engine and favalib on node, through a real
 * sync server. Skipped unless one is configured:
 *
 *   FAVA_SYNC_TEST_URL=ws://localhost:8080 \
 *   FAVA_SYNC_TEST_SECRET=dev-only-sync-secret-not-for-real-use make test
 */
import { afterEach, describe, expect, inject, it } from 'vitest'
import {
  FavaLibEvent,
  getFavaLibVaultCreationUtils,
  type DeviceType,
  type FavaLib,
  type Password,
  type ServerSecret,
} from 'favalib'
import { nodeProviders } from 'favalib/platformProviders/node'

import {
  loadEngine,
  PASSWORD,
  TOTP_SECRET,
  type TestEngine,
} from './harness.mjs'

const url = process.env.FAVA_SYNC_TEST_URL
const secret = process.env.FAVA_SYNC_TEST_SECRET

const until = async (what: string, check: () => Promise<boolean> | boolean) => {
  const deadline = Date.now() + 20_000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.skipIf(!url || !secret)('sync through a real server', () => {
  let engine: TestEngine | undefined
  let peer: FavaLib | undefined
  afterEach(() => {
    engine?.dispose()
    peer?.sync?.closeServerConnection()
  })

  it('pairs with node favalib and syncs entries both ways', async () => {
    engine = await loadEngine(inject('productionBundle'))
    await engine.call('createVault', PASSWORD)
    await engine.call('setSyncServer', url, secret)
    expect(await engine.call('status')).toMatchObject({ syncConnected: true })

    peer = (
      await getFavaLibVaultCreationUtils(
        nodeProviders,
        'node-peer' as DeviceType,
        ['phone'],
        () => undefined,
      ).createNewFavaLibVault(`${PASSWORD}-peer` as Password)
    ).favaLib
    await peer.setSyncServerUrl(url!, secret as ServerSecret)

    const { text, qrPayload } = await engine.call<{
      text: string
      qrPayload: string
    }>('initiatePairing')
    expect(JSON.parse(qrPayload)).toHaveProperty('initiatorDeviceId')
    const joined = new Promise((resolve) =>
      peer!.addEventListener(
        FavaLibEvent.ConnectToExistingVaultFinished,
        resolve,
      ),
    )
    await peer.sync!.respondToAddDeviceFlow(text, 'text')
    await joined
    await until('the pairing to finish on the engine', () =>
      engine!.events.some((e) => e.type === 'addDeviceFlowFinished'),
    )
    expect(await engine.call<unknown[]>('syncDevices')).toHaveLength(1)

    await peer.vault.addEntry({
      name: 'FromPeer',
      issuer: 'node',
      type: 'TOTP',
      payload: {
        secret: TOTP_SECRET,
        period: 30,
        algorithm: 'SHA-1',
        digits: 6,
      },
    })
    await until('the peer entry on the engine', async () =>
      (await engine!.call<{ name: string }[]>('listEntries')).some(
        (e) => e.name === 'FromPeer',
      ),
    )

    await engine.call('addEntry', {
      name: 'FromEngine',
      issuer: 'ios',
      type: 'TOTP',
      payload: {
        secret: TOTP_SECRET,
        period: 30,
        algorithm: 'SHA-1',
        digits: 6,
      },
    })
    await until('the engine entry on the peer', () =>
      peer!.vault.listEntriesMetas().some((e) => e.name === 'FromEngine'),
    )
  })
})
