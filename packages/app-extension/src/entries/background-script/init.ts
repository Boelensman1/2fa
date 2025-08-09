import { container, Logger, IOC_TYPES } from '../../internals'
import type {
  ConfigContainer,
  Db,
  FavaLibManager,
  StateManager,
} from '../../types'

const log = new Logger('background-script/init')

const init = async () => {
  log.info('Running init')
  const db = container.get<Db>(IOC_TYPES.DB)
  await db.init()

  const config = container.get<ConfigContainer>(IOC_TYPES.ConfigContainer)
  await config.init()

  const favaLibManager = container.get<FavaLibManager>(IOC_TYPES.FavaLibManager)

  const stateManager = container.get<StateManager>(IOC_TYPES.StateManager)
  const state = stateManager.getState()
  state.status = (await favaLibManager.hasLockedRepresentation())
    ? 'locked'
    : 'no-vault'
}

export default init
