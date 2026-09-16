import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import Logger from '@/lib/classes/Logger'
import { bgActions } from '@/lib/state'
import { MENU_MESSAGE_SOURCE } from '@/lib/types/Autofill'
import type { FillReason, ListedEntry, MenuControlMessage } from '@/lib/types'
import MenuRow from '@/lib/ui/components/MenuRow'

const log = new Logger('menu')

/**
 * Posts up to the content script that injected us.
 *
 * `'*'` because a cross-origin child cannot read its parent's origin, which is
 * also why nothing secret may travel this way. See `MenuControlMessage`.
 * @param message - The control message.
 */
const postToHost = (message: MenuControlMessage): void => {
  window.parent.postMessage(message, '*')
}

const MESSAGES: Record<FillReason, string> = {
  gone: 'That field is no longer on the page.',
  'empty-code': 'Could not generate a code.',
  partial: 'Filled, but the code and the field are different lengths.',
  'no-offer': 'This menu expired. Click the field again.',
  locked: 'The vault locked. Unlock Fava and try again.',
  'unknown-entry': 'That entry is not available for this page.',
  'no-frame': 'The page changed before the code could be filled.',
}

/**
 * The inline autofill menu.
 *
 * Runs as an extension page inside an iframe the content script owns, which is
 * what keeps every entry name out of the page's realm: this document fetches
 * them from the background itself, and the page cannot read across the origin
 * boundary to see them.
 *
 * It is handed a token in the url hash and nothing else. The token names an
 * offer the background made for one field in one frame of one tab -- the menu
 * never learns which, and could not be trusted with it, being one postMessage
 * away from the page.
 */
const Menu: FC = () => {
  const parameters = new URLSearchParams(window.location.hash.slice(1))
  const token = parameters.get('token')
  const locked = parameters.get('state') === 'locked'

  const [entries, setEntries] = useState<ListedEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (token === null) return
    const load = async () => {
      const listed = await bgActions.getMenuEntries(token)
      setEntries(listed ?? [])
    }
    void load()
  }, [token])

  /**
   * Reports the panel's real height to the content script.
   *
   * The host cannot compute it: wrapped issuers, the error line and the
   * browser's minimum font size all move it, and an iframe sized from a guess
   * either clips the last row or leaves a transparent strip that swallows
   * clicks meant for the page underneath.
   */
  useEffect(() => {
    const element = panel.current
    if (!element) return

    const report = () => {
      postToHost({
        source: MENU_MESSAGE_SOURCE,
        height: Math.ceil(element.getBoundingClientRect().height),
      })
    }

    const observer = new ResizeObserver(report)
    observer.observe(element)
    report()
    return () => observer.disconnect()
  })

  // Focus is inside this document, so Escape lands here and nowhere else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      postToHost({ source: MENU_MESSAGE_SOURCE, action: 'close' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const pick = useCallback(
    async (entry: ListedEntry) => {
      if (token === null || busy) return
      setBusy(true)
      setError(null)
      try {
        // The code is generated in the background and delivered straight to
        // the field's frame. It never passes through this document.
        const result = await bgActions.fillOtpField(token, entry.id)
        if (!result?.filled) {
          setError(MESSAGES[result?.reason ?? 'gone'])
          setBusy(false)
          return
        }
        postToHost({ source: MENU_MESSAGE_SOURCE, action: 'close' })
      } catch (caught) {
        log.error(caught instanceof Error ? caught : new Error(String(caught)))
        setError('Could not fill that field.')
        setBusy(false)
      }
    },
    [busy, token],
  )

  const onPick = useCallback((entry: ListedEntry) => void pick(entry), [pick])

  return (
    <div
      ref={panel}
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
    >
      {locked ? (
        <div className="px-3 py-3">
          <p className="text-sm font-medium text-gray-900">Fava is locked</p>
          {/*
            No password box here, ever. The master password belongs in the
            popup, which is chrome the page cannot draw over or imitate; a
            field on the page is exactly the shape a phishing overlay takes.
          */}
          <p className="mt-1 text-xs text-gray-500">
            Click the Fava icon in the toolbar to unlock it, then click this
            field again.
          </p>
        </div>
      ) : (
        <>
          <h1 className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Fill verification code
          </h1>
          {entries === null ? (
            <p className="px-3 py-3 text-xs text-gray-500">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500">
              Nothing in your vault matches this page.
            </p>
          ) : (
            <ul className="max-h-60 overflow-y-auto">
              {entries.map((entry) => (
                <MenuRow
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  onPick={onPick}
                />
              ))}
            </ul>
          )}
          {error === null ? null : (
            <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-red-600">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default Menu
