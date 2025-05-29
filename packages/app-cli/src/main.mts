#!/usr/bin/env node
import { Cli, Builtins } from 'clipanion'

import VaultCreateCommand from './commands/vault/create.mjs'
import VaultDeleteCommand from './commands/vault/delete.mjs'
import EntriesAddCommand from './commands/entries/add.mjs'
import EntriesListCommand from './commands/entries/list.mjs'
import EntriesSearchCommand from './commands/entries/search.mjs'
import SyncSetServerUrlCommand from './commands/sync/setServerUrl.mjs'
import SyncConnect from './commands/sync/connect.mjs'
import SyncResilver from './commands/sync/resilver.mjs'
import SyncListDevices from './commands/sync/listDevices.mjs'
import SyncSetFriendlyNameCommand from './commands/sync/setFriendlyName.mjs'
import ExportTextCommand from './commands/export/text.mjs'

// check node version
const nodeRuntimeMajorVersion = parseInt(process.version.split('.')[0])
if (nodeRuntimeMajorVersion < 20) {
  throw new Error('Node.js version must be 20 or higher')
}

const [, , ...args] = process.argv

const cli = new Cli({
  binaryLabel: 'FavaCli',
  binaryName: `favacli`,
  binaryVersion: '0.0.17',
})

cli.register(VaultCreateCommand)
cli.register(VaultDeleteCommand)
cli.register(EntriesAddCommand)
cli.register(EntriesListCommand)
cli.register(EntriesSearchCommand)
cli.register(SyncSetServerUrlCommand)
cli.register(SyncConnect)
cli.register(SyncResilver)
cli.register(SyncListDevices)
cli.register(ExportTextCommand)
cli.register(SyncSetFriendlyNameCommand)

cli.register(Builtins.HelpCommand)

void cli.runExit(args)
