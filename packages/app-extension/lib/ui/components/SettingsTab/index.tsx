import type { FC } from 'react'

import { version } from '@/lib/parameters'
import type { VaultSummary } from '@/lib/types'
import { useConfig, useGlobalState } from '../../hooks'
import Button from '../Button'

interface SettingsTabProps {
  summary: VaultSummary
  onLock: () => void
  onReset: () => void
}

const SettingsTab: FC<SettingsTabProps> = ({ summary, onLock, onReset }) => {
  const { config, saveConfig } = useConfig()
  const globalState = useGlobalState()

  const confirmReset = () => {
    if (
      confirm(
        'Forget this vault? The encrypted copy on this device is deleted. ' +
          'You can only get it back by pairing with another device again.',
      )
    ) {
      onReset()
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-gray-200 bg-white px-3 py-2">
        <h1 className="text-sm font-semibold text-gray-900">Settings</h1>
      </header>

      <div className="space-y-4 p-4 text-xs">
        <section className="space-y-1">
          <h2 className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            This device
          </h2>
          <p className="text-gray-700">
            {summary.deviceFriendlyName !== null &&
            summary.deviceFriendlyName !== ''
              ? summary.deviceFriendlyName
              : 'Unnamed device'}
          </p>
          <p className="font-mono break-all text-gray-400">
            {summary.deviceId ?? '—'}
          </p>
          <p className="text-gray-500">
            Sync{' '}
            <span
              className={
                summary.syncConnected ? 'text-green-600' : 'text-yellow-700'
              }
            >
              {summary.syncConnected ? 'connected' : 'not connected'}
            </span>
            {' · '}
            {summary.entryCount}{' '}
            {summary.entryCount === 1 ? 'entry' : 'entries'}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Diagnostics
          </h2>
          <label className="flex items-center gap-1.5 text-gray-600">
            <input
              type="checkbox"
              checked={config.debug}
              onChange={(event) =>
                void saveConfig({ debug: event.target.checked })
              }
            />
            Verbose logging
          </label>

          {/*
            The otp-field detector's report. Kept here rather than dropped when
            the popup became a vault client: the fixture suite cannot say how
            the heuristic does against a real site, and this is the only thing
            that can.
          */}
          <details>
            <summary className="cursor-pointer text-gray-600 select-none">
              Detected otp fields on this page
            </summary>
            {globalState.debugString === '' ? (
              <p className="mt-1 text-gray-500">
                No otp fields detected. A frame that finds nothing is not
                listed, so this also covers a tab that was open before the
                extension loaded — reload it if that is what happened.
              </p>
            ) : (
              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] break-words whitespace-pre-wrap">
                {globalState.debugString}
              </pre>
            )}
          </details>
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Vault
          </h2>
          <Button variant="secondary" onClick={onLock}>
            Lock now
          </Button>
          <Button variant="danger" onClick={confirmReset}>
            Forget this vault
          </Button>
        </section>

        <p className="pt-2 text-center text-gray-400">version {version}</p>
      </div>
    </div>
  )
}

export default SettingsTab
