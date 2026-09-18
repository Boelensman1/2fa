import type { FC } from 'react'

import type { RememberOfferView } from '@/lib/types'
import Button from '../Button'

interface RememberSiteProps {
  offer: RememberOfferView
  busy: boolean
  /** Shown in place of nothing when the write failed. Inside the panel, so it
      lands on the panel's own background rather than on the page's. */
  error: string | null
  onRemember: () => void
  onDismiss: () => void
}

/**
 * The offer that follows a fill the entry did not claim the page for.
 *
 * The popup offers every entry for any site, so the entry that was just filled
 * very often has no matcher covering the page -- and a fill the user performed
 * themselves is the best evidence there is that it belongs there. Asking once,
 * straight afterwards, is the cheapest moment to collect that: the alternative
 * is the user editing matchers by hand in the pwa or the cli, which is why
 * entries go years without them.
 *
 * It is rendered **on the page**, in `entrypoints/remember`, and not in the
 * popup where it started. A browser action popup is destroyed the moment it
 * loses focus, and clicking the page to press Enter is the next thing anyone
 * does after a fill -- so the popup put this question at the one moment it was
 * certain to be dismissed unanswered.
 *
 * A suggestion, not a warning, and it is shaped that way: nothing here can leak
 * a code -- the matcher only decides where the entry is *offered* later -- so
 * "Remember" is the primary and "Not now" sits under it. `FillConfirm`, which
 * is a warning, puts the safe answer first instead.
 *
 * The one thing it must not imply is that saying yes settles the embedded-frame
 * question: the matcher is for the page's host, so a fill into a third-party
 * frame will be asked about again. That is said out loud rather than left to be
 * discovered.
 *
 * **Nothing here says "this site".** The prompt follows the tab across the
 * redirect a login performs, so it is routinely drawn on a page other than the
 * one it is asking about -- an idp handing off to the app, an `accounts.` host
 * redirecting to a bare one. Every line therefore names `pageHost` instead of
 * pointing at whatever happens to be underneath it.
 */
const RememberSite: FC<RememberSiteProps> = ({
  offer,
  busy,
  error,
  onRemember,
  onDismiss,
}) => (
  <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
    <header className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
      <h1 className="flex-1 truncate text-sm font-semibold text-gray-900">
        Remember {offer.pageHost}?
      </h1>
      {/* The same answer as "Not now", in the place a panel on someone else's
          page is expected to put it. */}
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        aria-label="Not now"
        className="-mr-1 rounded px-1.5 text-lg leading-none text-gray-400 hover:text-gray-600 disabled:text-gray-300"
      >
        ×
      </button>
    </header>

    <div className="space-y-2 px-3 py-3">
      <p className="text-sm text-gray-700">
        <span className="font-medium">{offer.entryLabel}</span> was just filled
        on <span className="font-medium break-all">{offer.pageHost}</span>,
        which it does not list yet — so it never appears under “For this site”
        there, and the field never offers it.
      </p>
      <p className="rounded-md bg-gray-50 p-2 font-mono text-xs break-all text-gray-900">
        {offer.matcher.type} {offer.matcher.value}
      </p>
      {offer.siteUrl === null ? null : (
        <p className="text-sm text-gray-700">
          Its site will be set to{' '}
          <span className="font-mono text-xs break-all">{offer.siteUrl}</span>,
          which is shown on the entry and never matched against.
        </p>
      )}
      {offer.inSubframe ? (
        <p className="text-sm text-gray-700">
          The code went into an embedded frame on that page, and this remembers
          the page — not that frame. You will still be asked before a code goes
          into it again.
        </p>
      ) : null}
    </div>

    <div className="space-y-2 border-t border-gray-200 p-3">
      {error === null ? null : <p className="text-xs text-red-600">{error}</p>}
      <Button onClick={onRemember} disabled={busy}>
        Remember
      </Button>
      <Button variant="secondary" onClick={onDismiss} disabled={busy}>
        Not now
      </Button>
    </div>
  </div>
)

export default RememberSite
