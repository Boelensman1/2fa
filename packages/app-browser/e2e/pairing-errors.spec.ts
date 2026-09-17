import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The version this build stamps onto a pairing payload. Must track
// PAIRING_VERSION in packages/lib/src/version.mts; when that is bumped, the
// "cannot read" case below starts reporting a version mismatch instead, which
// fails loudly rather than silently passing.
const pairingVersion = '2.0'

const vaultPassword = 'e2e!Pairing7#Errors$vault'

/**
 * Encodes a pairing payload the way an initiator hands it out.
 * @param payload - The pairing payload to encode.
 * @returns The payload as a connection string.
 */
const connectionString = (payload: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url')

/**
 * Creates a local vault in connect mode and waits for its sync socket.
 * @param page - The page to drive.
 */
const openConnectScreen = async (page: Page) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Or connect to Existing Vault', exact: true })
    .click()
  await page.getByLabel('New password', { exact: true }).fill(vaultPassword)

  const socketOpened = page.waitForEvent('websocket')
  await page
    .getByRole('button', { name: 'Connect to Vault', exact: true })
    .click()

  // respondToAddDeviceFlow checks the server connection before it looks at the
  // payload at all, and favalib sends its hello frame as soon as the socket is
  // open -- so the first sent frame is the signal that a submit will reach the
  // pairing checks. This screen shows no connection state to wait on instead.
  const socket = await socketOpened
  await socket.waitForEvent('framesent')

  await expect(page.getByPlaceholder('Or enter text here')).toBeVisible()
}

/**
 * Submits a pairing payload as the connection string an initiator would show.
 * @param page - The page to drive.
 * @param payload - The pairing payload to encode and submit.
 */
const submitConnectionString = async (
  page: Page,
  payload: Record<string, unknown>,
) => {
  await page
    .getByPlaceholder('Or enter text here')
    .fill(connectionString(payload))
  await page.getByRole('button', { name: 'Submit Text', exact: true }).click()
}

test('reports a pairing code from a device that predates pairing versions', async ({
  page,
}) => {
  await openConnectScreen(page)
  // No pairingVersion at all: a build on jpake-ts 1.x, whose proofs this one
  // cannot verify. The other device is the one that has to be updated.
  await submitConnectionString(page, { initiatorDeviceId: 'someDeviceId' })

  await expect(
    page.getByText(/update the other device and try again/),
  ).toBeVisible()
})

test('reports a pairing code from a newer device', async ({ page }) => {
  await openConnectScreen(page)
  await submitConnectionString(page, { pairingVersion: '99.0' })

  await expect(page.getByText(/update this device and try again/)).toBeVisible()
})

test('reports a pairing code this build cannot read', async ({ page }) => {
  await openConnectScreen(page)
  // Right version, nothing else: every other failure in the flow has to reach
  // the screen too, not just the version check.
  await submitConnectionString(page, { pairingVersion })

  await expect(
    page.getByText('Missing required fields in initiator data'),
  ).toBeVisible()
})
