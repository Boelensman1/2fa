import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readServerSecret,
  readSyncServerConfig,
} from '../src/utils/syncConfig.mjs'

describe('sync configuration', () => {
  let directory: string
  let secretFile: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-sync-'))
    secretFile = path.join(directory, 'secret')
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('uses the stored vault settings when no environment is configured', async () => {
    expect(await readSyncServerConfig({})).toBeUndefined()
    expect(await readServerSecret({}, {})).toBeUndefined()
  })

  it.each(['', '\n', '\r\n'])(
    'reads a file with a %j terminator, preserving spaces',
    async (ending) => {
      await fs.writeFile(secretFile, ` secret with spaces ${ending}`)
      expect(await readServerSecret({ secretFile }, {})).toBe(
        ' secret with spaces ',
      )
    },
  )

  it('reads the environment secret file again after rotation', async () => {
    const env = {
      FAVACLI_SYNC_SERVER_URL: 'wss://sync.example.com/sync',
      FAVACLI_SYNC_SERVER_SECRET_FILE: secretFile,
    }
    await fs.writeFile(secretFile, 'first-secret\n')
    expect(await readSyncServerConfig(env)).toEqual({
      serverUrl: env.FAVACLI_SYNC_SERVER_URL,
      serverSecret: 'first-secret',
    })
    await fs.writeFile(secretFile, 'rotated-secret\n')
    expect((await readSyncServerConfig(env))?.serverSecret).toBe(
      'rotated-secret',
    )
  })

  it('accepts a secret supplied directly through the environment', async () => {
    expect(
      await readSyncServerConfig({
        FAVACLI_SYNC_SERVER_URL: 'ws://localhost:8080',
        FAVACLI_SYNC_SERVER_SECRET: 'env-secret',
      }),
    ).toEqual({ serverUrl: 'ws://localhost:8080', serverSecret: 'env-secret' })
  })

  it('prefers the explicit file over either environment secret source', async () => {
    const env = {
      FAVACLI_SYNC_SERVER_SECRET: 'env-secret',
      FAVACLI_SYNC_SERVER_SECRET_FILE: '/missing',
    }
    await fs.writeFile(secretFile, 'file-secret')
    expect(await readServerSecret({ secretFile }, env)).toBe('file-secret')
  })

  it('rejects conflicting environment sources without revealing the secret', async () => {
    await expect(
      readServerSecret(
        {},
        {
          FAVACLI_SYNC_SERVER_SECRET: 'sensitive',
          FAVACLI_SYNC_SERVER_SECRET_FILE: secretFile,
        },
      ),
    ).rejects.toThrow(
      'Set only one of FAVACLI_SYNC_SERVER_SECRET and FAVACLI_SYNC_SERVER_SECRET_FILE',
    )
  })

  it('rejects empty and unreadable files rather than prompting or falling back', async () => {
    await expect(readServerSecret({ secretFile }, {})).rejects.toThrow(
      'Could not read the server secret file',
    )
    await fs.writeFile(secretFile, '\n')
    await expect(readServerSecret({ secretFile }, {})).rejects.toThrow(
      'The server secret is empty',
    )
    await expect(
      readServerSecret({}, { FAVACLI_SYNC_SERVER_SECRET: '' }),
    ).rejects.toThrow('The server secret is empty')
    await expect(readServerSecret({ secretFile: '' }, {})).rejects.toThrow(
      'The server secret file path is empty',
    )
  })

  it.each([
    { FAVACLI_SYNC_SERVER_URL: 'wss://sync.example.com' },
    { FAVACLI_SYNC_SERVER_SECRET: 'secret' },
    { FAVACLI_SYNC_SERVER_SECRET_FILE: '/missing' },
    { FAVACLI_SYNC_SERVER_URL: '', FAVACLI_SYNC_SERVER_SECRET: 'secret' },
  ])('rejects incomplete environment configuration: %j', async (env) => {
    await expect(readSyncServerConfig(env)).rejects.toThrow(
      'Set FAVACLI_SYNC_SERVER_URL together with',
    )
  })

  it.each([
    'not a url',
    'https://sync.example.com',
    'wss://sync.example.com/#fragment',
  ])('rejects invalid WebSocket URL %s', async (serverUrl) => {
    await expect(
      readSyncServerConfig({
        FAVACLI_SYNC_SERVER_URL: serverUrl,
        FAVACLI_SYNC_SERVER_SECRET: 'secret',
      }),
    ).rejects.toThrow('FAVACLI_SYNC_SERVER_URL must be a ws:// or wss:// URL')
  })
})
