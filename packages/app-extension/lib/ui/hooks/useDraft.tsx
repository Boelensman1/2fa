import { useCallback, useEffect, useRef, useState } from 'react'

import type { Draft } from '@/lib/drafts'

interface DraftControls {
  /**
   * False until the stored draft has been read.
   *
   * A screen with a text field in it renders `<Splash />` while this is false.
   * The read is a memory lookup, so it is a frame at most -- but a field
   * rendered before it lands could take a keystroke that hydration then
   * overwrites, and that is the one bug this whole feature would be.
   */
  ready: boolean
  /** Discards stored and displayed values, returning to the original seed. */
  clear: () => void
}

/**
 * `useState`, kept across the popup being destroyed.
 *
 * Seeded with `initial`, replaced once by whatever was stored, and written
 * through on every change -- see `Draft.write` for why there is no debounce.
 * The write happens in the setter and never in an effect on the value, so
 * hydration cannot write the seed back over a newer draft.
 * @param draft - The draft this state is stored in.
 * @param initial - What to show when nothing was stored.
 * @returns The value, a setter that also stores it, and `{ ready, clear }`.
 */
const useDraft = <T,>(
  draft: Draft<T>,
  initial: T,
): [T, (_next: T) => void, DraftControls] => {
  const [value, setValue] = useState<T>(initial)
  const [ready, setReady] = useState(false)
  const seed = useRef(initial)

  // `initial` is deliberately not a dependency: it seeds the first render and
  // nothing else. `currentUrl` in `SyncServerForm` comes off a polled summary,
  // and re-seeding from it would wipe what is being typed.
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const stored = await draft.read()
      if (cancelled) return
      if (stored !== null) setValue(stored)
      setReady(true)
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [draft])

  const update = useCallback(
    (next: T) => {
      setValue(next)
      draft.write(next)
    },
    [draft],
  )

  const clear = useCallback(() => {
    setValue(seed.current)
    void draft.clear()
  }, [draft])

  return [value, update, { ready, clear }]
}

export default useDraft
