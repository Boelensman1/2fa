import { useEffect, useState } from 'react'

import { bgActions } from '@/lib/state'
import type { EntryList } from '@/lib/types'

const EMPTY: EntryList = { forSite: [], all: [] }

/**
 * The entry list for a query and a tab url.
 *
 * Searching is delegated to favalib rather than filtered here, so the
 * extension and the pwa agree on what "matches" means -- a case-insensitive
 * substring of issuer or name.
 *
 * Waits for `url` to be resolved (not `undefined`) before asking, so the site
 * group does not render empty and then repopulate.
 */
const useEntries = (query: string, url: string | null | undefined) => {
  const [entries, setEntries] = useState<EntryList>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (url === undefined) return

    // Answers can arrive out of order when the query changes faster than the
    // background replies; the last effect to run is the only one allowed to
    // write.
    let cancelled = false

    const updateEntries = async () => {
      const next = await bgActions.listEntries(query, url)
      if (cancelled) return
      setEntries(next ?? EMPTY)
      setLoading(false)
    }

    void updateEntries()
    return () => {
      cancelled = true
    }
  }, [query, url])

  return { entries, loading }
}

export default useEntries
