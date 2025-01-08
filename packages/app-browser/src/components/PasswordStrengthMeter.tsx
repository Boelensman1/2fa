import { Component, For } from 'solid-js'
import type { ZxcvbnResult } from '@zxcvbn-ts/core'
import { Passphrase } from 'favalib'

const passphraseGuessesToPercentage = (guessesLog10: number) => {
  return Math.min(100, Math.round(Math.max(0, guessesLog10 - 1)) * 10)
}

const getPasswordStrengthColor = (score: number) => {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-yellow-500',
    'bg-green-500',
    'bg-blue-500',
  ]
  return colors[score] || colors[0]
}

interface PasswordStrengthMeterProps {
  password: Passphrase
  passwordStrength: ZxcvbnResult | null
}

const PasswordStrengthMeter: Component<PasswordStrengthMeterProps> = (
  props,
) => {
  const renderPasswordSuggestions = () => {
    if (!props.passwordStrength || props.password === '') return null
    const { score, feedback } = props.passwordStrength
    return (
      <div class="mt-2 text-sm">
        <p
          class={`font-medium ${score > 2 ? 'text-green-600' : 'text-red-600'}`}
        >
          {score > 2 ? 'Strong password' : 'Weak password'}
        </p>
        {feedback.warning && <p class="text-orange-500">{feedback.warning}</p>}
        {feedback.suggestions.length > 0 && (
          <ul class="list-disc list-inside text-gray-600">
            <For each={feedback.suggestions}>
              {(suggestion) => <li>{suggestion}</li>}
            </For>
          </ul>
        )}
      </div>
    )
  }

  return (
    <div class="mt-2">
      <div class="flex justify-between mb-1">
        <span class="text-xs font-medium text-gray-500">
          Password strength:
        </span>
        <span class="text-xs font-medium text-gray-500">
          {passphraseGuessesToPercentage(
            props.passwordStrength?.guessesLog10 ?? 0,
          )}
          %
        </span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2.5">
        <div
          class={`${getPasswordStrengthColor(props.passwordStrength?.score ?? 0)} h-2.5 rounded-full transition-all duration-300`}
          style={{
            width: `${passphraseGuessesToPercentage(
              props.passwordStrength?.guessesLog10 ?? 0,
            )}%`,
          }}
        />
      </div>
      {renderPasswordSuggestions()}
    </div>
  )
}

export default PasswordStrengthMeter
