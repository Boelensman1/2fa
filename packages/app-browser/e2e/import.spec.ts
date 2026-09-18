import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const vaultFixture = readFileSync(
  resolve(__dirname, '../../lib/tests/fixtures/vault-v2.json'),
  'utf8',
)
const vaultPassword = 'fixture!Vault7#Frozen$v2'
const exportPassword = 'e2e!Export9#Separate$password'
// An unversioned export using the previous iterated S2K and AEAD settings.
// The deliberately weak password includes spaces: import must neither apply
// current password-strength rules nor trim passwords from older exports.
const legacyExport = readFileSync(
  resolve(__dirname, 'fixtures/export-legacy.txt.pgp'),
  'utf8',
)
const legacyPassword = ' old '
const plainEntry =
  'otpauth://totp/Import%20Issuer:Imported%20Account?secret=JBSWY3DPEHPK3PXP&issuer=Import%20Issuer'

const importer = (page: Page) =>
  page.getByRole('region', { name: 'Import items' })

const selectFile = async (
  page: Page,
  contents: string,
  name = 'export.txt',
) => {
  await importer(page)
    .getByLabel('Choose file')
    .setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(contents),
    })
}

const dropFiles = async (page: Page, contents: string[]) => {
  await importer(page)
    .getByText('Drag and drop a file here', { exact: true })
    .evaluate((element, files) => {
      const transfer = new DataTransfer()
      files.forEach((text, index) => {
        transfer.items.add(new File([text], `renamed-${index}.txt`))
      })
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
      )
    }, contents)
}

const login = async (page: Page) => {
  await page.getByLabel('Password', { exact: true }).fill(vaultPassword)
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Added Items' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate((fixture) => {
    localStorage.setItem('lockedRepresentation', fixture)
  }, vaultFixture)
  await page.reload()
  await login(page)
  await page.getByRole('button', { name: 'Show Importer' }).click()
})

test('imports a current encrypted web export into a new vault and persists it', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Show Exporter' }).click()
  await page.getByLabel('Password (optional):').fill(exportPassword)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export and Download' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('exported_2fa_text.txt.pgp')
  const contents = readFileSync(await download.path(), 'utf8')
  expect(contents).toContain('-----BEGIN PGP MESSAGE-----')
  expect(contents).not.toContain('Fixture Entry One')

  // Only this test's isolated browser context is reset; the next vault is
  // created through the UI with a different password from the export.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByLabel('New password', { exact: true }).fill(vaultPassword)
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Added Items' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show Importer' }).click()

  await selectFile(page, contents, download.suggestedFilename())
  await expect(importer(page).getByLabel('Export password')).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(0)
  await importer(page).getByLabel('Export password').fill(exportPassword)
  await importer(page)
    .getByRole('button', { name: 'Import', exact: true })
    .click()
  await expect(importer(page).getByRole('status')).toHaveText(
    'Imported: 2. Failed: 0.',
  )
  await expect(
    page.getByText('Fixture Entry One', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Fixture Entry Two', { exact: true }),
  ).toBeVisible()
  await expect(importer(page).getByLabel('Export password')).toBeHidden()

  await page.reload()
  await login(page)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(
    page.getByText('Fixture Entry One', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Fixture Entry Two', { exact: true }),
  ).toBeVisible()
})

test('detects a renamed legacy export, retries a wrong password, and blocks overlapping imports', async ({
  page,
}) => {
  const storedBefore = await page.evaluate(() =>
    localStorage.getItem('lockedRepresentation'),
  )
  await dropFiles(page, [`\uFEFF \n${legacyExport}`])
  const password = importer(page).getByLabel('Export password')
  const submit = importer(page).getByRole('button', {
    name: 'Import',
    exact: true,
  })
  await expect(password).toBeVisible()
  await expect(submit).toBeDisabled()
  await password.fill('incorrect password')
  await submit.click()
  await expect(importer(page).getByRole('alert')).toContainText(
    'Check the export password',
  )
  await expect(password).toHaveValue('')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  expect(
    await page.evaluate(() => localStorage.getItem('lockedRepresentation')),
  ).toBe(storedBefore)

  await password.fill(legacyPassword)
  // Dispatch synchronously so both submits and the extra drop happen while
  // real decryption is pending, without relying on machine-dependent timings.
  const disabled = await importer(page)
    .locator('form')
    .evaluate((form, text) => {
      if (!(form instanceof HTMLFormElement)) {
        throw new Error('Expected an import form')
      }
      form.requestSubmit()
      form.requestSubmit()
      const region = form.closest('section')!
      const transfer = new DataTransfer()
      transfer.items.add(new File([text], 'overlapping.txt'))
      region
        .querySelector('input[type=file]')!
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
        )
      return Array.from(region.querySelectorAll('input, button')).every(
        (control) => (control as HTMLInputElement | HTMLButtonElement).disabled,
      )
    }, plainEntry)
  expect(disabled).toBe(true)
  await expect(importer(page).getByRole('status')).toHaveText(
    'Imported: 1. Failed: 0.',
  )
  await expect(page.getByRole('listitem')).toHaveCount(3)
  await expect(page.getByText('Legacy Account', { exact: true })).toBeVisible()
  await expect(page.getByText('Imported Account', { exact: true })).toBeHidden()
  await expect(importer(page).getByRole('alert')).toBeHidden()
  await selectFile(page, legacyExport)
  await expect(password).toHaveValue('')
})

test('clears passwords on cancellation, replacement, and closing the panel', async ({
  page,
}) => {
  const password = importer(page).getByLabel('Export password')
  await selectFile(page, legacyExport, 'first.pgp')
  await password.fill(legacyPassword)
  await importer(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(password).toBeHidden()

  await selectFile(page, legacyExport, 'first.pgp')
  await expect(password).toHaveValue('')
  await password.fill(legacyPassword)
  await selectFile(page, legacyExport, 'replacement.pgp')
  await expect(password).toHaveValue('')
  await expect(
    importer(page).getByText('Selected file: replacement.pgp'),
  ).toBeVisible()

  await password.fill(legacyPassword)
  await page.getByRole('button', { name: 'Hide Importer' }).click()
  await page.getByRole('button', { name: 'Show Importer' }).click()
  await expect(password).toBeHidden()
  await selectFile(page, legacyExport)
  await expect(password).toHaveValue('')
  // Replacing an encrypted selection with plain text must discard the password.
  await password.fill(legacyPassword)
  await selectFile(page, plainEntry)
  await expect(importer(page).getByRole('status')).toHaveText(
    'Imported: 1. Failed: 0.',
  )
  await expect(password).toBeHidden()
  await expect(page.getByRole('listitem')).toHaveCount(3)
})

test('reports corrupt ciphertext without exposing file contents or password', async ({
  page,
}) => {
  const messages: string[] = []
  page.on('console', (message) => messages.push(message.text()))
  const storedBefore = await page.evaluate(() =>
    localStorage.getItem('lockedRepresentation'),
  )
  await selectFile(page, '-----BEGIN PGP MESSAGE-----\nprivate-file-content')
  await importer(page).getByLabel('Export password').fill('private-password')
  await importer(page)
    .getByRole('button', { name: 'Import', exact: true })
    .click()
  await expect(importer(page).getByRole('alert')).toContainText(
    'Could not import the file.',
  )
  await expect(importer(page).getByLabel('Export password')).toHaveValue('')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  expect(
    await page.evaluate(() => localStorage.getItem('lockedRepresentation')),
  ).toBe(storedBefore)
  expect(messages.join('\n')).not.toMatch(
    /private-file-content|private-password/,
  )
  await expect(importer(page)).not.toContainText('private-file-content')
})

test('imports plain text immediately and reports partial, invalid, and empty results', async ({
  page,
}) => {
  await selectFile(
    page,
    `# fava-export-version: 999\n${plainEntry}\ninvalid-entry`,
  )
  await expect(importer(page).getByRole('status')).toHaveText(
    'Imported: 1. Failed: 1.',
  )
  await expect(
    page.getByText('Imported Account', { exact: true }),
  ).toBeVisible()
  await expect(importer(page).getByLabel('Export password')).toBeHidden()

  await dropFiles(page, ['invalid-entry'])
  await expect(importer(page).getByRole('alert')).toHaveText(
    'No entries imported. Failed: 1. Choose a Fava text export.',
  )
  await expect(importer(page).getByRole('status')).toBeEmpty()
  for (const contents of ['', '# fava-export-version: 1\n']) {
    await selectFile(page, contents)
    await expect(importer(page).getByRole('status')).toHaveText(
      'No entries found.',
    )
    await expect(importer(page).getByRole('alert')).toBeHidden()
  }
  await expect(page.getByRole('listitem')).toHaveCount(3)
  await page.reload()
  await login(page)
  await expect(
    page.getByText('Imported Account', { exact: true }),
  ).toBeVisible()
})

test('rejects multiple dropped files and recovers from a file read failure', async ({
  page,
}) => {
  await dropFiles(page, [plainEntry, plainEntry])
  await expect(importer(page).getByRole('alert')).toHaveText(
    'Please choose one file at a time.',
  )
  await expect(page.getByRole('listitem')).toHaveCount(2)

  await page.evaluate(() => {
    File.prototype.text = () =>
      Promise.reject(new Error('Unreadable test file'))
  })
  await selectFile(page, plainEntry)
  await expect(importer(page).getByRole('alert')).toHaveText(
    'Could not read the file. Please select it again.',
  )
  await expect(importer(page).getByLabel('Choose file')).toBeEnabled()
  await page.evaluate(() => {
    Reflect.deleteProperty(File.prototype, 'text')
  })
  await selectFile(page, plainEntry)
  await expect(importer(page).getByRole('status')).toHaveText(
    'Imported: 1. Failed: 0.',
  )
  await expect(page.getByRole('listitem')).toHaveCount(3)
})

test('ignores another drop while reading and discards a read after closing the panel', async ({
  page,
}) => {
  await importer(page)
    .getByText('Drag and drop a file here', { exact: true })
    .evaluate((element, contents) => {
      const file = new File([contents], 'slow.txt')
      file.text = () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            'finish-import-read',
            () => resolve(contents),
            { once: true },
          )
        })
      const transfer = new DataTransfer()
      transfer.items.add(file)
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
      )
    }, plainEntry)
  await expect(importer(page).getByRole('status')).toHaveText('Reading file…')
  await expect(importer(page).getByLabel('Choose file')).toBeDisabled()
  await dropFiles(page, [legacyExport])
  await expect(importer(page).getByLabel('Export password')).toBeHidden()
  await page.getByRole('button', { name: 'Hide Importer' }).click()
  await page.getByRole('button', { name: 'Show Importer' }).click()
  await page.evaluate(() =>
    document.dispatchEvent(new Event('finish-import-read')),
  )
  await expect(importer(page).getByRole('status')).toBeEmpty()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await selectFile(page, legacyExport)
  await expect(importer(page).getByLabel('Export password')).toHaveValue('')
})
