import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import type { FavaLib } from '../src/main.mjs'
import { createFavaLibForTests, testServerSecret } from './testUtils.mjs'

/**
 * Starts an HTTP server that answers everything the same way and never
 * upgrades, standing in for an address that is reachable but is not a sync
 * server.
 * @param status - The status to answer with.
 * @param body - The body to answer with.
 * @returns The server and the ws:// url pointing at it.
 */
const startNonSyncServer = async (status: number, body: string) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'text/plain' })
    response.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `ws://127.0.0.1:${port}/` }
}

/**
 * Finds a port with nothing on it, by taking one and giving it back.
 * @returns A ws:// url nothing is listening on.
 */
const unusedWsUrl = async () => {
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `ws://127.0.0.1:${port}/`
}

/**
 * Points a fresh vault at a server that will not connect, and waits for it to
 * give up. Forced, so the url is set despite the failure.
 * @param url - The sync server url.
 * @returns The library, with a sync manager that has failed to connect.
 */
const failToConnect = async (url: string) => {
  const { favaLib } = await createFavaLibForTests()
  await favaLib.setSyncServerUrl(url, testServerSecret, true)
  return favaLib
}

describe('connection failure diagnosis', () => {
  let favaLib: FavaLib | undefined
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    favaLib?.sync?.closeServerConnection()
    favaLib = undefined
    await close?.()
    close = undefined
  })

  it('names the server and what the socket was last seen doing', async () => {
    const url = await unusedWsUrl()
    favaLib = await failToConnect(url)

    expect(favaLib.sync!.describeConnectionFailure()).toContain(url)
    // The handshake never got anywhere, so the socket is all there is to say.
    expect(favaLib.sync!.describeConnectionFailure()).toMatch(
      /the socket (closed with code|reported an error|is )/,
    )
  }, 30000)

  it('reports what the address answers over HTTP', async () => {
    const started = await startNonSyncServer(418, 'not a sync server')
    close = () =>
      new Promise<void>((resolve) => started.server.close(() => resolve()))
    favaLib = await failToConnect(started.url)

    const diagnosis = await favaLib.sync!.diagnoseConnectionFailure()

    expect(diagnosis).toContain(started.url)
    expect(diagnosis).toMatch(/answered HTTP 418/)
    expect(diagnosis).toContain('not a sync server')
  }, 30000)

  it('reports an address with nothing listening as refused', async () => {
    const url = await unusedWsUrl()
    favaLib = await failToConnect(url)

    const diagnosis = await favaLib.sync!.diagnoseConnectionFailure()

    expect(diagnosis).toContain(url)
    expect(diagnosis).toMatch(/failed: (ECONNREFUSED|ECONNRESET)/)
  }, 30000)

  it('explains a 426, which is what a real sync server answers', async () => {
    const started = await startNonSyncServer(426, 'Upgrade Required')
    close = () =>
      new Promise<void>((resolve) => started.server.close(() => resolve()))
    favaLib = await failToConnect(started.url)

    const diagnosis = await favaLib.sync!.diagnoseConnectionFailure()

    expect(diagnosis).toMatch(/answered HTTP 426/)
    expect(diagnosis).toContain('The address is reachable')
  }, 30000)
})
