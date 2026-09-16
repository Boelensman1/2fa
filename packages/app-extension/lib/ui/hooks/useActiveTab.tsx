import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'

export interface ActiveTab {
  /** Undefined only if the browser somehow had no active tab to name. */
  id: number | undefined
  /**
   * The tab's url, or null when there is nothing to match against -- a new
   * tab, the extensions page, a pdf viewer.
   */
  url: string | null
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
 * returned whatever the permissions are; `tab.url` is gated on the `tabs`
 * permission or host access. The fill path therefore uses only the id, and the
 * origin it discloses is the *frame's*, which reaches the background on a
 * `MessageSender` and is the better answer anyway.
 */
const useActiveTab = () => {
  const [tab, setTab] = useState<ActiveTab | undefined>(undefined)

  useEffect(() => {
    const read = async () => {
      const [active] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      const candidate = active?.url ?? ''
      // Always resolves to something, even with no tab to speak of: the entry
      // list waits on `undefined`, and waiting forever renders a spinner where
      // the vault should be.
      setTab({
        id: active?.id,
        url: /^https?:/i.test(candidate) ? candidate : null,
      })
    }
    void read()
  }, [])

  return tab
}

export default useActiveTab
