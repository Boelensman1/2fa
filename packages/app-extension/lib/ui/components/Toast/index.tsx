import type { FC } from 'react'

interface ToastProps {
  message: string | null
  tone?: 'success' | 'error'
}

/**
 * The copy confirmation.
 *
 * Fixed to the bottom above the tab bar rather than overlaid on the clicked
 * row: the row that was clicked may well have scrolled away by the time the
 * clipboard write resolves.
 */
const Toast: FC<ToastProps> = ({ message, tone = 'success' }) => {
  if (!message) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-14 flex justify-center">
      <div
        role="status"
        className={`rounded-full px-4 py-1.5 text-xs font-medium text-white shadow-lg ${
          tone === 'success' ? 'bg-gray-900' : 'bg-red-600'
        }`}
      >
        {message}
      </div>
    </div>
  )
}

export default Toast
