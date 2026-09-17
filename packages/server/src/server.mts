import { Model } from 'objection'
import createKnex from 'knex'

import knexConfig from '../knexfile.js'
import { config } from './config.mjs'
import { createSyncServer } from './createSyncServer.mjs'

import type { ServerSecret } from 'favalib/types'

/**
 * The entry point, and deliberately nothing else.
 *
 * Everything this file used to hold -- the message handler, the connected-device
 * map, the add-device requests -- moved to `createSyncServer.mts` so that it can
 * be imported and tested. What is left is the part that can only run as a
 * script: bind the database, read configuration, listen.
 */

const knex = createKnex(knexConfig)
Model.knex(knex)

const port = Number(process.env.PORT ?? 8080)

createSyncServer({
  port,
  sharedSecret: config.sync.sharedSecret as ServerSecret,
})

// Load-bearing: test/duplicateSyncCommands.test.mts spawns this file and waits
// for this exact line on stdout before it connects.
console.log(`Server started on port ${port}`)
