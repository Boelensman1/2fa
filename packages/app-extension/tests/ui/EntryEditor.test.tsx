import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  EditableEntry,
  EntryUpdates,
  UpdateEntryResult,
  VaultSummary,
} from '../../lib/types'

const store = new Map<string, unknown>()
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: vi.fn() },
    tabs: {
      query: () =>
        Promise.resolve([{ id: 7, url: 'https://github.com/login' }]),
    },
  },
}))
vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: (key: string) =>
      Promise.resolve(structuredClone(store.get(key) ?? null)),
    setItem: (key: string, value: unknown) => {
      store.set(key, structuredClone(value))
      return Promise.resolve()
    },
    removeItem: (key: string) => {
      store.delete(key)
      return Promise.resolve()
    },
  },
}))

const getEditableEntry = vi.fn<() => Promise<EditableEntry | null>>()
const updateEntry =
  vi.fn<
    (id: string, updates: EntryUpdates) => Promise<UpdateEntryResult | null>
  >()
const listEntries = vi.fn()
const getToken = vi.fn()
vi.mock('@/lib/state', () => ({
  bgActions: {
    getEditableEntry: (...args: []) => getEditableEntry(...args),
    updateEntry: (id: string, updates: EntryUpdates) =>
      updateEntry(id, updates),
    listEntries: (...args: unknown[]) => listEntries(...args) as unknown,
    getFillTarget: () => Promise.resolve(null),
    getToken: () => getToken() as unknown,
  },
}))

const { default: AuthenticatedApp } =
  await import('../../lib/ui/components/AuthenticatedApp')
const { entryEditDraft } = await import('../../lib/drafts')

;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const original: EditableEntry = {
  id: 'entry-1' as EditableEntry['id'],
  issuer: 'GitHub',
  name: 'alice@example.com',
  url: 'https://github.com/login',
  matchers: [{ type: 'Host', value: 'github.com' }],
  inputSelector: '#otp',
}
const summary: VaultSummary = {
  status: 'unlocked',
  deviceId: 'device-1',
  deviceFriendlyName: 'Test',
  syncServerUrl: null,
  syncConnected: false,
  entryCount: 1,
}
let current: EditableEntry
let host: HTMLElement
let root: Root | null = null
const refresh = vi.fn()
const flush = (work: () => void) => act(() => Promise.resolve(work()))

const open = async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await flush(() =>
    root?.render(
      <AuthenticatedApp summary={summary} onVaultChanged={refresh} />,
    ),
  )
}
const close = () => {
  act(() => root?.unmount())
  root = null
  host?.remove()
}
const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find(
    (item) =>
      item.textContent?.trim() === text ||
      item.getAttribute('aria-label') === text,
  )
  if (!found) throw new Error(`No button: ${text}`)
  return found
}
const click = (text: string) => flush(() => button(text).click())
const field = (label: string) => {
  const id = [...host.querySelectorAll('label')].find(
    (item) => item.textContent === label,
  )?.htmlFor
  const found = id
    ? host.querySelector<HTMLInputElement>(`#${id}`)
    : host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!found) throw new Error(`No input: ${label}`)
  return found
}
const type = (label: string, value: string) =>
  flush(() => {
    const input = field(label)
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = () =>
  flush(() => {
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
const edit = async () => {
  await click('Details for GitHub')
  await click('Edit entry')
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
  current = structuredClone(original)
  getEditableEntry
    .mockReset()
    .mockImplementation(() => Promise.resolve(structuredClone(current)))
  updateEntry.mockReset().mockImplementation((_id, updates) => {
    current = { ...current, ...updates }
    store.delete('session:draft:entryEdit')
    return Promise.resolve({
      ok: true,
      error: null,
      entry: structuredClone(current),
    })
  })
  listEntries.mockImplementation(() =>
    Promise.resolve({
      all: [{ ...current, matchedBy: null }],
      forSite: current.matchers.some(
        (matcher) => matcher.value === 'github.com',
      )
        ? [{ ...current, matchedBy: current.matchers[0] }]
        : [],
    }),
  )
})
afterEach(close)

describe('the popup entry editor', () => {
  it('loads fresh metadata and returns to updated details and site matches', async () => {
    await open()
    await edit()
    expect(field('Issuer').value).toBe(original.issuer)
    expect(field('Account name').value).toBe(original.name)
    expect(field('Website').value).toBe(original.url)
    expect(field('OTP field selector').value).toBe(original.inputSelector)
    expect(field('Matcher 1 value').value).toBe('github.com')

    await type('Issuer', '  Updated GitHub  ')
    await type('Account name', ' bob@example.com ')
    await type('Website', ' ')
    await type('OTP field selector', '')
    await click('Remove matcher 1')
    await click('Add matcher')
    await submit()

    expect(updateEntry).toHaveBeenCalledWith(original.id, {
      issuer: 'Updated GitHub',
      name: 'bob@example.com',
      url: null,
      inputSelector: null,
      matchers: [],
    })
    expect(host.textContent).toContain('Entry saved')
    expect(host.textContent).toContain('Updated GitHub')
    expect(host.textContent).toContain('bob@example.com')
    expect(store.has('session:draft:entryEdit')).toBe(false)
    expect(refresh).toHaveBeenCalledOnce()
    await click('Back to vault')
    expect(host.textContent).toContain('Updated GitHub')
    expect(host.textContent).not.toContain('For this site')
    expect(listEntries).toHaveBeenCalledTimes(2)
    expect(getToken).not.toHaveBeenCalled()
  })

  it('restores unsaved values after popup teardown without replacing them with synced metadata', async () => {
    await open()
    await edit()
    await type('Issuer', 'Draft issuer')
    await click('Add matcher')
    await type('Matcher 2 value', 'example.com')
    close()
    current.issuer = 'Changed on another device'
    await open()
    expect(host.textContent).toContain('Edit entry')
    expect(field('Issuer').value).toBe('Draft issuer')
    expect(field('Matcher 2 value').value).toBe('example.com')
    expect(getEditableEntry).toHaveBeenCalledTimes(2)
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it.each(['Cancel', 'Back'])(
    'discards changes on %s and starts fresh the next time',
    async (label) => {
      await open()
      await edit()
      await type('Issuer', 'Discard me')
      await click(label)
      expect(store.has('session:draft:entryEdit')).toBe(false)
      expect(updateEntry).not.toHaveBeenCalled()
      await click('Edit entry')
      expect(field('Issuer').value).toBe('GitHub')
      close()
      await open()
      expect(host.querySelector('form')).toBeNull()
    },
  )

  it.each(['Issuer', 'Account name'])(
    'requires a nonblank %s',
    async (label) => {
      await open()
      await edit()
      await type(label, '   ')
      await submit()
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'required',
      )
      expect(updateEntry).not.toHaveBeenCalled()
      expect(store.has('session:draft:entryEdit')).toBe(true)
    },
  )

  it('rejects invalid regexes and preserves ordered matcher edits', async () => {
    await open()
    await edit()
    await click('Add matcher')
    await flush(() => {
      const select = host.querySelector<HTMLSelectElement>(
        'select[aria-label="Matcher 2 type"]',
      )!
      select.value = 'Regex'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await type('Matcher 2 value', '(')
    await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'regex matcher is invalid',
    )
    expect(updateEntry).not.toHaveBeenCalled()
    await type('Matcher 2 value', 'https://example\\.com/.*')
    await submit()
    expect(current.matchers).toEqual([
      { type: 'Host', value: 'github.com' },
      { type: 'Regex', value: 'https://example\\.com/.*' },
    ])
  })

  it('limits matcher count and field lengths using library limits', async () => {
    current.matchers = Array.from({ length: 16 }, (_, i) => ({
      type: 'Host',
      value: `site${i}.example`,
    }))
    await open()
    await edit()
    expect(button('Add matcher').disabled).toBe(true)
    expect(field('Issuer').maxLength).toBe(256)
    expect(field('Website').maxLength).toBe(2048)
    expect(field('OTP field selector').maxLength).toBe(256)
    expect(field('Matcher 1 value').maxLength).toBe(512)
  })

  it.each(['rejection', 'transport', 'null'])(
    'keeps drafts after a %s failure and allows retry',
    async (failure) => {
      await open()
      await edit()
      await type('Issuer', 'Retry me')
      if (failure === 'rejection')
        updateEntry.mockResolvedValueOnce({
          ok: false,
          error: 'The vault is locked',
          entry: null,
        })
      else if (failure === 'transport')
        updateEntry.mockRejectedValueOnce(new Error('disconnected'))
      else updateEntry.mockResolvedValueOnce(null)
      await submit()
      expect(host.querySelector('[role="alert"]')).not.toBeNull()
      expect(field('Issuer').value).toBe('Retry me')
      expect(button('Save changes').disabled).toBe(false)
      close()
      await open()
      expect(field('Issuer').value).toBe('Retry me')
      await submit()
      expect(host.textContent).toContain('Entry saved')
    },
  )

  it('prevents duplicate submissions while saving', async () => {
    let finish!: (result: UpdateEntryResult) => void
    updateEntry.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await open()
    await edit()
    await submit()
    await submit()
    expect(updateEntry).toHaveBeenCalledOnce()
    expect(button('Saving…').disabled).toBe(true)
    expect(button('Cancel').disabled).toBe(true)
    expect(host.querySelector('fieldset')?.disabled).toBe(true)
    await flush(() => finish({ ok: true, error: null, entry: current }))
  })

  it('leaves save cleanup to the background when the popup closes mid-request', async () => {
    let finish!: (result: UpdateEntryResult) => void
    updateEntry.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await open()
    await edit()
    await type('Issuer', 'Saved while closed')
    await submit()
    close()
    // The real UPDATE_ENTRY handler owns these two operations, tested in its suite.
    current.issuer = 'Saved while closed'
    await entryEditDraft.clear()
    await flush(() => finish({ ok: true, error: null, entry: current }))
    await open()
    expect(host.querySelector('form')).toBeNull()
    expect(host.textContent).toContain('Saved while closed')
  })

  it('does not recreate a deleted draft entry and allows backing out', async () => {
    await open()
    await edit()
    await type('Issuer', 'Draft')
    close()
    getEditableEntry.mockResolvedValue(null)
    await open()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'unavailable',
    )
    expect(button('Save changes').disabled).toBe(true)
    expect(updateEntry).not.toHaveBeenCalled()
    await click('Back')
    expect(store.has('session:draft:entryEdit')).toBe(false)
  })

  it('retains the draft after a load failure and hides inputs until loading completes', async () => {
    await open()
    await edit()
    await type('Issuer', 'Keep this')
    close()
    getEditableEntry.mockRejectedValueOnce(new Error('offline'))
    await open()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load',
    )
    let finish!: (entry: EditableEntry) => void
    getEditableEntry.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await click('Try again')
    expect(host.querySelector('input')).toBeNull()
    await flush(() => finish(current))
    expect(field('Issuer').value).toBe('Keep this')
  })
})
