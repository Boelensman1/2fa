import { produce } from 'solid-js/store'
import type { Component, JSX } from 'solid-js'

import Context from './Context'
import store from './store'
import Action from './types/Action'

import reducer from './reducer'

interface ProviderProps {
  children: JSX.Element
}

const dispatch = (action: Action) => {
  store.setState(
    produce((state) => {
      reducer(action, state)
    }),
  )
}

const Provider: Component<ProviderProps> = (props) => {
  return (
    <Context.Provider
      value={[
        store.state,
        (action: Action) => {
          dispatch(action)
        },
      ]}
    >
      {props.children}
    </Context.Provider>
  )
}

export default Provider
