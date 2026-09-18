import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * What the popup is told about the tab it was opened over.
 *
 * This hook is the whole input to the "For this site" group: `listEntries`
 * matches on the url it produces, and `VaultTab` renders the section only when
 * that match returned something. So every way the group can silently fail to
 * appear passes through here first.
 *
 * `tab.url` is not free. The browser omits it unless the extension holds the
 * `tabs` permission, host access, or `activeTab` -- and this manifest declares
 * `permissions: ['storage']` and nothing else. These cases pin what the hook
 * does with an omitted url, because the answer is the bug: it is folded into
 * the same `null` that means "an ordinary page with no url worth matching",
 * and from there nothing downstream can tell the two apart.
 */
const query = vi.fn<() => Promise<unknown[]>>()

vi.mock('wxt/browser', () => ({
  browser: {
    // The hook warns when the browser names no url, and a popup-side `Logger`
    // forwards every entry to the background.
    runtime: { sendMessage: vi.fn() },
    tabs: { query: () => query() },
  },
}))

const { default: useActiveTab } =
  await import('../../lib/ui/hooks/useActiveTab')
type ActiveTab = import('../../lib/ui/hooks/useActiveTab').ActiveTab
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

/** See the note in `SyncServerForm.test.tsx`: the sync overload returns void. */
const flush = (work: () => void) => act(() => Promise.resolve(work()))

/**
 * The hook's answer, read back out of the dom.
 *
 * Rendered rather than assigned to a captured variable: writing to a binding
 * outside the component during render is a side effect, and the react-hooks
 * lint rules reject it.
 */
const Probe = () => <span>{JSON.stringify(useActiveTab() ?? null)}</span>

const seen = (): ActiveTab | null =>
  JSON.parse(container.textContent ?? 'null') as ActiveTab | null

/** Opens the popup, and waits for the tabs.query round trip to land. */
const open = async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await flush(() => root.render(<Probe />))
}

beforeEach(() => {
  query.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('the active tab, as the popup sees it', () => {
  it('passes an http(s) url through for matching', async () => {
    query.mockResolvedValue([{ id: 7, url: 'https://github.com/login' }])

    await open()

    expect(seen()).toEqual({
      id: 7,
      url: 'https://github.com/login',
      named: true,
    })
  })

  /**
   * The shape a browser hands back when the extension may not read the url:
   * a `Tab` with an `id` and no `url` at all. `id` is never withheld, which is
   * why the fill path can keep working while the site group cannot.
   */
  it('reports no url when the browser withheld it', async () => {
    query.mockResolvedValue([{ id: 7 }])

    await open()

    expect(seen()).toEqual({ id: 7, url: null, named: false })
  })

  it('reports no url for a page there is nothing to match against', async () => {
    query.mockResolvedValue([{ id: 7, url: 'about:newtab' }])

    await open()

    expect(seen()).toEqual({ id: 7, url: null, named: true })
  })

  /**
   * The regression this hook exists to prevent.
   *
   * The two cases above both end in `url: null` and so in an empty site group,
   * but they are not the same thing. "This is a new tab" is ordinary and
   * should show nothing; "I was not allowed to look" is wrong on every site
   * the user visits. Collapsed into one value -- which is what shipped -- the
   * second cannot be seen from anywhere downstream, and the group simply never
   * appeared. `named` is the whole difference.
   */
  it('tells a withheld url apart from a page that has none', async () => {
    query.mockResolvedValue([{ id: 7 }])
    await open()
    const withheld = seen()
    act(() => root.unmount())
    container.remove()

    query.mockResolvedValue([{ id: 7, url: 'about:newtab' }])
    await open()

    expect(withheld?.url).toBe(seen()?.url)
    expect(withheld?.named).toBe(false)
    expect(seen()?.named).toBe(true)
  })

  /**
   * It must resolve to a value rather than staying `undefined`: `useEntries`
   * holds off while the url is `undefined`, so a hook that never answered
   * would leave a spinner where the vault should be.
   */
  it('answers even when there is no tab to speak of', async () => {
    query.mockResolvedValue([])

    await open()

    expect(seen()).toEqual({ id: undefined, url: null, named: false })
  })
})
