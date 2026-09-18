import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'

import Logger from '@/lib/classes/Logger'

const log = new Logger('popup/useActiveTab')

export interface ActiveTab {
  /** Undefined only if the browser somehow had no active tab to name. */
  id: number | undefined
  /**
   * The tab's url, or null when there is nothing to match against -- a new
   * tab, the extensions page, a pdf viewer, or a url the browser would not
   * disclose. {@link ActiveTab.named} separates the last of those.
   */
  url: string | null
  /**
   * Whether the browser named a url for this tab at all.
   *
   * False is a *permissions* answer, not a page answer, and the two have to
   * stay apart. Both end in `url: null` and so in an empty "For this site"
   * group, but "this is a new tab" is the ordinary case that should show
   * nothing, while "I was not allowed to look" is wrong on every site the user
   * visits. Folded together, the second is invisible -- which is how it came
   * to ship.
   */
  named: boolean
}

/**
 * The tab the popup was opened over.
 *
 * Undefined while it is being looked up and never null: a popup always has a
 * tab under it. The url is the part that can be missing, and it is kept apart
 * from `undefined` so the entry list can hold off on the "for this site" group
 * rather than render it empty and repopulate.
 *
 * `id` and `url` come apart for a second reason worth knowing. `tab.id` is
 * returned whatever the permissions are; `tab.url` is scrubbed off the `Tab`
 * unless the extension holds the `tabs` permission, host access, or
 * `activeTab` -- and a content script's `matches` is none of those, whatever
 * it looks like (`browser.permissions.getAll()` answers `origins: []` with
 * `matches: ['<all_urls>']` declared). This manifest declares `activeTab`,
 * which the click that opens the popup grants; see `wxt.config.ts` for why
 * that one and not the other two.
 *
 * The fill path still uses only the id, and the origin it discloses is the
 * *frame's*, which reaches the background on a `MessageSender` and is the
 * better answer anyway.
 */
const useActiveTab = () => {
  const [tab, setTab] = useState<ActiveTab | undefined>(undefined)

  useEffect(() => {
    const read = async () => {
      const [active] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      const named = typeof active?.url === 'string'
      const candidate = active?.url ?? ''

      // Worth a line of its own: from the popup's side an entry list with no
      // site group looks the same whether the vault had nothing for this site
      // or the browser refused to say what the site was.
      if (active && !named) {
        log.warn(
          'The browser named no url for the active tab; entries cannot be grouped by site.',
        )
      }

      // Always resolves to something, even with no tab to speak of: the entry
      // list waits on `undefined`, and waiting forever renders a spinner where
      // the vault should be.
      setTab({
        id: active?.id,
        url: /^https?:/i.test(candidate) ? candidate : null,
        named,
      })
    }
    void read()
  }, [])

  return tab
}

export default useActiveTab
