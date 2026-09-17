import fs from 'node:fs/promises'
import type { LoadFavaLibOptions, ServerSecret } from 'favalib'

type Environment = Record<string, string | undefined>

export const readServerSecret = async (
  options: { secret?: string; secretFile?: string } = {},
  env: Environment = process.env,
): Promise<ServerSecret | undefined> => {
  const explicit =
    options.secret !== undefined || options.secretFile !== undefined
  const secret = explicit ? options.secret : env.FAVACLI_SYNC_SERVER_SECRET
  const secretFile = explicit
    ? options.secretFile
    : env.FAVACLI_SYNC_SERVER_SECRET_FILE

  if (secret !== undefined && secretFile !== undefined) {
    throw new Error(
      explicit
        ? 'Use only one of --secret and --secret-file'
        : 'Set only one of FAVACLI_SYNC_SERVER_SECRET and FAVACLI_SYNC_SERVER_SECRET_FILE',
    )
  }

  let value = secret
  if (secretFile !== undefined) {
    if (!secretFile) throw new Error('The server secret file path is empty')
    try {
      // Accept a file written by echo without changing spaces in the secret.
      value = (await fs.readFile(secretFile, 'utf8')).replace(/\r?\n$/, '')
    } catch {
      throw new Error('Could not read the server secret file')
    }
  }
  if (value !== undefined && !value) {
    throw new Error('The server secret is empty')
  }
  return value as ServerSecret | undefined
}

export const readSyncServerConfig = async (
  env: Environment = process.env,
): Promise<LoadFavaLibOptions['syncServer']> => {
  const serverUrl = env.FAVACLI_SYNC_SERVER_URL
  const hasSecret =
    env.FAVACLI_SYNC_SERVER_SECRET !== undefined ||
    env.FAVACLI_SYNC_SERVER_SECRET_FILE !== undefined

  if (serverUrl === undefined && !hasSecret) return undefined
  if (!serverUrl || !hasSecret) {
    throw new Error(
      'Set FAVACLI_SYNC_SERVER_URL together with FAVACLI_SYNC_SERVER_SECRET ' +
        'or FAVACLI_SYNC_SERVER_SECRET_FILE',
    )
  }

  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    throw new Error('FAVACLI_SYNC_SERVER_URL must be a ws:// or wss:// URL')
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.hash) {
    throw new Error(
      'FAVACLI_SYNC_SERVER_URL must be a ws:// or wss:// URL without a fragment',
    )
  }

  const serverSecret = await readServerSecret({}, env)
  if (!serverSecret) throw new Error('A server secret is required')
  return { serverUrl, serverSecret }
}
