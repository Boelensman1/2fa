import CliError from '../CliError.mjs'

/**
 * The keychain service every favacli secret is stored under. One constant
 * because the service name is part of the lookup key: a command that spelled it
 * differently would silently store a second, unreadable entry.
 */
const SERVICE = 'favacli'

/**
 * Linux has two credential stores, and the library's default is to fall back
 * from the Secret Service to the kernel keyring when no Secret Service is
 * running. A vault password kept in the kernel keyring is gone at the next
 * reboot, which is a worse answer than saying so: pinning the store makes an
 * absent Secret Service an error that `vault restore-password` recovers from,
 * rather than a password that works until it does not. Ignored off Linux.
 */
const ENTRY_OPTIONS = { linux: { store: 'secret-service' } } as const

type AsyncEntryConstructor = (typeof import('@napi-rs/keyring'))['AsyncEntry']

let asyncEntry: Promise<AsyncEntryConstructor> | undefined

/**
 * The keychain binding, imported on first use instead of at module load.
 *
 * It is a native module: its binary for each platform is a separate package,
 * pulled in as an optional dependency, so an install that omits optional
 * dependencies -- or one on a platform it has no build for -- leaves nothing to
 * load. Imported at the top of a command module -- which is what every command
 * that touched the keychain used to do with `keytar` -- such a failure happens
 * while main.mjs is still loading the command list, so it takes down every
 * command, `favacli version` included, and prints a node stack trace about a
 * path inside node_modules. Loading it here, when a command actually reaches
 * for the keychain, keeps the rest of the CLI working and turns the failure
 * into a sentence that says what to do about it. favalib loads `canvas` the
 * same way for the same reason.
 * @returns The entry class the keychain is reached through.
 * @throws {CliError} If the binding cannot be loaded.
 */
const loadAsyncEntry = async (): Promise<AsyncEntryConstructor> => {
  asyncEntry ??= import('@napi-rs/keyring').then((module) => module.AsyncEntry)

  try {
    return await asyncEntry
  } catch (err) {
    throw new CliError(
      `The system keychain module (@napi-rs/keyring) could not be loaded: ${
        err instanceof Error ? err.message.split('\n')[0] : String(err)
      }. favacli keeps your vault password in the OS keychain through it, and ` +
        `its binary ships as a per-platform optional dependency. An install ` +
        `made with optional dependencies omitted — "npm install ` +
        `--omit=optional" and the equivalents for other package managers — or ` +
        `one on a platform it has no build for, leaves nothing to load. ` +
        `Install favacli again with optional dependencies enabled.`,
      'KeychainError',
    )
  }
}

/**
 * One keychain entry, ready to read or write.
 * @param account - The account the secret is stored under, e.g. "vault-password".
 * @returns The entry.
 * @throws {CliError} If the binding cannot be loaded.
 */
const entryFor = async (account: string) => {
  const AsyncEntry = await loadAsyncEntry()

  return new AsyncEntry(SERVICE, account, ENTRY_OPTIONS)
}

/**
 * Reads one secret from the system keychain.
 * @param account - The account the secret is stored under, e.g. "vault-password".
 * @returns The secret, or null when the keychain holds no such entry.
 * @throws {CliError} If the binding cannot be loaded.
 */
export const getKeychainPassword = async (
  account: string,
): Promise<string | null> => {
  const entry = await entryFor(account)

  return (await entry.getPassword()) ?? null
}

/**
 * Writes one secret to the system keychain, replacing any entry already there.
 * @param account - The account to store the secret under, e.g. "vault-password".
 * @param password - The secret.
 * @returns Nothing, once the keychain has taken it.
 * @throws {CliError} If the binding cannot be loaded.
 */
export const setKeychainPassword = async (
  account: string,
  password: string,
): Promise<void> => (await entryFor(account)).setPassword(password)
