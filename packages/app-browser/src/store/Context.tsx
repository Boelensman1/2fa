import { createContext } from 'solid-js'

import initialState from './initial'
import Action from './types/Action'

type ContextType = [typeof initialState, (action: Action) => void]

const context = createContext<ContextType>([
  initialState,
  () => {
    console.error('Context is not available')
  },
])

export default context
