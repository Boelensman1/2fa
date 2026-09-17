import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The version this build stamps onto a pairing payload. Must track
// PAIRING_VERSION in packages/lib/src/version.mts; when that is bumped, the
// "cannot read" case below starts reporting a version mismatch instead, which
// fails loudly rather than silently passing.
const pairingVersion = '2.0'

const vaultPassword = 'e2e!Pairing7#Errors$vault'

// What milly2-container/milly.nix configures the container's sync server with.
// A vault is created with sync switched off now, so this screen asks for the
// server and its secret before it will take a pairing payload at all -- see
// lib/key-hierarchy-review/16-server-authentication.md. Typed rather than left
// to VITE_DEVSERVERSECRET's prefill, so the test does not depend on how the dev
// server happens to have been started.
const syncServerUrl = '/api/sync'
const syncServerSecret = 'dev-only-sync-secret-not-for-real-use'

/**
 * Encodes a pairing payload the way an initiator hands it out.
 * @param payload - The pairing payload to encode.
 * @returns The payload as a connection string.
 */
const connectionString = (payload: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url')

/**
 * Creates a local vault in connect mode, configures sync, and waits for it.
 * @param page - The page to drive.
 */
const openConnectScreen = async (page: Page) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Or connect to Existing Vault', exact: true })
    .click()
  await page.getByLabel('New password', { exact: true }).fill(vaultPassword)
  await page
    .getByRole('button', { name: 'Connect to Vault', exact: true })
    .click()

  // A new vault has no sync server, so this screen offers the form instead of
  // the pairing input. Filling it in is what creates the socket at all.
  await page
    .getByPlaceholder('wss://sync.example.com or /api/sync')
    .fill(syncServerUrl)
  await page.getByPlaceholder('Server secret').fill(syncServerSecret)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()

  // The pairing input appears only once setSyncServerUrl has resolved, and that
  // now means the server has accepted the shared secret -- so this doubles as
  // the wait for a usable connection. It replaces a `framesent` listener that
  // watched for favalib's first frame, which is no longer the first thing on
  // the wire: the server speaks first now, with its challenge.
  await expect(page.getByPlaceholder('Or enter text here')).toBeVisible({
    timeout: 15_000,
  })
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
