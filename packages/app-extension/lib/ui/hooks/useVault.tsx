import { useCallback, useEffect, useState } from 'react'

import { bgActions } from '@/lib/state'
import type { VaultSummary } from '@/lib/types'

/**
 * The popup's window onto the vault, which lives in the background.
 *
 * Polled rather than pushed, matching `useGlobalState` -- and the polling is
 * not purely a shortcut here: a message every second is also what keeps the
 * service worker from being evicted while the popup is open.
 *
 * `summary` is null only before the first answer arrives, which is the
 * difference between "no vault" and "do not know yet". Rendering the create
 * screen during that gap would flash it at a user who has a perfectly good
 * vault.
 */
const useVault = ({ updateInterval }: { updateInterval?: number } = {}) => {
  const [summary, setSummary] = useState<VaultSummary | null>(null)
  // Bumped by `refresh` to restart the effect, which re-reads immediately.
  // Mirrors how `useConfig` drives its reload off a state flag.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const updateSummary = async () => {
      const next = await bgActions.getVaultState()
      // null means the background answered before init finished; keep what we
      // had rather than blanking the screen.
      if (next) setSummary(next)
    }

    void updateSummary()
    const interval = setInterval(
      () => void updateSummary(),
      updateInterval ?? 1000,
    )
    return () => clearInterval(interval)
  }, [updateInterval, reloadToken])

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  return { summary, refresh }
}

export default useVault
