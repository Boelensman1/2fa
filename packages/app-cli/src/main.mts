#!/usr/bin/env node
import { Cli } from 'clipanion'

import VaultCreateCommand from './commands/vault/create.mjs'
import EntriesAddCommand from './commands/entries/add.mjs'
import EntriesListCommand from './commands/entries/list.mjs'
import EntriesSearchCommand from './commands/entries/search.mjs'
import SyncSetServerUrlCommand from './commands/sync/setServerUrl.mjs'
import SyncConnect from './commands/sync/connect.mjs'

// check node version
const nodeRuntimeMajorVersion = parseInt(process.version.split('.')[0])
if (nodeRuntimeMajorVersion < 20) {
  throw new Error('Node.js version must be 20 or higher')
}

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
