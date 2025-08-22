import createKnex from 'knex'
import { Model } from 'objection'
import knexConfig from '../knexfile.js'

/**
 * Global Knex instance for test database operations
 */
let knex: ReturnType<typeof createKnex> | undefined

/**
 * Initialize the database connection for tests
 * This sets up the knex instance and binds it to Objection models
 * @returns The knex instance
 */
export const initializeTestDatabase = () => {
  if (!knex) {
    process.env.NODE_ENV = 'test'
    knex = createKnex(knexConfig)
    Model.knex(knex)
  }
  return knex
}

/**
 * Cleans up test data by clearing the unExecutedSyncCommands table
 *
 * Removes all records from the unExecutedSyncCommands table to ensure
 * a clean state for subsequent tests.
 */
export const cleanupTestDatabase = async () => {
  if (!knex) {
    return
  }
  await knex('unExecutedSyncCommands').del()
}

/**
 * Gets the current test Knex instance
 * @returns The current Knex instance or undefined if not initialized
 */
export const getTestKnex = () => knex
