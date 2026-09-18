import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}))

/** Stands in for `browser.storage.session`, keyed exactly as `drafts` keys it. */
const store = new Map<string, unknown>()

vi.mock('wxt/utils/storage', () => ({
  storage: {
    setItem: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    removeItem: (key: string) => {
      store.delete(key)
      return Promise.resolve()
    },
  },
}))

const setSyncServer = vi.fn()
vi.mock('@/lib/state', () => ({
  bgActions: {
    setSyncServer: (...args: unknown[]) => setSyncServer(...args) as unknown,
  },
}))

// The real prefills come from `import.meta.env`, which vitest does not define.
vi.mock('@/lib/parameters', () => ({
  syncServerUrlPrefill: 'ws://localhost:8080',
  syncServerSecretPrefill: '',
}))

const { default: SyncServerForm } =
  await import('../../lib/ui/components/SyncServerForm')

;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

/**
 * `act`, awaited.
 *
 * The callback returns a promise rather than being `async`: React types the
 * synchronous overload of `act` as returning `void`, so awaiting that form --
 * which is what flushes effects and the draft read -- does not typecheck.
 */
const flush = (work: () => void) => act(() => Promise.resolve(work()))

/** Opens the popup on the form, and waits for the draft read to land. */
const open = async (props: Parameters<typeof SyncServerForm>[0]) => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await flush(() => root.render(<SyncServerForm {...props} />))
}

/** What the popup closing does: the document is torn down, state and all. */
const close = () => {
  act(() => root.unmount())
  container.remove()
}

const field = (label: string): HTMLInputElement => {
  const input = [...container.querySelectorAll('label')]
    .filter((element) => element.textContent?.startsWith(label))
    .map((element) =>
      container.querySelector<HTMLInputElement>(`#${element.htmlFor}`),
    )
    .find(Boolean)
  if (!input) throw new Error(`No field labelled ${label}`)
  return input
}

/** Submits the form, the way the Connect button does. */
const submit = () =>
  flush(() =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )

/** Types into a field the way the browser does, through React's tracker. */
const type = async (input: HTMLInputElement, value: string) => {
  await flush(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  store.clear()
  setSyncServer.mockReset()
  setSyncServer.mockResolvedValue({ ok: true })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SyncServerForm', () => {
  // The bug this exists for: the address and the secret both live somewhere
  // else, and going to fetch either one closes the popup.
  it('still has both values after the popup was destroyed', async () => {
    const onConfigured = vi.fn()
    await open({ currentUrl: null, onConfigured })

    await type(field('Server address'), 'wss://sync.example.com')
    await type(field('Server secret'), 'hunter2')
    close()

    await open({ currentUrl: null, onConfigured })

    expect(field('Server address').value).toBe('wss://sync.example.com')
    expect(field('Server secret').value).toBe('hunter2')
  })

  it('starts from the prefill when nothing was typed', async () => {
    await open({ currentUrl: null, onConfigured: vi.fn() })

    expect(field('Server address').value).toBe('ws://localhost:8080')
    expect(field('Server secret').value).toBe('')
  })

  it('prefers the configured server to the build prefill', async () => {
    await open({ currentUrl: 'wss://mine.example', onConfigured: vi.fn() })

    expect(field('Server address').value).toBe('wss://mine.example')
  })

  it('forgets the secret once the server has accepted it', async () => {
    const onConfigured = vi.fn()
    await open({ currentUrl: null, onConfigured })
    await type(field('Server address'), 'wss://sync.example.com')
    await type(field('Server secret'), 'hunter2')

    await submit()

    expect(setSyncServer).toHaveBeenCalledWith(
      'wss://sync.example.com',
      'hunter2',
    )
    expect(onConfigured).toHaveBeenCalled()
    expect(store.has('session:draft:syncServer')).toBe(false)
  })

  it('forgets it when the form is cancelled', async () => {
    const onCancel = vi.fn()
    await open({ currentUrl: null, onConfigured: vi.fn(), onCancel })
    await type(field('Server secret'), 'hunter2')

    await flush(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Cancel')
        ?.click(),
    )

    expect(onCancel).toHaveBeenCalled()
    expect(store.has('session:draft:syncServer')).toBe(false)
  })

  // A rejected secret is still being worked on -- keep it.
  it('keeps the draft when the server says no', async () => {
    setSyncServer.mockResolvedValue({ ok: false, error: 'Wrong secret' })
    await open({ currentUrl: null, onConfigured: vi.fn() })
    await type(field('Server address'), 'wss://sync.example.com')
    await type(field('Server secret'), 'wrong')

    await submit()

    expect(store.get('session:draft:syncServer')).toEqual({
      url: 'wss://sync.example.com',
      secret: 'wrong',
    })
  })
})
