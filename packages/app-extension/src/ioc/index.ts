import 'reflect-metadata'
import { Container } from 'inversify'
import type { ValueOf } from 'type-fest'

import { IOC_TYPES } from '../internals'

import { ConfigContainer, StateManager, Db, FavaLibManager } from './entities'

const container = new Container({ defaultScope: 'Singleton' })

export const initContainer = (
  container: Container,
  skip: ValueOf<typeof IOC_TYPES>[] = [],
) => {
  const bindIfNotSkipped = <T>(
    type: ValueOf<typeof IOC_TYPES>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Class: new (...args: any[]) => T,
  ) => {
    if (!skip.includes(type)) {
      container.bind<T>(type).to(Class)
    }
  }

  // Independent bindings
  bindIfNotSkipped(IOC_TYPES.DB, Db)

  // Depends on Db
  bindIfNotSkipped(IOC_TYPES.StateManager, StateManager)
  bindIfNotSkipped(IOC_TYPES.ConfigContainer, ConfigContainer)
  bindIfNotSkipped(IOC_TYPES.FavaLibManager, FavaLibManager)
}

initContainer(container)

export default container
