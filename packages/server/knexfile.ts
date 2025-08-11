import type knex from 'knex'
import { config } from './src/config.mjs'

const knexConfig: knex.Knex.Config = {
  ...config.database,
  client: 'pg',
  migrations: {
    extension: 'ts',
  },
}

export default knexConfig
