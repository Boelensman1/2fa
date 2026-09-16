import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'

/**
 * The url of the tab the popup was opened over, for the "for this site" group.
 *
 * Undefined while it is being looked up and null when there is nothing to
 * match against -- a new tab, the extensions page, a pdf viewer. The two are
 * kept apart so the list can avoid rendering an empty site group before the
 * answer is in.
 */
const useActiveTabUrl = () => {
  const [url, setUrl] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const read = async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      const candidate = tab?.url ?? ''
      setUrl(/^https?:/i.test(candidate) ? candidate : null)
    }
    void read()
  }, [])

  return url
}

export default useActiveTabUrl
