import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from './fixtures'

// The frozen historical vault. Storage version 1 was dropped rather than
// migrated, so what this file checks is the refusal: the app must say what is
// wrong, must not offer to reset, and must leave the blob exactly as it found
// it.
const v1Fixture = readFileSync(
  resolve(__dirname, '../../lib/tests/fixtures/vault-v1.json'),
  'utf8',
)
const password = 'fixture!Vault7#Frozen$v1'

test.beforeEach(async ({ page }) => {
  // Seed only this test's browser context.
  await page.goto('/')
  await page.evaluate((fixture) => {
    localStorage.setItem('lockedRepresentation', fixture)
  }, v1Fixture)
  await page.reload()
})

test('refuses a v1 vault at login and leaves it untouched', async ({
  page,
}) => {
  // The correct password, deliberately: the refusal has to come from the
  // version gate, not from a failed unlock.
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()

  await expect(page.getByText(/older storage format/)).toBeVisible()
  await expect(page.getByText(/export your entries/)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Added Items', exact: true }),
  ).toBeHidden()

  // Reset wipes localStorage and this app keeps no backup, so it must not be
  // on screen next to a message about a vault whose data is still recoverable
  // through an export.
  await expect(
    page.getByRole('button', { name: 'Reset', exact: true }),
  ).toBeHidden()

  const stored = await page.evaluate(() =>
    localStorage.getItem('lockedRepresentation'),
  )
  expect(stored).toBe(v1Fixture)
})

test('still refuses it after a reload', async ({ page }) => {
  // A refusal that did not write anything must be reproducible. If the first
  // attempt had migrated the blob, this second one would sail through.
  await page.reload()
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()

  await expect(page.getByText(/older storage format/)).toBeVisible()
  const stored = await page.evaluate(() =>
    localStorage.getItem('lockedRepresentation'),
  )
  expect(stored).toBe(v1Fixture)
})

test('reports a truncated vault as a recoverable error, not a JSON crash', async ({
  page,
}) => {
  // The message shown here sits directly above a Reset button that clears
  // localStorage, so "Unexpected end of JSON input" -- what a bare SyntaxError
  // out of JSON.parse used to produce -- is the worst possible text to put in
  // front of someone whose vault is merely truncated.
  await page.evaluate((fixture) => {
    localStorage.setItem('lockedRepresentation', fixture.slice(0, 120))
  }, v1Fixture)
  await page.reload()

  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()

  await expect(page.getByText(/is not valid JSON/)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Added Items', exact: true }),
  ).toBeHidden()
})
