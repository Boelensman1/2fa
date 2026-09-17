import { useEffect, useState } from 'react'

import { bgActions } from '@/lib/state'
import type { FillTarget } from '@/lib/types'

/**
 * The otp field on the active tab, if it has one worth offering to fill.
 *
 * Polled, not fetched once, for two reasons. The background's registry of
 * detected fields is in memory and an mv3 worker is evicted after about thirty
 * seconds idle, so the first call often finds nothing and is what makes the
 * page rescan -- the answer arrives on a later tick. And a field can appear
 * while the popup is open, on a page that reveals its second-factor step after
 * the password.
 *
 * The background throttles the rescan that this triggers, so polling here is
 * cheap on a page with no field on it, which is most pages.
 */
const useFillTarget = (tabId: number | undefined) => {
  const [target, setTarget] = useState<FillTarget | null>(null)

  useEffect(() => {
    if (tabId === undefined) return

    let cancelled = false

    const updateTarget = async () => {
      const next = await bgActions.getFillTarget(tabId)
      if (!cancelled) setTarget(next)
    }

    void updateTarget()
    const interval = setInterval(() => void updateTarget(), 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [tabId])

  return target
}

export default useFillTarget
