import type { FC } from 'react'

import type { PasswordStrength } from '@/lib/types'

/** favalib's `createNewFavaLibVault` throws below this. */
export const MINIMUM_SCORE = 3

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
const COLOURS = [
  'bg-red-500',
  'bg-red-400',
  'bg-yellow-400',
  'bg-green-500',
  'bg-green-600',
]

interface PasswordStrengthMeterProps {
  strength: PasswordStrength | null
}

/**
 * zxcvbn's verdict, shown before the vault is created rather than after.
 *
 * Without it a weak password is only rejected once the user hits submit, by a
 * bare "Password is too weak" thrown from inside favalib with no indication of
 * what would satisfy it.
 */
const PasswordStrengthMeter: FC<PasswordStrengthMeterProps> = ({
  strength,
}) => {
  if (!strength) return null

  const score = Math.max(0, Math.min(4, strength.score))
  // Not `??`: these are strings, and an empty warning should fall through to
  // a suggestion rather than render as a blank line.
  const advice =
    strength.warning !== '' ? strength.warning : (strength.suggestions[0] ?? '')

  return (
    <div>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={`h-1 flex-1 rounded-full ${
              segment <= score ? COLOURS[score] : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-600">
        {LABELS[score]}
        {score < MINIMUM_SCORE ? ' — too weak to create a vault' : ''}
      </p>
      {advice ? <p className="mt-0.5 text-xs text-gray-500">{advice}</p> : null}
    </div>
  )
}

export default PasswordStrengthMeter
