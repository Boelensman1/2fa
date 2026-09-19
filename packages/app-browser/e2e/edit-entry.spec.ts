import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'

const vaultFixture = readFileSync(
  resolve(__dirname, '../../lib/tests/fixtures/vault-v2.json'),
  'utf8',
)
const vaultPassword = 'fixture!Vault7#Frozen$v2'

const login = async (page: Page) => {
  await page.getByLabel('Password', { exact: true }).fill(vaultPassword)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Added Items' })).toBeVisible()
}

const startEdit = async (entry: Locator) => {
  await entry.getByRole('button', { name: 'More options' }).click()
  await entry.getByRole('button', { name: 'Edit', exact: true }).click()
}

const expectSavedFields = async (entry: Locator) => {
  await expect
    .soft(entry.getByLabel('One-time-code input'))
    .toHaveValue('input[name="verification-code"]')
  await expect(entry.getByRole('combobox')).toHaveCount(2)
  await expect(entry.getByRole('combobox').nth(0)).toHaveValue('Host')
  await expect(
    entry.getByPlaceholder('github.com', { exact: true }).nth(0),
  ).toHaveValue('login.example.com')
  await expect(entry.getByRole('combobox').nth(1)).toHaveValue('UrlPrefix')
  await expect(
    entry.getByPlaceholder('github.com', { exact: true }).nth(1),
  ).toHaveValue('https://example.org/login')
  await expect(entry.getByLabel('Issuer', { exact: true })).toHaveValue(
    'Updated Issuer',
  )
  await expect(entry.getByLabel('Name', { exact: true })).toHaveValue(
    'Fixture Entry One Updated',
  )
  await expect(entry.getByLabel('Website url')).toHaveValue(
    'https://login.example.com',
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate((fixture) => {
    localStorage.setItem('lockedRepresentation', fixture)
  }, vaultFixture)
  await page.reload()
  await login(page)
})

test('prefills every saved field when reopening an edit after searching', async ({
  page,
}) => {
  await page.getByPlaceholder('Search items...').fill('fIXTURE eNTRY oNE')
  const entry = page.getByRole('listitem')
  await expect(entry).toHaveCount(1)
  await startEdit(entry)
  await entry.getByLabel('Issuer', { exact: true }).fill('Updated Issuer')
  await entry
    .getByLabel('Name', { exact: true })
    .fill('Fixture Entry One Updated')
  await entry.getByLabel('Website url').fill('https://login.example.com')
  await entry.getByRole('button', { name: 'Add matcher' }).click()
  await entry.getByRole('combobox').nth(0).selectOption('Host')
  await entry
    .getByPlaceholder('github.com', { exact: true })
    .nth(0)
    .fill('login.example.com')
  await entry.getByRole('button', { name: 'Add matcher' }).click()
  await entry.getByRole('combobox').nth(1).selectOption('UrlPrefix')
  await entry
    .getByPlaceholder('github.com', { exact: true })
    .nth(1)
    .fill('https://example.org/login')
  await entry
    .getByLabel('One-time-code input')
    .fill('input[name="verification-code"]')
  await entry.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(entry.getByRole('button', { name: 'Save' })).toBeHidden()

  // Keep the search unchanged: previously its results held the old metadata.
  await startEdit(entry)
  await expectSavedFields(entry)

  // Unsaved changes must not replace the values used on the next edit.
  await entry.getByLabel('One-time-code input').fill('#discarded')
  await entry
    .getByPlaceholder('github.com', { exact: true })
    .nth(0)
    .fill('discarded.example')
  await entry.getByRole('button', { name: 'Cancel' }).click()
  await startEdit(entry)
  await expectSavedFields(entry)
  await entry.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(entry.getByRole('button', { name: 'Save' })).toBeHidden()

  await page.reload()
  await login(page)
  await page.getByPlaceholder('Search items...').fill('Fixture Entry One')
  await startEdit(entry)
  await expectSavedFields(entry)
})

test('removes an edited entry from search results when it no longer matches', async ({
  page,
}) => {
  await page.getByPlaceholder('Search items...').fill('fIXTURE iSSUER a')
  const entry = page.getByRole('listitem')
  await expect(entry).toHaveCount(1)
  await startEdit(entry)
  await entry.getByLabel('Issuer', { exact: true }).fill('Updated Issuer')
  await entry.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(entry).toHaveCount(0)

  await page.getByPlaceholder('Search items...').fill('')
  await expect(entry).toHaveCount(2)
  await expect(page.getByText('Updated Issuer', { exact: true })).toBeVisible()
})
