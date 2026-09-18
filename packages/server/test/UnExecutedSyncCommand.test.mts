import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import UnExecutedSyncCommand from '../src/models/UnExecutedSyncCommand.mjs'
import { cleanupTestDatabase, initializeTestDatabase } from './test-setup.mjs'
import type { DeviceId, Encrypted, EncryptedSymmetricKey } from 'favalib/types'

/**
 * The model is six field declarations and two static strings, so there is no
 * logic here to test -- what these two do test is that the migration ran and
 * the columns are the ones the model names. Everything else this file used to
 * assert (that `Object.assign` copies, that `typeof 1 === 'number'`, that
 * `extends` works, that knex's `whereIn` filters) was testing Objection and
 * the compiler. The query shapes those exercised are covered end to end
 * against the real handler in server.test.mts.
 */
describe('UnExecutedSyncCommand', () => {
  beforeAll(() => {
    initializeTestDatabase()
  })

  beforeEach(() => {
    initializeTestDatabase()
  })

  afterEach(async () => {
    await cleanupTestDatabase()
  })

  it('should insert and retrieve records from database', async () => {
    const commandId = randomUUID()
    const testData = {
      commandId: commandId,
      deviceId: 'test-device-id' as DeviceId,
      encryptedCommand: randomUUID() as Encrypted<string>,
      encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
    }

    const inserted = await UnExecutedSyncCommand.query().insert(testData)
    expect(inserted).toMatchObject(testData)

    const retrieved = await UnExecutedSyncCommand.query()
      .where({
        commandId: testData.commandId,
      })
      .first()

    expect(retrieved).toBeDefined()
    expect(retrieved!.commandId).toBe(testData.commandId)
    expect(retrieved!.deviceId).toBe(testData.deviceId)
    expect(retrieved!.encryptedCommand).toBe(testData.encryptedCommand)
    expect(retrieved!.encryptedSymmetricKey).toBe(
      testData.encryptedSymmetricKey,
    )
  })

  it('should delete records from database', async () => {
    const commandId = randomUUID()
    const testData = {
      commandId: commandId,
      deviceId: 'delete-test-device' as DeviceId,
      encryptedCommand: randomUUID() as Encrypted<string>,
      encryptedSymmetricKey: 'delete-encrypted-key' as EncryptedSymmetricKey,
    }

    await UnExecutedSyncCommand.query().insert(testData)

    let count = await UnExecutedSyncCommand.query()
      .where({
        commandId: testData.commandId,
      })
      .resultSize()
    expect(count).toBe(1)

    await UnExecutedSyncCommand.query()
      .where({
        commandId: testData.commandId,
      })
      .del()

    count = await UnExecutedSyncCommand.query()
      .where({
        commandId: testData.commandId,
      })
      .resultSize()
    expect(count).toBe(0)
  })
})
