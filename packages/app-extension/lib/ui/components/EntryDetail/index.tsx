import type { FC, ReactNode } from 'react'

import type { ListedEntry } from '@/lib/types'
import Button from '../Button'

interface EntryDetailProps {
  entry: ListedEntry
  onCopy: (_entry: ListedEntry) => void
  /** Null when the tab has no detected field to fill. */
  onFill: ((_entry: ListedEntry) => void) | null
  /** The host the code would be typed into. */
  fillHost: string | null
  onBack: () => void
  onEdit: () => void
}

const Field: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <dt className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
      {label}
    </dt>
    <dd className="mt-0.5 text-sm break-words text-gray-900">{children}</dd>
  </div>
)

/**
 * One entry, in full.
 *
 * Still no code on screen -- the copy button is the only way to get one, here
 * as in the list. What this view adds is the matcher list, which is the only
 * place a user can see *why* an entry did or did not show up under "for this
 * site".
 */
const EntryDetail: FC<EntryDetailProps> = ({
  entry,
  onCopy,
  onFill,
  fillHost,
  onBack,
  onEdit,
}) => (
  <div className="flex h-full flex-col">
    <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-2 py-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to vault"
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12.95 4.05a1 1 0 0 1 0 1.4L8.7 9.75l4.25 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z" />
        </svg>
      </button>
      <h1 className="truncate text-sm font-semibold text-gray-900">
        {entry.issuer || entry.name || 'Untitled'}
      </h1>
    </header>

    <dl className="flex-1 space-y-3 overflow-y-auto p-4">
      <Field label="Issuer">{entry.issuer || '—'}</Field>
      <Field label="Account">{entry.name || '—'}</Field>
      <Field label="Website">
        {entry.url ? (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {entry.url}
          </a>
        ) : (
          '—'
        )}
      </Field>
      <Field label="Site matchers">
        {entry.matchers.length === 0 ? (
          <span className="text-gray-500">
            None, so this entry never appears under “For this site”.
          </span>
        ) : (
          <ul className="space-y-0.5">
            {entry.matchers.map((matcher) => (
              <li
                key={`${matcher.type}:${matcher.value}`}
                className="font-mono text-xs"
              >
                <span className="text-gray-500">{matcher.type}</span>{' '}
                {matcher.value}
              </li>
            ))}
          </ul>
        )}
      </Field>
    </dl>

    <div className="space-y-2 border-t border-gray-200 p-3">
      <Button variant="secondary" onClick={onEdit}>
        Edit entry
      </Button>
      {onFill ? (
        <Button onClick={() => onFill(entry)}>Fill into {fillHost}</Button>
      ) : null}
      <Button
        variant={onFill ? 'secondary' : 'primary'}
        onClick={() => onCopy(entry)}
      >
        Copy verification code
      </Button>
    </div>
  </div>
)

export default EntryDetail
