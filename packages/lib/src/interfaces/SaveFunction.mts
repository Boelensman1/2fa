import type { LockedRepresentationString } from './Vault.mjs'

type SaveFunction = (
  newLockedRepresentationString: LockedRepresentationString,
) => Promise<void> | void

export default SaveFunction
