import type { LockedRepresentationString } from 'favalib'

const saveFunction = (
  newLockedRepresentationString: LockedRepresentationString,
) => {
  localStorage.setItem('lockedRepresentation', newLockedRepresentationString)
}

export default saveFunction
