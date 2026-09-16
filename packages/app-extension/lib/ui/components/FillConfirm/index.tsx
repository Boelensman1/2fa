import type { FC } from 'react'

import type { FillTarget, ListedEntry } from '@/lib/types'
import Button from '../Button'

interface FillConfirmProps {
  entry: ListedEntry
  target: FillTarget
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The second look before a code goes into somebody else's frame.
 *
 * The popup offers every entry for any site, deliberately -- the user opened
 * it and picked a row, and that is the authorisation. What it cannot assume is
 * that the field they can see belongs to the page they think they are on: it
 * may be in an embedded frame from another origin, and a code typed there is a
 * code handed to that origin.
 *
 * So the rule is Bitwarden's, for manual autofill: an embedded frame whose url
 * the entry does not claim gets named, and the user says yes or no. The
 * background has generated nothing at this point and will not unless they do.
 *
 * Rendered in place rather than through `window.confirm`, which `SettingsTab`
 * uses for the vault reset. A native dialog over a popup can take the popup
 * down with it, and the url needs more room than one line of chrome gives it.
 */
const FillConfirm: FC<FillConfirmProps> = ({
  entry,
  target,
  onConfirm,
  onCancel,
}) => (
  <div className="flex h-full flex-col">
    <header className="border-b border-gray-200 px-4 py-3">
      <h1 className="text-sm font-semibold text-gray-900">
        Fill into an embedded frame?
      </h1>
    </header>

    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      <p className="text-sm text-gray-700">
        The field is not part of <span className="font-medium">this page</span>{' '}
        — it belongs to a frame embedded in it, and{' '}
        <span className="font-medium">
          {entry.issuer || entry.name || 'this entry'}
        </span>{' '}
        does not list that address.
      </p>
      <p className="rounded-md bg-gray-50 p-2 font-mono text-xs break-all text-gray-900">
        {target.url}
      </p>
      <p className="text-sm text-gray-700">
        The code will be readable by whoever controls that address. Only
        continue if you recognise it.
      </p>
    </div>

    <div className="space-y-2 border-t border-gray-200 p-3">
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="danger" onClick={onConfirm}>
        Fill it anyway
      </Button>
    </div>
  </div>
)

export default FillConfirm
