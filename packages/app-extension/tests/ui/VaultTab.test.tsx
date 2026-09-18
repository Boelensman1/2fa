import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The popup's entry list, and specifically the "For this site" group.
 *
 * Rendered rather than unit-tested because everything that decides whether the
 * group appears is wiring: which url is asked about, when it is asked, and what
 * the section is gated on. A user reported the inline menu offering an entry
 * that this list then left out of the group entirely, and all three are
 * candidates for that.
 *
 * Matching itself is not under test -- it happens in favalib, behind the
 * background -- so `listEntries` is a spy that answers whatever the case needs.
 * What is under test is the question the popup asks it.
 */
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() }, tabs: { query: vi.fn() } },
}))

vi.mock('wxt/utils/storage', () => ({
  storage: {
    setItem: () => Promise.resolve(),
    getItem: () => Promise.resolve(null),
    removeItem: () => Promise.resolve(),
  },
}))

const listEntries = vi.fn<() => Promise<unknown>>()

vi.mock('@/lib/state', () => ({
  bgActions: { listEntries: () => listEntries() },
  initialState: {},
  defaultConfig: {},
}))

const { default: VaultTab } = await import('../../lib/ui/components/VaultTab')
type ListedEntry = import('../../lib/types').ListedEntry
type FillTarget = import('../../lib/types').FillTarget
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

const flush = (work: () => void) => act(() => Promise.resolve(work()))

const entry: ListedEntry = {
  id: 'a' as ListedEntry['id'],
  issuer: 'GitHub',
  name: 'frank@appeal.nl',
  url: null,
  matchers: [{ type: 'BaseDomain', value: 'github.com' }],
  matchedBy: { type: 'BaseDomain', value: 'github.com' },
}

/** A field was found on the page, so the rows may offer to fill it. */
const aFieldOnThePage: FillTarget = {
  tabId: 7,
  frameId: 0,
  fieldId: 'otp-1',
  url: 'https://github.com/login',
  host: 'github.com',
  confidence: 'likely',
  inSubframe: false,
}

const open = async (
  url: string | null | undefined,
  fillTarget: FillTarget | null = null,
  urlNamed: boolean | undefined = url !== null,
) => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await flush(() =>
    root.render(
      <VaultTab
        url={url}
        urlNamed={urlNamed}
        fillTarget={fillTarget}
        onCopy={vi.fn()}
        onOpen={vi.fn()}
        onFill={vi.fn()}
        onLock={vi.fn()}
      />,
    ),
  )
}

/** By visible text, the way the user finds it. */
const button = (label: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )

/**
 * The row itself, which is one big button that copies.
 *
 * Not found by its text: it carries the avatar, the issuer and the account
 * name as well as the word Copy, so the title is the stable handle.
 */
const copyRow = (): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(
    'button[title="Copy verification code"]',
  )

/**
 * Types into the search box the way a user does.
 *
 * Through the prototype's `value` setter, for the reason `lib/content/
 * fillField.ts` gives at length: React installs its own accessor on the node
 * to track changes, and assigning through it leaves the tracker believing
 * nothing happened, so the next render puts the old value back.
 */
const type = (value: string) => {
  const search = container.querySelector('input')
  if (!search) throw new Error('no search box')
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(search, value)
  search.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  listEntries.mockReset()
  listEntries.mockResolvedValue({ forSite: [], all: [] })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('the vault list', () => {
  it('asks about the url it was given', async () => {
    await open('https://github.com/login')

    expect(listEntries).toHaveBeenCalledTimes(1)
  })

  /**
   * `useEntries` holds off while the url is `undefined`, so the group renders
   * once rather than rendering empty and repopulating under a cursor already
   * aimed at a row.
   */
  it('asks nothing while the url is still being looked up', async () => {
    await open(undefined)

    expect(listEntries).not.toHaveBeenCalled()
  })

  it('shows the group when the background found entries for the site', async () => {
    listEntries.mockResolvedValue({ forSite: [entry], all: [entry] })

    await open('https://github.com/login')

    expect(container.textContent).toContain('For this site')
  })

  /**
   * The group is about what the vault knows, not about what the page offers.
   * A user whose otp field the heuristic missed still needs to find the entry
   * and copy a code by hand, so the section is gated on the match alone --
   * never on there being something to fill.
   */
  it('shows the group when there is nothing on the page to fill', async () => {
    listEntries.mockResolvedValue({ forSite: [entry], all: [entry] })

    await open('https://github.com/login', null)

    expect(container.textContent).toContain('For this site')
    expect(copyRow()?.disabled).toBe(false)
    expect(button('Fill')?.disabled).toBe(true)
  })

  /** And the same rows gain a Fill once a field has been found. */
  it('offers to fill once the page has a field', async () => {
    listEntries.mockResolvedValue({ forSite: [entry], all: [entry] })

    await open('https://github.com/login', aFieldOnThePage)

    expect(button('Fill')?.disabled).toBe(false)
    expect(container.textContent).toContain('github.com')
  })

  /**
   * An ordinary page with nothing to match against -- a new tab, a pdf. The
   * section is absent and that is the whole story, so nothing is said about
   * it.
   */
  it('shows no group at all when there is no url to match', async () => {
    listEntries.mockResolvedValue({ forSite: [], all: [entry] })

    await open(null, null, true)

    expect(container.textContent).not.toContain('For this site')
    expect(container.textContent).not.toContain('cannot see which site')
    expect(container.textContent).toContain('GitHub')
  })

  /**
   * The bug this file was opened for. The browser withheld `Tab.url`, so the
   * group is empty for a reason that has nothing to do with the vault -- and
   * an absent section is indistinguishable from "you have no entry for this
   * site". Saying so is the difference between a silent defect and a reported
   * one.
   */
  it('says so when the browser would not name the site', async () => {
    listEntries.mockResolvedValue({ forSite: [], all: [entry] })

    await open(null, null, false)

    expect(container.textContent).toContain('cannot see which site')
  })

  /**
   * Not while searching, though: the group is suppressed on purpose there, so
   * its absence carries no information and the line would be noise.
   */
  it('stays quiet about the site while searching', async () => {
    listEntries.mockResolvedValue({ forSite: [], all: [entry] })
    await open(null, null, false)

    await flush(() => type('git'))

    expect(container.textContent).not.toContain('cannot see which site')
  })
})
