import type { FC } from 'react'
import { useCallback, useRef, useState } from 'react'

import { bgActions } from '@/lib/state'
import Logger from '@/lib/classes/Logger'
import type { ListedEntry, VaultSummary } from '@/lib/types'
import EntryDetail from '../EntryDetail'
import SettingsTab from '../SettingsTab'
import TabBar, { type TabId } from '../TabBar'
import Toast from '../Toast'
import VaultTab from '../VaultTab'

const log = new Logger('popup/AuthenticatedApp')

interface AuthenticatedAppProps {
  summary: VaultSummary
  onVaultChanged: () => void
}

/** How long the copy confirmation stays up. */
const TOAST_MS = 1800

const AuthenticatedApp: FC<AuthenticatedAppProps> = ({
  summary,
  onVaultChanged,
}) => {
  const [tab, setTab] = useState<TabId>('vault')
  const [selected, setSelected] = useState<ListedEntry | null>(null)
  const [toast, setToast] = useState<{
    message: string
    tone: 'success' | 'error'
  } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const showToast = useCallback(
    (message: string, tone: 'success' | 'error' = 'success') => {
      setToast({ message, tone })
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
    },
    [],
  )

  /**
   * The clipboard write happens here, not in the background.
   *
   * A service worker has no `navigator.clipboard`, so the code has to cross
   * back to the popup regardless. It is generated on demand and never
   * rendered.
   */
  const copy = useCallback(
    async (entry: ListedEntry) => {
      try {
        const otp = await bgActions.getToken(entry.id)
        if (!otp) {
          showToast('Could not generate a code', 'error')
          return
        }
        await navigator.clipboard.writeText(otp)
        showToast('Code copied')
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)))
        showToast('Could not copy the code', 'error')
      }
    },
    [showToast],
  )

  const onCopy = useCallback((entry: ListedEntry) => void copy(entry), [copy])

  const lock = () => {
    void bgActions.lockVault().then(onVaultChanged)
  }

  const reset = () => {
    void bgActions.resetVault().then(onVaultChanged)
  }

  return (
    <div className="flex h-[32rem] flex-col bg-white">
      <div className="min-h-0 flex-1">
        {selected ? (
          <EntryDetail
            entry={selected}
            onCopy={onCopy}
            onBack={() => setSelected(null)}
          />
        ) : tab === 'vault' ? (
          <VaultTab onCopy={onCopy} onOpen={setSelected} onLock={lock} />
        ) : (
          <SettingsTab summary={summary} onLock={lock} onReset={reset} />
        )}
      </div>

      <Toast message={toast?.message ?? null} tone={toast?.tone} />

      {/* Hidden behind the detail view: it is a drill-down from the vault tab,
          not a third destination, so a highlighted tab there would lie. */}
      {selected ? null : <TabBar active={tab} onChange={setTab} />}
    </div>
  )
}

export default AuthenticatedApp
