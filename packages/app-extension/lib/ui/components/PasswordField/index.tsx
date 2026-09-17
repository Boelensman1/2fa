import type { FC } from 'react'
import { useId, useState } from 'react'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (_value: string) => void
  autoComplete?: string
  autoFocus?: boolean
  disabled?: boolean
}

/**
 * A password box with a reveal toggle.
 *
 * The toggle matters more here than in a normal form: a master password is
 * long by construction -- favalib refuses anything zxcvbn scores below 3 -- and
 * it is being typed into a 380px popup that vanishes on a click elsewhere.
 */
const PasswordField: FC<PasswordFieldProps> = ({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  disabled,
}) => {
  const id = useId()
  const [revealed, setRevealed] = useState(false)

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-gray-700"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 pr-16 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-gray-500 hover:text-gray-800"
          aria-label={revealed ? 'Hide password' : 'Show password'}
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

export default PasswordField
