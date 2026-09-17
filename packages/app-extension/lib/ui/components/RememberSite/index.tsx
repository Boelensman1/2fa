import type { FC } from 'react'

import type { ListedEntry, SiteOffer } from '@/lib/types'
import Button from '../Button'

interface RememberSiteProps {
  entry: ListedEntry
  offer: SiteOffer
  /** True when the code went into an embedded frame rather than the page. */
  inSubframe: boolean
  busy: boolean
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
 * It follows `FillConfirm`'s shape, and deliberately not its tone. That one is
 * a warning and puts the safe answer first; this is a suggestion, and nothing
 * here can leak a code -- the matcher only decides where the entry is *offered*
 * later. So "Remember" is the primary and "Not now" sits under it.
 *
 * The one thing it must not imply is that saying yes settles the embedded-frame
 * question: the matcher is for the page's host, so a fill into a third-party
 * frame will be asked about again. That is said out loud rather than left to be
 * discovered.
 */
const RememberSite: FC<RememberSiteProps> = ({
  entry,
  offer,
  inSubframe,
  busy,
  onRemember,
  onDismiss,
}) => (
  <div className="flex h-full flex-col">
    <header className="border-b border-gray-200 px-4 py-3">
      <h1 className="text-sm font-semibold text-gray-900">
        Remember this site?
      </h1>
    </header>

    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      <p className="text-sm text-gray-700">
        <span className="font-medium">
          {entry.issuer || entry.name || 'That entry'}
        </span>{' '}
        is not listed for this site yet, so it does not appear under “For this
        site” and the field on the page never offers it.
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
      {inSubframe ? (
        <p className="text-sm text-gray-700">
          The code went into an embedded frame on this page, and this remembers
          the page — not that frame. You will still be asked before a code goes
          into it again.
        </p>
      ) : null}
    </div>

    <div className="space-y-2 border-t border-gray-200 p-3">
      <Button onClick={onRemember} disabled={busy}>
        Remember this site
      </Button>
      <Button variant="secondary" onClick={onDismiss} disabled={busy}>
        Not now
      </Button>
    </div>
  </div>
)

export default RememberSite
