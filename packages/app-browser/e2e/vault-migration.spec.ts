import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import type { LockedRepresentation } from 'favalib'
import { test, expect } from './fixtures'

// Reuse the frozen historical vault; generating a fresh vault cannot exercise
// the migration that happens during login.
const v1Fixture = readFileSync(
  resolve(__dirname, '../../lib/tests/fixtures/vault-v1.json'),
  'utf8',
)
const password = 'fixture!Vault7#Frozen$v1'

const login = async (page: Page) => {
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Added Items', exact: true }),
  ).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  // Seed only this test's browser context. Do not re-seed on reload: reopening
  // must use the representation saved by the real app.
  await page.goto('/')
  await page.evaluate((fixture) => {
    localStorage.setItem('lockedRepresentation', fixture)
  }, v1Fixture)
  await page.reload()
})

test('migrates a v1 vault during login and reopens it after reload', async ({
  page,
}) => {
  await login(page)
  await expect(
    page.getByText('Fixture Entry One', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Fixture Entry Two', { exact: true }),
  ).toBeVisible()

  const migrated = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('lockedRepresentation')!,
      ) as LockedRepresentation,
  )
  expect(migrated.storageVersion).toBe(2)
  expect(migrated.envelopeMac).toEqual(expect.any(String))

  await page.reload()
  await login(page)
  await expect(
    page.getByText('Fixture Entry One', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Fixture Entry Two', { exact: true }),
  ).toBeVisible()
})

test('updates the UI and persists an entry edit after migration', async ({
  page,
}) => {
  await login(page)
  const entry = page.locator('li').filter({ hasText: 'Fixture Entry One' })
  await entry.getByTitle('More options').click()
  await entry.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Migrated Entry Edit')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('Migrated Entry Edit', { exact: true }),
  ).toBeVisible()

  await page.reload()
  await login(page)
  await expect(
    page.getByText('Migrated Entry Edit', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Fixture Entry Two', { exact: true }),
  ).toBeVisible()
})

test('reports a truncated vault as a recoverable error, not a JSON crash', async ({
  page,
}) => {
  // The message shown here sits directly above a Reset button that clears
  // localStorage, so "Unexpected end of JSON input" -- what a bare SyntaxError
  // out of JSON.parse used to produce -- is the worst possible text to put in
  // front of someone whose vault is merely truncated. See
  // lib/key-hierarchy-review/05-load-path-validation.md.
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
