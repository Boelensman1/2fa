import type { LockedRepresentationString } from '2falib'

const saveFunction = (
  newLockedRepresentationString: LockedRepresentationString,
) => {
  localStorage.setItem('lockedRepresentation', newLockedRepresentationString)
}

export default saveFunction
