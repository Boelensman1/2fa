import { Cli } from 'clipanion'

import VaultCreateCommand from './commands/vault/create.mjs'
import EntriesAddCommand from './commands/entries/add.mjs'
import EntriesListCommand from './commands/entries/list.mjs'
import EntriesSearchCommand from './commands/entries/search.mjs'
import SyncSetServerUrlCommand from './commands/sync/setServerUrl.mjs'
import SyncConnect from './commands/sync/connect.mjs'
const [node, app, ...args] = process.argv

const cli = new Cli({
  binaryLabel: `My Application`,
  binaryName: `${node} ${app}`,
  binaryVersion: `1.0.0`,
})
cli.register(VaultCreateCommand)
cli.register(EntriesAddCommand)
cli.register(EntriesListCommand)
cli.register(EntriesSearchCommand)
cli.register(SyncSetServerUrlCommand)
cli.register(SyncConnect)
void cli.runExit(args)
