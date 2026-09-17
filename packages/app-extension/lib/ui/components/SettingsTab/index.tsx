import type { FC } from 'react'
import { useState } from 'react'

import { version } from '@/lib/parameters'
import type { VaultSummary } from '@/lib/types'
import { useConfig, useGlobalState } from '../../hooks'
import Button from '../Button'
import SyncServerForm from '../SyncServerForm'

interface SettingsTabProps {
  summary: VaultSummary
  onLock: () => void
  onReset: () => void
  /** Re-reads the vault summary after the sync server changes. */
  onVaultChanged: () => void
}

const SettingsTab: FC<SettingsTabProps> = ({
  summary,
  onLock,
  onReset,
  onVaultChanged,
}) => {
  const { config, saveConfig } = useConfig()
  const globalState = useGlobalState()
  const [editingServer, setEditingServer] = useState(false)

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
            {summary.entryCount}{' '}
            {summary.entryCount === 1 ? 'entry' : 'entries'}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Sync server
          </h2>
          {/*
            Two separate facts. No server configured is answered by the form
            below; a configured server that is down is answered by waiting, and
            saying "not connected" without that distinction sends the user to
            retype a secret that was never the problem.
          */}
          {summary.syncServerUrl === null ? (
            <p className="text-gray-500">
              Not set up. This vault stays on this device until you point it at
              a server.
            </p>
          ) : (
            <>
              <p className="font-mono break-all text-gray-400">
                {summary.syncServerUrl}
              </p>
              <p
                className={
                  summary.syncConnected ? 'text-green-600' : 'text-yellow-700'
                }
              >
                {summary.syncConnected ? 'Connected' : 'Not connected'}
              </p>
            </>
          )}

          {editingServer ? (
            <SyncServerForm
              currentUrl={summary.syncServerUrl}
              onConfigured={() => {
                setEditingServer(false)
                onVaultChanged()
              }}
              onCancel={() => setEditingServer(false)}
            />
          ) : (
            <Button variant="secondary" onClick={() => setEditingServer(true)}>
              {summary.syncServerUrl === null
                ? 'Set up sync'
                : 'Change sync server'}
            </Button>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Autofill
          </h2>
          <label className="flex items-start gap-1.5 text-gray-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={config.inlineMenu}
              onChange={(event) =>
                void saveConfig({ inlineMenu: event.target.checked })
              }
            />
            <span>
              Offer to fill codes on the page
              <span className="block text-gray-400">
                Clicking a verification code field shows the entries that match
                that site. Fava never fills anything until you pick one. With
                this off you can still fill from this popup, which offers every
                entry rather than only the matching ones.
              </span>
            </span>
          </label>
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
