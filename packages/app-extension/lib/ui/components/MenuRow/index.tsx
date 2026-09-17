import type { FC } from 'react'

import type { ListedEntry } from '@/lib/types'
import { avatarColour, initial } from '../EntryRow/avatar'

interface MenuRowProps {
  entry: ListedEntry
  busy: boolean
  onPick: (_entry: ListedEntry) => void
}

/**
 * One entry in the inline menu.
 *
 * Unlike the popup's `EntryRow` there is a single click target and a single
 * meaning: picking the row fills the field. No chevron, no copy affordance --
 * the menu is attached to a field the user is already typing into, and a row
 * that could do two things is a row that does the wrong one.
 *
 * No code and no countdown, for the same reason the popup renders neither: the
 * code appears in the field the user is looking at, a moment later, and
 * putting it on screen twice only widens the window in which it can be read
 * over a shoulder.
 *
 * The action is on `mousedown`, with the default prevented. That is what stops
 * focus leaving the field at all -- the focus shift into the iframe is
 * `mousedown`'s default action. It is best-effort, and the content script's
 * blur handling is the belt to its braces.
 */
const MenuRow: FC<MenuRowProps> = ({ entry, busy, onPick }) => (
  <li>
    <button
      type="button"
      disabled={busy}
      onMouseDown={(event) => {
        event.preventDefault()
        onPick(entry)
      }}
      onClick={(event) => {
        // Keyboard activation still arrives as a click with no preceding
        // mousedown; a real mouse click has already been handled above.
        if (event.detail !== 0) return
        onPick(entry)
      }}
      className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none disabled:opacity-60"
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColour(
          entry.issuer || entry.name,
        )}`}
        aria-hidden="true"
      >
        {initial(entry)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">
          {entry.issuer || entry.name || 'Untitled'}
        </span>
        {entry.issuer && entry.name ? (
          <span className="block truncate text-xs text-gray-500">
            {entry.name}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs font-medium text-gray-400">Fill</span>
    </button>
  </li>
)

export default MenuRow
