import type { FC } from 'react'

/** Shown only until the background answers the first GET_VAULT_STATE. */
const Splash: FC<{ message?: string }> = ({ message = 'Loading…' }) => (
  <div className="flex h-40 items-center justify-center text-sm text-gray-500">
    {message}
  </div>
)

export default Splash
