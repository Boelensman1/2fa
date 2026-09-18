import type { FC, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import type { Password } from 'favalib'

import { bgActions } from '@/lib/state'
import { createModeDraft } from '@/lib/drafts'
import type { PasswordStrength } from '@/lib/types'
import { useDraft } from '../../hooks'
import Button from '../Button'
import PasswordField from '../PasswordField'
import PasswordStrengthMeter, { MINIMUM_SCORE } from '../PasswordStrengthMeter'

type Mode = 'connect' | 'create'

interface CreateVaultScreenProps {
  onCreated: () => void
}

/**
 * First run.
 *
 * Both paths start by creating a local vault, because in this design a device
 * *is* its own vault plus a set of sync peers -- there is no "log in to an
 * account" that could fetch one. `connect` then hands that empty vault over to
 * the pairing flow, which overwrites it with the real one.
 *
 * `connect` leads, because a second device is the common case: someone
 * installing this already has entries in the pwa or the cli.
 *
 * Only the choice between the two is drafted. The passwords are not, and that
 * is the rule rather than an omission -- see `lib/drafts.ts`. This screen also
 * does not wait on the draft read the way the sync and pairing forms do: there
 * is no typed text here to lose, so a toggle that corrects itself a frame later
 * beats a spinner in front of first-run onboarding.
 */
const CreateVaultScreen: FC<CreateVaultScreenProps> = ({ onCreated }) => {
  const [mode, setMode, { clear: clearMode }] = useDraft<Mode>(
    createModeDraft,
    'connect',
  )
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [strength, setStrength] = useState<PasswordStrength | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Debounced: scoring every keystroke would run zxcvbn in the background on
  // each one and let the answers arrive out of order. Everything happens
  // inside the timer, including clearing the meter, so nothing sets state
  // synchronously while the effect body runs.
  useEffect(() => {
    let cancelled = false

    const timer = setTimeout(() => {
      const updateStrength = async () => {
        if (!password) {
          setStrength(null)
          return
        }
        const result = await bgActions.getPasswordStrength(password as Password)
        if (!cancelled) setStrength(result)
      }
      void updateStrength()
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [password])

  const mismatch = confirmation.length > 0 && confirmation !== password
  const tooWeak = strength !== null && strength.score < MINIMUM_SCORE
  const canSubmit =
    !busy && password.length > 0 && confirmation === password && !tooWeak

  const create = async () => {
    setBusy(true)
    setError(null)
    const result = await bgActions.createVault(password as Password, mode)
    setBusy(false)

    if (result?.ok) {
      setPassword('')
      setConfirmation('')
      clearMode()
      onCreated()
      return
    }
    setError(result?.error ?? 'Could not create the vault')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void create()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <header className="text-center">
        <h1 className="text-lg font-semibold text-gray-900">Welcome to Fava</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          Choose a master password. It is the only thing that can decrypt this
          vault, and it is never sent anywhere.
        </p>
      </header>

      <div className="flex rounded-md border border-gray-300 p-0.5 text-xs">
        {(
          [
            ['connect', 'Add to existing vault'],
            ['create', 'Start a new vault'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`flex-1 rounded px-2 py-1.5 font-medium transition-colors ${
              mode === value
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <PasswordField
        label="Master password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        autoFocus
        disabled={busy}
      />
      <PasswordStrengthMeter strength={strength} />

      <PasswordField
        label="Confirm master password"
        value={confirmation}
        onChange={setConfirmation}
        autoComplete="new-password"
        disabled={busy}
      />
      {mismatch ? (
        <p className="text-xs text-red-600">The passwords do not match.</p>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <Button type="submit" disabled={!canSubmit}>
        {busy ? 'Creating…' : 'Continue'}
      </Button>

      <p className="text-center text-xs text-gray-500">
        {mode === 'connect'
          ? 'Next you will paste a connection code from a device that already has your vault.'
          : 'This creates an empty vault on this device.'}
      </p>
    </form>
  )
}

export default CreateVaultScreen
