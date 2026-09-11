import { container, Logger, IOC_TYPES } from '../'
import type { ConfigContainer, Db, StateManager } from '../types'

const log = new Logger('background-script/init')

const init = async () => {
  log.info('Running init')

  const db = container.get<Db>(IOC_TYPES.DB)
  await db.init()

  const config = container.get<ConfigContainer>(IOC_TYPES.ConfigContainer)
  await config.init()

  const stateManager = container.get<StateManager>(IOC_TYPES.StateManager)
  const state = stateManager.getState()
  state.status = 'ready'
}

export default init
