import type { FC } from 'react'

export type TabId = 'vault' | 'settings'

interface TabBarProps {
  active: TabId
  onChange: (_tab: TabId) => void
}

const TABS: { id: TabId; label: string; path: string }[] = [
  {
    id: 'vault',
    label: 'Vault',
    path: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9Zm2 1V9h10V6.5H5ZM5 11v2.5h10V11H5Z',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-1-6.5h2l.3 1.9a6.5 6.5 0 0 1 1.5.9l1.8-.8 1 1.7-1.5 1.2a6.5 6.5 0 0 1 0 1.7l1.5 1.2-1 1.7-1.8-.8a6.5 6.5 0 0 1-1.5.9L11 18H9l-.3-1.9a6.5 6.5 0 0 1-1.5-.9l-1.8.8-1-1.7 1.5-1.2a6.5 6.5 0 0 1 0-1.7L4.4 10.2l1-1.7 1.8.8a6.5 6.5 0 0 1 1.5-.9L9 2Z',
  },
]

const TabBar: FC<TabBarProps> = ({ active, onChange }) => (
  <nav className="flex shrink-0 border-t border-gray-200 bg-white">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        aria-current={active === tab.id ? 'page' : undefined}
        className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors ${
          active === tab.id
            ? 'text-blue-600'
            : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={tab.path} />
        </svg>
        {tab.label}
      </button>
    ))}
  </nav>
)

export default TabBar
