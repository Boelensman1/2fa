import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EntryMeta, EntryMetaForUrl } from 'favalib'

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}))

/** A stand-in for wxt's storage, keyed exactly as `Db` keys it. */
const store = new Map<string, string>()

vi.mock('wxt/utils/storage', () => ({
  storage: {
    setItem: (key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve()
    },
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    removeItem: (key: string) => {
      store.delete(key)
      return Promise.resolve()
    },
    clear: () => {
      store.clear()
      return Promise.resolve()
    },
  },
}))

/**
 * favalib is mocked wholesale.
 *
 * The real thing would need argon2 and a 4096-bit rsa keygen per test, and
 * what is under test here is the status machine and the list selection, not
 * favalib's crypto -- which has its own suite in ../lib.
 */
const createNewFavaLibVault = vi.fn()
const loadFavaLibFromLockedRepesentation = vi.fn()
const getPasswordStrength = vi.fn()

vi.mock('../../lib/vault/creationUtils', () => ({
  default: {
    createNewFavaLibVault: (...args: unknown[]) =>
      createNewFavaLibVault(...args) as unknown,
    loadFavaLibFromLockedRepesentation: (...args: unknown[]) =>
      loadFavaLibFromLockedRepesentation(...args) as unknown,
    getPasswordStrength: (...args: unknown[]) =>
      getPasswordStrength(...args) as unknown,
  },
}))

const { default: VaultContainer } =
  await import('../../lib/ioc/entities/VaultContainer')
const { default: Db } = await import('../../lib/ioc/entities/Db')

type EntryOverrides = Partial<Omit<EntryMeta, 'id'>> & { id?: string }

const entry = (overrides: EntryOverrides = {}): EntryMeta =>
  ({
    id: 'entry-1',
    name: 'me@example.com',
    issuer: 'GitHub',
    type: 'TOTP',
    matchers: [],
    url: null,
    inputSelector: null,
    addedAt: 0,
    updatedAt: null,
    ...overrides,
  }) as EntryMeta

interface FakeFavaLib {
  listed: EntryMeta[]
  searched: EntryMeta[]
  forUrl: EntryMetaForUrl[]
  saveFunction?: (_blob: string) => Promise<void> | void
  listeners: Record<string, (() => void)[]>
  emit: (_event: string) => void
  closed: boolean
  respondToAddDeviceFlow: ReturnType<typeof vi.fn>
}

const makeFavaLib = (overrides: Partial<FakeFavaLib> = {}) => {
  const fake = {
    listed: [] as EntryMeta[],
    searched: [] as EntryMeta[],
    forUrl: [] as EntryMetaForUrl[],
    listeners: {} as Record<string, (() => void)[]>,
    closed: false,
    respondToAddDeviceFlow: vi.fn(() => Promise.resolve()),
    ...overrides,
  }

  const favaLib = {
    ready: Promise.resolve(),
    meta: { deviceId: 'device-1', deviceFriendlyName: 'Test device' },
    storage: {
      setSaveFunction: (fn: (_blob: string) => Promise<void> | void) => {
        fake.saveFunction = fn
      },
      forceSave: () => fake.saveFunction?.('locked-representation'),
    },
    addEventListener: (event: string, cb: () => void) => {
      ;(fake.listeners[event] ??= []).push(cb)
    },
    setDeviceFriendlyName: vi.fn(() => Promise.resolve()),
    sync: {
      webSocketConnected: true,
      closeServerConnection: () => {
        fake.closed = true
      },
      respondToAddDeviceFlow: fake.respondToAddDeviceFlow,
    },
    vault: {
      get size() {
        return fake.listed.length
      },
      listEntriesMetas: () => fake.listed,
      searchEntriesMetas: () => fake.searched,
      findEntryMetasForUrl: () => fake.forUrl,
      generateTokenForEntry: () =>
        Promise.resolve({ otp: '123456', validFrom: 0, validTill: 30000 }),
    },
  }

  const emit = (event: string) =>
    fake.listeners[event]?.forEach((listener) => listener())

  return { favaLib, emit }
}

const build = () => new VaultContainer(new Db())

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('status', () => {
  it('is no-vault when nothing has been stored', async () => {
    await expect(build().getStatus()).resolves.toBe('no-vault')
  })

  it('is locked when a blob exists but nothing is in memory', async () => {
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')

    await expect(new VaultContainer(db).getStatus()).resolves.toBe('locked')
  })

  it('is unlocked after creating a vault in create mode', async () => {
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()

    await container.createVault('pw' as never, 'create')

    await expect(container.getStatus()).resolves.toBe('unlocked')
  })

  it('is pairing after creating a vault in connect mode', async () => {
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()

    await container.createVault('pw' as never, 'connect')

    await expect(container.getStatus()).resolves.toBe('pairing')
  })

  it('leaves connect mode unsaved until pairing delivers a vault', async () => {
    // A vault written before pairing completes would unlock to nothing if the
    // user walked away, and would then read as `locked` rather than `no-vault`.
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })

    await build().createVault('pw' as never, 'connect')

    expect(store.has('local:meta:lockedRepresentation')).toBe(false)
  })

  it('saves immediately in create mode', async () => {
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })

    await build().createVault('pw' as never, 'create')

    expect(store.get('local:meta:lockedRepresentation')).toBe(
      'locked-representation',
    )
  })

  it('leaves pairing once favalib says the vault arrived', async () => {
    const { favaLib, emit } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()
    await container.createVault('pw' as never, 'connect')

    emit('connectToExistingVaultFinished')

    await expect(container.getStatus()).resolves.toBe('unlocked')
  })
})

describe('unlock and lock', () => {
  it('unlocks a stored vault', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)

    await container.unlock('pw' as never)

    await expect(container.getStatus()).resolves.toBe('unlocked')
  })

  it('refuses to unlock when there is no vault', async () => {
    await expect(build().unlock('pw' as never)).rejects.toThrow(
      /no vault to unlock/i,
    )
  })

  it('goes back to locked, keeping the blob', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)

    await container.lock()

    await expect(container.getStatus()).resolves.toBe('locked')
    expect(store.has('local:meta:lockedRepresentation')).toBe(true)
  })

  it('drops the session password on lock', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)
    expect(store.has('session:vaultPassword')).toBe(true)

    await container.lock()

    expect(store.has('session:vaultPassword')).toBe(false)
  })

  it('reset forgets the vault but keeps the config', async () => {
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    await db.upsertMetaKV('config', '{"debug":true}')

    await new VaultContainer(db).reset()

    expect(store.has('local:meta:lockedRepresentation')).toBe(false)
    // db.reset() is storage.clear('local') and would take this with it.
    expect(store.get('local:meta:config')).toBe('{"debug":true}')
  })
})

describe('restoreSession', () => {
  it('re-unlocks from the session password after a worker restart', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    await db.setSessionValue('vaultPassword', 'pw')

    // A fresh container is exactly what a restarted service worker builds.
    const restarted = new VaultContainer(db)
    await restarted.restoreSession()

    await expect(restarted.getStatus()).resolves.toBe('unlocked')
  })

  it('stays locked when there is no session password', async () => {
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)

    await container.restoreSession()

    await expect(container.getStatus()).resolves.toBe('locked')
    expect(loadFavaLibFromLockedRepesentation).not.toHaveBeenCalled()
  })

  it('locks rather than throwing when the stored password no longer works', async () => {
    loadFavaLibFromLockedRepesentation.mockRejectedValue(
      new Error('Invalid password'),
    )
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    await db.setSessionValue('vaultPassword', 'stale')
    const container = new VaultContainer(db)

    await expect(container.restoreSession()).resolves.toBeUndefined()

    await expect(container.getStatus()).resolves.toBe('locked')
    expect(store.has('session:vaultPassword')).toBe(false)
  })
})

describe('listEntries', () => {
  const unlocked = async (overrides: Partial<FakeFavaLib>) => {
    const { favaLib } = makeFavaLib(overrides)
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)
    return container
  }

  it('returns nothing while locked', () => {
    expect(build().listEntries('', null)).toEqual({ forSite: [], all: [] })
  })

  it('lists everything when the query is empty', async () => {
    const container = await unlocked({ listed: [entry(), entry({ id: 'b' })] })

    expect(container.listEntries('', null).all).toHaveLength(2)
  })

  it('delegates a non-empty query to favalib rather than filtering here', async () => {
    const container = await unlocked({
      listed: [entry(), entry({ id: 'b' })],
      searched: [entry({ id: 'b' })],
    })

    const { all } = container.listEntries('git', null)

    expect(all.map((listed) => listed.id)).toEqual(['b'])
  })

  it('groups the active tab url separately', async () => {
    const matcher = { type: 'BaseDomain' as const, value: 'github.com' }
    const container = await unlocked({
      listed: [entry()],
      forUrl: [{ ...entry(), matchedBy: matcher }] as EntryMetaForUrl[],
    })

    const { forSite } = container.listEntries('', 'https://github.com/login')

    expect(forSite.map((listed) => listed.matchedBy)).toEqual([matcher])
  })

  it('drops the site group while searching', async () => {
    // A query is a deliberate narrowing; a second list beside it that ignores
    // the query contradicts it.
    const container = await unlocked({
      listed: [entry()],
      searched: [entry()],
      forUrl: [
        { ...entry(), matchedBy: { type: 'Host', value: 'github.com' } },
      ] as EntryMetaForUrl[],
    })

    expect(
      container.listEntries('git', 'https://github.com/login').forSite,
    ).toEqual([])
  })

  it('never exposes a secret to the popup', async () => {
    // EntryMeta carries no payload, but the mapper is what guarantees that
    // nothing added to it later leaks by accident.
    const container = await unlocked({
      listed: [
        {
          ...entry(),
          payload: { secret: 'TOPSECRET' },
        } as unknown as EntryMeta,
      ],
    })

    const [listed] = container.listEntries('', null).all

    expect(JSON.stringify(listed)).not.toContain('TOPSECRET')
    expect(listed).not.toHaveProperty('payload')
  })
})

describe('summary', () => {
  it('reports zero entries while pairing, not the placeholder vault', async () => {
    const { favaLib } = makeFavaLib({ listed: [entry()] })
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()
    await container.createVault('pw' as never, 'connect')

    const summary = await container.getSummary()

    expect(summary.status).toBe('pairing')
    expect(summary.entryCount).toBe(0)
  })

  it('is empty and disconnected when there is no vault', async () => {
    const summary = await build().getSummary()

    expect(summary).toEqual({
      status: 'no-vault',
      deviceId: null,
      deviceFriendlyName: null,
      syncConnected: false,
      entryCount: 0,
    })
  })
})
