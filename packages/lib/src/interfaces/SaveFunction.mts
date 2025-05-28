import type { LockedRepresentationString } from './Vault.mjs'

export type SaveFunction = (
  newLockedRepresentationString: LockedRepresentationString,
) => Promise<void> | void
