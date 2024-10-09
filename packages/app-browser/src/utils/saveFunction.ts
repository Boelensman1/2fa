import { ChangedEventWasChangedSinceLastEvent, ChangedEventData } from '2falib'

const saveFunction = (
  changed: ChangedEventWasChangedSinceLastEvent,
  data: ChangedEventData,
) => {
  Object.entries(changed).forEach(([key, isChanged]) => {
    if (isChanged) {
      localStorage.setItem(key, data[key as keyof typeof changed])
    }
  })
}

export default saveFunction
