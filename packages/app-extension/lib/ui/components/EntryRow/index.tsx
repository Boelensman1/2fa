import type { FC } from 'react'

import type { ListedEntry } from '@/lib/types'
import { avatarColour, initial } from './avatar'

interface EntryRowProps {
  entry: ListedEntry
  onCopy: (_entry: ListedEntry) => void
  onOpen: (_entry: ListedEntry) => void
  /** Null when the tab has no detected field to fill. */
  onFill: ((_entry: ListedEntry) => void) | null
  /** The host the code would be typed into, for the button's own label. */
  fillHost: string | null
}

/**
 * One vault entry.
 *
 * Renders no code and no countdown, on purpose: a popup that displays live
 * totp codes is shoulder-surfable for as long as it is open, and the code is
 * only ever wanted in the clipboard anyway. Clicking the row generates one on
 * demand and copies it.
 *
 * The chevron is a separate button so "copy" and "inspect" do not fight over
 * the same click target, the way `../app-browser`'s row does with its kebab.
 *
 * Fill is a third button rather than a change to the first: clicking a row has
 * always copied, and a control that silently becomes a different verb when the
 * page happens to have a field on it is the kind of thing that puts a code
 * somewhere the user did not mean. It is rendered even when there is nothing
 * to fill, just invisible, because the fill target is *polled* -- a button that
 * appeared a second after the popup opened would shift every row under a
 * cursor already aimed at Copy.
 *
 * The host is on the button as well as in the banner below the list, so the
 * disclosure travels with the control rather than sitting at the edge of the
 * screen where a screen reader will not tie the two together.
 */
const EntryRow: FC<EntryRowProps> = ({
  entry,
  onCopy,
  onOpen,
  onFill,
  fillHost,
}) => (
  <li className="group flex items-stretch border-b border-gray-100 last:border-b-0">
    <button
      type="button"
      onClick={() => onCopy(entry)}
      title="Copy verification code"
      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColour(
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
      <span className="shrink-0 text-xs font-medium text-gray-400 group-hover:text-blue-600">
        Copy
      </span>
    </button>
    <button
      type="button"
      disabled={onFill === null}
      onClick={() => onFill?.(entry)}
      title={fillHost === null ? undefined : `Fill the code into ${fillHost}`}
      aria-label={
        fillHost === null
          ? undefined
          : `Fill the code for ${entry.issuer || entry.name} into ${fillHost}`
      }
      className={`shrink-0 px-2 text-xs font-medium ${
        onFill === null
          ? 'invisible'
          : 'text-blue-600 hover:bg-blue-50 hover:text-blue-700'
      }`}
    >
      Fill
    </button>
    <button
      type="button"
      onClick={() => onOpen(entry)}
      title="Show details"
      aria-label={`Details for ${entry.issuer || entry.name}`}
      className="px-2 text-gray-300 hover:bg-gray-50 hover:text-gray-600"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M7.05 4.05a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.3 9.75 7.05 5.45a1 1 0 0 1 0-1.4Z" />
      </svg>
    </button>
  </li>
)

export default EntryRow
