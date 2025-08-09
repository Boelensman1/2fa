import { injectable, inject } from 'inversify'

import { IOC_TYPES, defaultConfig } from '../../internals'
import type { Config, Db } from '../../types'

@injectable()
class ConfigContainer {
  db: Db
  config?: Config

  public constructor(@inject(IOC_TYPES.DB) db: Db) {
    this.db = db
  }

  async init() {
    const configFromDb = await this.db.getMetaValue('config')
    if (!configFromDb) {
      this.config = defaultConfig
    } else {
      this.config = JSON.parse(configFromDb) as Config
    }
  }

  async set<T extends keyof Config>(key: T, value: Config[T]) {
    if (!this.config) {
      throw new Error(
        `Tried to set config (${key}) but it has not finished loading yet`,
      )
    }

    this.config[key] = value
    await this.db.upsertMetaKV('config', JSON.stringify(this.config))
  }

  get<T extends keyof Config>(key: T): Config[T] {
    if (!this.config) {
      throw new Error(
        `Tried to get config (${key}) but it has not finished loading yet`,
      )
    }
    return this.config[key]
  }

  getFullConfig(): Config {
    if (!this.config) {
      throw new Error(
        'Tried to get full config but it has not finished loading yet',
      )
    }
    return this.config
  }

  async reset() {
    if (!this.config) {
      throw new Error(
        'Tried to reset config but it has not finished loading yet',
      )
    }

    this.config = defaultConfig
    await this.db.upsertMetaKV('config', JSON.stringify(this.config))
  }
}

export default ConfigContainer
