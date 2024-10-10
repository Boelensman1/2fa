/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

import createIdColumn from './util/createIdColumn.mjs'

export const up = async (knex: Knex) => {
  await knex.schema.createTable('unExecutedSyncCommands', (table): void => {
    createIdColumn(table)
    table.string('deviceId').notNullable()
    table.text('encryptedCommands').notNullable().unique()
    table.text('encryptedSymmetricKey')
    table.timestamp('createdAt').notNullable().defaultTo('NOW()')
  })
}

export const down = async (knex: Knex) => {
  await knex.schema.dropTable('unExecutedSyncCommands')
}
