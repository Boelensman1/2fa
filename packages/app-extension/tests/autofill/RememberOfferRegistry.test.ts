import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EntryId } from 'favalib'

/**
 * The pending "remember this site?" questions.
 *
 * Two things here are load-bearing and neither is visible from the ui. The
 * token is the whole authorisation for an action that **writes to the vault**
 * and is reachable from a tab, so a token that resolved across tabs would be a
 * hostile frame's way in. And the offer is persisted rather than held in
 * memory, because it has to outlive both a page navigation and an mv3 worker
 * eviction -- which is the one thing that separates this registry from
 * `AutofillOfferRegistry`, and the thing a refactor would most plausibly undo.
 */
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn(), getURL: (p: string) => p } },
}))

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

const { default: RememberOfferRegistry, clearRememberOffers } =
  await import('../../lib/ioc/entities/RememberOfferRegistry')

const offer = (over: { tabId?: number; entryId?: string } = {}) => ({
  tabId: over.tabId ?? 7,
  entryId: (over.entryId ?? 'a') as EntryId,
  entryLabel: 'GitHub',
  pageHost: 'elsewhere.example',
  offer: {
    pageUrl: 'https://elsewhere.example/login',
    matcher: { type: 'BaseDomain' as const, value: 'elsewhere.example' },
    siteUrl: 'https://elsewhere.example/login',
  },
  inSubframe: false,
  shownOnUrl: 'https://elsewhere.example/login',
})

let registry: InstanceType<typeof RememberOfferRegistry>

beforeEach(() => {
  store.clear()
  registry = new RememberOfferRegistry()
})

describe('RememberOfferRegistry', () => {
  it('resolves the token it minted', async () => {
    const stored = await registry.open(offer())

    expect(await registry.resolve(stored.token, 7)).toMatchObject({
      entryId: 'a',
      entryLabel: 'GitHub',
    })
  })

  it('mints a different token every time', async () => {
    const first = await registry.open(offer())
    const second = await registry.open(offer({ tabId: 8 }))

    expect(first.token).not.toBe(second.token)
  })

  /**
   * The rule the whole thing rests on. `remember.html` is web-accessible, so a
   * hostile site can frame it in any tab and ask -- and that frame *is* an
   * extension context, so being one proves nothing. Only the token separates
   * it from ours, and only the tab check stops a leaked one being spent from
   * somewhere else.
   */
  it('refuses a token from another tab', async () => {
    const stored = await registry.open(offer())

    expect(await registry.resolve(stored.token, 8)).toBeNull()
  })

  it('refuses a token it never minted', async () => {
    await registry.open(offer())

    expect(await registry.resolve('guessed', 7)).toBeNull()
  })

  /** An unanswered offer is a no, and it stops being answerable on its own. */
  it('refuses an offer that has run out', async () => {
    const stored = await registry.open(offer(), 1_000)

    expect(
      await registry.resolve(stored.token, 7, 1_000 + 59_000),
    ).toMatchObject({ entryId: 'a' })
    expect(await registry.resolve(stored.token, 7, 1_000 + 61_000)).toBeNull()
  })

  it('hides an expired offer from the re-show check too', async () => {
    await registry.open(offer(), 1_000)

    expect(await registry.forTab(7, 1_000 + 61_000)).toBeNull()
  })

  /**
   * One per tab: a second fill in the same tab means the first question is
   * stale, and two prompts fighting over one corner of one page is not a state
   * worth having.
   */
  it('replaces the offer a tab already had', async () => {
    const first = await registry.open(offer())
    const second = await registry.open(offer({ entryId: 'b' }))

    expect(await registry.resolve(first.token, 7)).toBeNull()
    expect(await registry.resolve(second.token, 7)).toMatchObject({
      entryId: 'b',
    })
  })

  it('keeps tabs apart', async () => {
    const mine = await registry.open(offer())
    const theirs = await registry.open(offer({ tabId: 8, entryId: 'b' }))

    expect(await registry.resolve(mine.token, 7)).toMatchObject({
      entryId: 'a',
    })
    expect(await registry.resolve(theirs.token, 8)).toMatchObject({
      entryId: 'b',
    })
  })

  it('forgets one tab without touching the others', async () => {
    const mine = await registry.open(offer())
    const theirs = await registry.open(offer({ tabId: 8 }))

    await registry.forgetTab(7)

    expect(await registry.resolve(mine.token, 7)).toBeNull()
    expect(await registry.resolve(theirs.token, 8)).not.toBeNull()
  })

  it('closes only on the matching token', async () => {
    const stored = await registry.open(offer())

    await registry.close('someone elses token', 7)
    expect(await registry.resolve(stored.token, 7)).not.toBeNull()

    await registry.close(stored.token, 7)
    expect(await registry.resolve(stored.token, 7)).toBeNull()
  })

  it('records the document the prompt was last drawn on', async () => {
    await registry.open(offer())

    await registry.markShownOn(7, 'https://elsewhere.example/home')

    expect(await registry.forTab(7)).toMatchObject({
      shownOnUrl: 'https://elsewhere.example/home',
    })
  })

  /** A lock is the user saying stop holding my things, and this holds two. */
  it('drops everything on clearRememberOffers', async () => {
    const mine = await registry.open(offer())
    const theirs = await registry.open(offer({ tabId: 8 }))

    await clearRememberOffers()

    expect(await registry.resolve(mine.token, 7)).toBeNull()
    expect(await registry.resolve(theirs.token, 8)).toBeNull()
  })

  /**
   * The difference from `AutofillOfferRegistry`, pinned. mv3 evicts the worker
   * after ~30s idle and this offer lives for a minute, so an offer held in a
   * field would routinely be gone before it could be answered -- and the user
   * would see a prompt that refused its own buttons.
   */
  it('survives the instance it was minted by', async () => {
    const stored = await registry.open(offer())

    const afterEviction = new RememberOfferRegistry()

    expect(await afterEviction.resolve(stored.token, 7)).toMatchObject({
      entryId: 'a',
    })
  })

  /** Memory-backed session storage, never `local:`. It holds a page url. */
  it('writes to the session area and nowhere else', async () => {
    await registry.open(offer())

    expect([...store.keys()]).toEqual(['session:rememberOffers'])
  })
})
