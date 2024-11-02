/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

export const up = async (knex: Knex) => {
  await knex.schema.createTable('unExecutedSyncCommands', (table): void => {
    table.uuid('commandId').notNullable().primary()
    table.string('deviceId').notNullable()
    table.text('encryptedCommand').notNullable().unique()
    table.text('encryptedSymmetricKey')
    table.timestamp('createdAt').notNullable().defaultTo('NOW()')
  })
}

export const down = async (knex: Knex) => {
  await knex.schema.dropTable('unExecutedSyncCommands')
}
