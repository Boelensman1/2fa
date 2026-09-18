import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import Logger from '@/lib/classes/Logger'
import { bgActions } from '@/lib/state'
import { MENU_MESSAGE_SOURCE } from '@/lib/types/Autofill'
import type { MenuControlMessage, RememberOfferView } from '@/lib/types'
import RememberSite from '@/lib/ui/components/RememberSite'

const log = new Logger('remember')

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

/**
 * The "remember this site?" prompt, as an extension page framed into the page.
 *
 * Like the autofill menu, it is handed a token in the url hash and nothing
 * else. The token names an offer the background made for one tab; this document
 * never learns which entry it is about, only what to call it, and answers with
 * a boolean. Everything a yes writes is rebuilt in the background from the
 * offer the token resolves to -- see `ANSWER_REMEMBER_OFFER`.
 *
 * It must never take focus. The user is on their way to pressing Enter on the
 * page, and standing between them and that key is the whole problem this
 * feature was moved out of the popup to avoid. So there is no autofocus here,
 * and Escape is handled by the content script rather than in this document.
 */
const Remember: FC = () => {
  const parameters = new URLSearchParams(window.location.hash.slice(1))
  const token = parameters.get('token')

  const [offer, setOffer] = useState<RememberOfferView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (token === null) return
    const load = async () => {
      const view = await bgActions.getRememberOffer(token)
      // Null means the token is unknown, expired, or from another tab. There
      // is nothing to show and nothing to say about it; ask to be taken down.
      if (!view) {
        postToHost({ source: MENU_MESSAGE_SOURCE, action: 'close' })
        return
      }
      setOffer(view)
    }
    void load()
  }, [token])

  /**
   * Reports the panel's real height to the content script.
   *
   * The host cannot compute it: the entry label wraps, the embedded-frame
   * sentence is conditional and the browser's minimum font size moves
   * everything. An iframe sized from a guess either clips the buttons or leaves
   * a transparent strip that swallows clicks meant for the page underneath.
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

  /**
   * Answers, then asks to be taken down.
   *
   * Both answers are sent. A no retires the offer in the background, which is
   * what stops the prompt coming back on the next page this tab loads --
   * silence would leave it pending until it expired.
   */
  const answer = useCallback(
    async (remember: boolean) => {
      if (token === null || busy) return
      setBusy(true)
      setError(null)
      try {
        const result = await bgActions.answerRememberOffer(token, remember)
        if (remember && result?.ok !== true) {
          setError(result?.error ?? 'Could not save that.')
          setBusy(false)
          return
        }
        postToHost({ source: MENU_MESSAGE_SOURCE, action: 'close' })
      } catch (caught) {
        log.error(caught instanceof Error ? caught : new Error(String(caught)))
        setError('Could not save that.')
        setBusy(false)
      }
    },
    [busy, token],
  )

  const onRemember = useCallback(() => void answer(true), [answer])
  const onDismiss = useCallback(() => void answer(false), [answer])

  // Nothing at all until the offer lands: the host has already sized itself
  // from an estimate, and a flash of an empty panel on someone else's page is
  // worse than a frame of nothing.
  if (!offer) return <div ref={panel} />

  return (
    <div ref={panel}>
      <RememberSite
        offer={offer}
        busy={busy}
        error={error}
        onRemember={onRemember}
        onDismiss={onDismiss}
      />
    </div>
  )
}

export default Remember
