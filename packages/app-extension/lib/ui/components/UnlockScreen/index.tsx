import type { FC, FormEvent } from 'react'
import { useState } from 'react'
import type { Password } from 'favalib'

import { bgActions } from '@/lib/state'
import Button from '../Button'
import PasswordField from '../PasswordField'

interface UnlockScreenProps {
  onUnlocked: () => void
}

const UnlockScreen: FC<UnlockScreenProps> = ({ onUnlocked }) => {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    setBusy(true)
    setError(null)
    // Resolves with an outcome rather than throwing; the reason would not
    // survive the trip back from the background otherwise.
    const result = await bgActions.unlockVault(password as Password)
    setBusy(false)

    if (result?.ok) {
      setPassword('')
      onUnlocked()
      return
    }
    setError(result?.error ?? 'Could not unlock the vault')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void unlock()
  }

  const onReset = () => {
    if (
      !confirm(
        'Forget this vault? The encrypted copy on this device is deleted. ' +
          'You can only get it back by pairing with another device again.',
      )
    ) {
      return
    }
    void bgActions.resetVault().then(onUnlocked)
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <header className="text-center">
        <h1 className="text-lg font-semibold text-gray-900">Fava</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          Enter your master password to unlock.
        </p>
      </header>

      <PasswordField
        label="Master password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        autoFocus
        disabled={busy}
      />

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <Button type="submit" disabled={busy || password.length === 0}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </Button>

      <button
        type="button"
        onClick={onReset}
        className="text-xs text-gray-500 underline hover:text-gray-800"
      >
        Forget this vault
      </button>
    </form>
  )
}

export default UnlockScreen
