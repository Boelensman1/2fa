import { createStore } from 'solid-js/store'
import initial from './initial'

const [state, setState] = createStore(initial)

const store = { state, setState }

export default store
