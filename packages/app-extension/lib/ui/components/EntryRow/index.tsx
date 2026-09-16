import type { FC } from 'react'

import type { ListedEntry } from '@/lib/types'

/** A stable colour per issuer, so rows stay recognisable between openings. */
const AVATAR_COLOURS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-600',
]

const avatarColour = (seed: string) => {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

const initial = (entry: ListedEntry) =>
  (entry.issuer || entry.name || '?').trim().charAt(0).toUpperCase() || '?'

interface EntryRowProps {
  entry: ListedEntry
  onCopy: (_entry: ListedEntry) => void
  onOpen: (_entry: ListedEntry) => void
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
 */
const EntryRow: FC<EntryRowProps> = ({ entry, onCopy, onOpen }) => (
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
