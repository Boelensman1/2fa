import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}))

/** A stand-in for wxt's storage, keyed exactly as `drafts` keys it. */
const store = new Map<string, unknown>()
/** Set to make every call throw, standing in for a browser without `session`. */
let broken = false

vi.mock('wxt/utils/storage', () => ({
  storage: {
    setItem: (key: string, value: unknown) => {
      if (broken) throw new Error('no such storage area')
      store.set(key, value)
      return Promise.resolve()
    },
    getItem: (key: string) => {
      if (broken) throw new Error('no such storage area')
      return Promise.resolve(store.get(key) ?? null)
    },
    removeItem: (key: string) => {
      if (broken) throw new Error('no such storage area')
      store.delete(key)
      return Promise.resolve()
    },
  },
}))

const {
  clearDrafts,
  entryEditDraft,
  closeSyncServerEditor,
  createModeDraft,
  pairDraft,
  popupTabDraft,
  settingsEditingServerDraft,
  syncServerDraft,
} = await import('../../lib/drafts')

/** `write` is fire and forget, so a test has to let its promise settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  store.clear()
  broken = false
})

describe('drafts', () => {
  it('reads back nothing when nothing was typed', async () => {
    expect(await syncServerDraft.read()).toBeNull()
  })

  it('round-trips a draft through the session area', async () => {
    syncServerDraft.write({ url: 'ws://localhost:8080', secret: 'hunter2' })
    await settled()

    expect(await syncServerDraft.read()).toEqual({
      url: 'ws://localhost:8080',
      secret: 'hunter2',
    })
  })

  // `local:` would put a sync server secret and a live pairing code on disk,
  // outliving the browser that was meant to forget them.
  it('keeps every draft in the session area, never in local', async () => {
    syncServerDraft.write({ url: 'ws://localhost:8080', secret: 'hunter2' })
    pairDraft.write({ connectionString: 'code', deviceName: 'Work laptop' })
    popupTabDraft.write('settings')
    settingsEditingServerDraft.write(true)
    createModeDraft.write('create')
    entryEditDraft.write({
      entryId: 'a' as never,
      values: {
        issuer: 'Draft',
        name: 'Account',
        url: '',
        inputSelector: '',
        matchers: [],
      },
    })
    await settled()

    expect([...store.keys()].sort()).toEqual([
      'session:draft:createMode',
      'session:draft:entryEdit',
      'session:draft:pair',
      'session:draft:popupTab',
      'session:draft:settingsEditingServer',
      'session:draft:syncServer',
    ])
  })

  it('drops one draft when it is cleared', async () => {
    pairDraft.write({ connectionString: 'code', deviceName: '' })
    await settled()
    await pairDraft.clear()

    expect(await pairDraft.read()).toBeNull()
  })

  // Leaving the form ends the life of what was typed into it.
  it('forgets the server form and that it was open, together', async () => {
    syncServerDraft.write({ url: 'ws://localhost:8080', secret: 'hunter2' })
    settingsEditingServerDraft.write(true)
    popupTabDraft.write('settings')
    await settled()

    await closeSyncServerEditor()

    expect(await syncServerDraft.read()).toBeNull()
    expect(await settingsEditingServerDraft.read()).toBeNull()
    // Which tab was open is a different question, and survives.
    expect(await popupTabDraft.read()).toBe('settings')
  })

  it('drops everything on clearDrafts', async () => {
    syncServerDraft.write({ url: 'ws://localhost:8080', secret: 'hunter2' })
    pairDraft.write({ connectionString: 'code', deviceName: 'Work laptop' })
    popupTabDraft.write('settings')
    settingsEditingServerDraft.write(true)
    createModeDraft.write('create')
    entryEditDraft.write({
      entryId: 'a' as never,
      values: {
        issuer: 'Draft',
        name: 'Account',
        url: '',
        inputSelector: '',
        matchers: [],
      },
    })
    await settled()

    await clearDrafts()

    expect(store.size).toBe(0)
  })

  // A browser without `storage.session` should lose the draft, not the screen
  // it was typed on.
  it('degrades to no draft when the store cannot be reached', async () => {
    broken = true

    expect(() => {
      syncServerDraft.write({ url: 'ws://localhost:8080', secret: 'hunter2' })
    }).not.toThrow()
    await settled()
    await expect(syncServerDraft.read()).resolves.toBeNull()
    await expect(clearDrafts()).resolves.toBeUndefined()
  })
})
