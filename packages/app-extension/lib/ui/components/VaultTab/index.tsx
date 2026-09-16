import type { FC } from 'react'
import { useState } from 'react'

import { useActiveTabUrl, useEntries } from '../../hooks'
import type { ListedEntry } from '@/lib/types'
import EntryRow from '../EntryRow'
import Splash from '../Splash'

interface VaultTabProps {
  onCopy: (_entry: ListedEntry) => void
  onOpen: (_entry: ListedEntry) => void
  onLock: () => void
}

const SectionHeading: FC<{ children: string }> = ({ children }) => (
  <h2 className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
    {children}
  </h2>
)

const VaultTab: FC<VaultTabProps> = ({ onCopy, onOpen, onLock }) => {
  const [query, setQuery] = useState('')
  const url = useActiveTabUrl()
  const { entries, loading } = useEntries(query, url)

  const searching = query.trim().length > 0
  const nothingAtAll = !loading && entries.all.length === 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-gray-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.64 3.63a1 1 0 0 0 1.42-1.42l-3.64-3.63A5.5 5.5 0 0 0 9 3.5Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vault"
            aria-label="Search vault"
            className="w-full rounded-md border border-gray-300 py-1.5 pr-2 pl-8 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onLock}
          title="Lock vault"
          aria-label="Lock vault"
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 1.5A3.75 3.75 0 0 0 6.25 5.25V8H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.25V5.25A3.75 3.75 0 0 0 10 1.5Zm2.25 6.5V5.25a2.25 2.25 0 0 0-4.5 0V8h4.5Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? <Splash /> : null}

        {nothingAtAll ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            {searching
              ? 'No entries match that search.'
              : 'This vault has no entries yet. Add one in the Fava app, and it will sync here.'}
          </p>
        ) : null}

        {/* Hidden while searching: a query is a deliberate narrowing, and a
            second list beside it that ignores the query reads as a bug. */}
        {entries.forSite.length > 0 ? (
          <section>
            <SectionHeading>For this site</SectionHeading>
            <ul>
              {entries.forSite.map((entry) => (
                <EntryRow
                  key={`site-${entry.id}`}
                  entry={entry}
                  onCopy={onCopy}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {entries.all.length > 0 ? (
          <section>
            <SectionHeading>
              {searching
                ? `Results (${String(entries.all.length)})`
                : `All items (${String(entries.all.length)})`}
            </SectionHeading>
            <ul>
              {entries.all.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onCopy={onCopy}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}

export default VaultTab
