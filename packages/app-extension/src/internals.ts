import 'reflect-metadata'

// exported here as we get circular dependencies otherwise
export { default as Logger } from './classes/Logger'

export { default as IOC_TYPES } from './ioc/types'

export * from './state'
export * from './util'
export * from './ui/components'
// export * from './classes'

export { default as container, initContainer } from './ioc'
