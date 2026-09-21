import { describe, expect, it, vi } from 'vitest'

// What an unloadable binding looks like: @napi-rs/keyring's index.js throws
// while it is being evaluated, so the import itself rejects. An install that
// omitted optional dependencies, or one on a platform with no build, leaves
// exactly this. A mock factory that threw would not reproduce it -- vitest
// catches that and substitutes a message about mocking -- so the throw happens
// when the module's contents are read instead.
vi.mock('@napi-rs/keyring', () => ({
  get AsyncEntry(): never {
    throw new Error(
      'Failed to load native binding\n    at Object.<anonymous> (/x/node_modules/@napi-rs/keyring/index.js:1:1)',
    )
  },
}))

describe('the keychain, when its binding cannot be loaded', () => {
  it('reports it as one sentence naming the fix', async () => {
    const { getKeychainPassword } = await import('../src/utils/keychain.mjs')

    const error = await getKeychainPassword('vault-password').then(
      () => undefined,
      (err: unknown) => err as Error,
    )

    expect(error?.name).toBe('KeychainError')
    // the whole report, not a stack: clipanion prints only name and message
    // for an error carrying a `clipanion` property
    expect(error).toHaveProperty('clipanion')
    expect(error?.message).toContain('Failed to load native binding')
    expect(error?.message).toContain('--omit=optional')
    expect(error?.message).not.toContain('at Object.<anonymous>')
  })

  it('leaves the commands that do not open the keychain working', async () => {
    // version is the one a user reaches for when an install looks broken, and
    // it used to die on the keychain too: every command module is imported by
    // main.mts, and five of them imported the keychain library at the top.
    const VersionCommand = await import('../src/commands/version.mjs')

    expect(VersionCommand.default).toBeDefined()
  })
})
