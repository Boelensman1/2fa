import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { Model } from 'objection'
import UnExecutedSyncCommand from '../src/models/UnExecutedSyncCommand.mjs'
import { cleanupTestDatabase, initializeTestDatabase } from './test-setup.mjs'
import type { DeviceId, Encrypted, EncryptedSymmetricKey } from 'favalib'

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

  describe('Model Configuration', () => {
    it('should have correct table name', () => {
      expect(UnExecutedSyncCommand.tableName).toBe('unExecutedSyncCommands')
    })

    it('should have correct id column', () => {
      expect(UnExecutedSyncCommand.idColumn).toBe('id')
    })
  })

  describe('Model Properties', () => {
    it('should have correct property types defined', () => {
      const command = new UnExecutedSyncCommand()

      command.id = 1
      command.commandId = randomUUID()
      command.deviceId = 'device' as DeviceId
      command.encryptedCommand = 'encrypted' as Encrypted<string>
      command.encryptedSymmetricKey = 'key' as EncryptedSymmetricKey
      command.createdAt = new Date()

      expect(typeof command.id).toBe('number')
      expect(typeof command.commandId).toBe('string')
      expect(typeof command.deviceId).toBe('string')
      expect(typeof command.encryptedCommand).toBe('string')
      expect(typeof command.encryptedSymmetricKey).toBe('string')
      expect(command.createdAt).toBeInstanceOf(Date)
    })

    it('should allow setting all properties', () => {
      const command = new UnExecutedSyncCommand()
      const testData = {
        id: 1,
        commandId: randomUUID(),
        deviceId: 'test-device-id' as DeviceId,
        encryptedCommand: 'encrypted-command-data' as Encrypted<string>,
        encryptedSymmetricKey: 'encrypted-key' as EncryptedSymmetricKey,
        createdAt: new Date(),
      }

      Object.assign(command, testData)

      expect(command.id).toBe(testData.id)
      expect(command.commandId).toBe(testData.commandId)
      expect(command.deviceId).toBe(testData.deviceId)
      expect(command.encryptedCommand).toBe(testData.encryptedCommand)
      expect(command.encryptedSymmetricKey).toBe(testData.encryptedSymmetricKey)
      expect(command.createdAt).toBe(testData.createdAt)
    })
  })

  describe('Type Safety', () => {
    it('should enforce correct types for properties', () => {
      const command = new UnExecutedSyncCommand()

      command.id = 123
      command.commandId = randomUUID()
      command.deviceId = 'device-id' as DeviceId
      command.encryptedCommand = 'encrypted-data' as Encrypted<string>
      command.encryptedSymmetricKey = 'encrypted-key' as EncryptedSymmetricKey
      command.createdAt = new Date()

      expect(typeof command.id).toBe('number')
      expect(typeof command.commandId).toBe('string')
      expect(typeof command.deviceId).toBe('string')
      expect(typeof command.encryptedCommand).toBe('string')
      expect(typeof command.encryptedSymmetricKey).toBe('string')
      expect(command.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('Database Operations', () => {
    it('should inherit query builder from Model', () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(UnExecutedSyncCommand.query).toBeDefined()
      expect(typeof UnExecutedSyncCommand.query).toBe('function')
    })

    it('should be able to create query builder instances', () => {
      const queryBuilder = UnExecutedSyncCommand.query()
      expect(queryBuilder).toBeDefined()
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

  describe('Model Inheritance', () => {
    it('should extend Objection Model', () => {
      const command = new UnExecutedSyncCommand()
      expect(command).toBeInstanceOf(Model)
      expect(command).toBeInstanceOf(UnExecutedSyncCommand)
    })

    it('should have Model static methods', () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(UnExecutedSyncCommand.query).toBeDefined()
      expect(typeof UnExecutedSyncCommand.fromJson).toBe('function')
      expect(typeof UnExecutedSyncCommand.fromDatabaseJson).toBe('function')
    })
  })

  describe('Integration with Objection patterns', () => {
    it('should support filtering by device ID', async () => {
      const deviceId1 = 'test-device-1' as DeviceId
      const deviceId2 = 'test-device-2' as DeviceId

      const cmd1Id = randomUUID()
      const cmd2Id = randomUUID()
      const cmd3Id = randomUUID()

      await UnExecutedSyncCommand.query().insert([
        {
          commandId: cmd1Id,
          deviceId: deviceId1,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key1' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd2Id,
          deviceId: deviceId2,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key2' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd3Id,
          deviceId: deviceId1,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key3' as EncryptedSymmetricKey,
        },
      ])

      const device1Commands = await UnExecutedSyncCommand.query().where({
        deviceId: deviceId1,
      })
      expect(device1Commands).toHaveLength(2)
      expect(device1Commands.map((cmd) => cmd.commandId).sort()).toEqual(
        [cmd1Id, cmd3Id].sort(),
      )
    })

    it('should support whereIn operations for multiple command IDs', async () => {
      const deviceId = 'test-device' as DeviceId
      const cmd1Id = randomUUID()
      const cmd2Id = randomUUID()
      const cmd3Id = randomUUID()
      const commandIds = [cmd1Id, cmd2Id]

      await UnExecutedSyncCommand.query().insert([
        {
          commandId: cmd1Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key1' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd2Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key2' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd3Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key3' as EncryptedSymmetricKey,
        },
      ])

      const foundCommands = await UnExecutedSyncCommand.query()
        .where({ deviceId })
        .whereIn('commandId', commandIds)

      expect(foundCommands).toHaveLength(2)
      expect(foundCommands.map((cmd) => cmd.commandId).sort()).toEqual(
        [cmd1Id, cmd2Id].sort(),
      )
    })

    it('should support delete operations with whereIn', async () => {
      const deviceId = 'test-device' as DeviceId
      const cmd1Id = randomUUID()
      const cmd2Id = randomUUID()
      const cmd3Id = randomUUID()
      const commandIds = [cmd1Id, cmd2Id]

      await UnExecutedSyncCommand.query().insert([
        {
          commandId: cmd1Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key1' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd2Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key2' as EncryptedSymmetricKey,
        },
        {
          commandId: cmd3Id,
          deviceId,
          encryptedCommand: randomUUID() as Encrypted<string>,
          encryptedSymmetricKey: 'key3' as EncryptedSymmetricKey,
        },
      ])

      await UnExecutedSyncCommand.query()
        .where({ deviceId })
        .whereIn('commandId', commandIds)
        .del()

      const remaining = await UnExecutedSyncCommand.query().where({ deviceId })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].commandId).toBe(cmd3Id)
    })
  })
})
