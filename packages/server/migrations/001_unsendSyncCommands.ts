/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'
import insertIdColumn from './util/createIdColumn.mjs'

export const up = async (knex: Knex) => {
  await knex.schema.createTable('unExecutedSyncCommands', (table): void => {
    insertIdColumn(table)
    table.uuid('commandId').notNullable()
    table.string('deviceId').notNullable()
    table.text('encryptedCommand').notNullable().unique()
    table.text('encryptedSymmetricKey')
    table.timestamp('createdAt').notNullable().defaultTo('NOW()')

    table.unique(['commandId', 'deviceId'])
  })
}

export const down = async (knex: Knex) => {
  await knex.schema.dropTable('unExecutedSyncCommands')
}
