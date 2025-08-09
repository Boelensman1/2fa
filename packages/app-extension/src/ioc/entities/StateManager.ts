import { injectable } from 'inversify'

import { initialState } from '../../internals'
import type { State } from '../../types'

@injectable()
class StateManager {
  state: State = initialState

  resetState(): State {
    if (!this.state) {
      throw new Error('Trying to reset unset state')
    }
    Object.assign(this.state, initialState)

    // eslint-disable-next-line
    return this.state!
  }

  getState(): State {
    return this.state
  }
}

export default StateManager
