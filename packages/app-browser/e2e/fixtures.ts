import { test as base, expect } from '@playwright/test'

// Keep common browser checks here so new specs inherit them along with
// Playwright's isolated context and localStorage for each test.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await use(page)
    expect(errors, 'Uncaught browser errors').toEqual([])
  },
})

export { expect }
