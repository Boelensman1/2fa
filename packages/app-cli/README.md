# app-cli

CLI app for 2falib

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/app-cli.svg)](https://npmjs.org/package/app-cli)
[![Downloads/week](https://img.shields.io/npm/dw/app-cli.svg)](https://npmjs.org/package/app-cli)

<!-- toc -->
* [app-cli](#app-cli)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Usage

<!-- usage -->
```sh-session
$ npm install -g 2falib-cli
$ twofa-cli COMMAND
running command...
$ twofa-cli (--version)
2falib-cli/0.0.0 darwin-arm64 node-v20.17.0
$ twofa-cli --help [COMMAND]
USAGE
  $ twofa-cli COMMAND
...
```
<!-- usagestop -->

# Commands

<!-- commands -->
* [`twofa-cli entries add`](#twofa-cli-entries-add)
* [`twofa-cli entries get-token ID`](#twofa-cli-entries-get-token-id)
* [`twofa-cli entries list`](#twofa-cli-entries-list)
* [`twofa-cli entries search QUERY`](#twofa-cli-entries-search-query)
* [`twofa-cli help [COMMAND]`](#twofa-cli-help-command)
* [`twofa-cli vault create`](#twofa-cli-vault-create)

## `twofa-cli entries add`

Add an entry to the vault

```
USAGE
  $ twofa-cli entries add -n <value> -s <value> -i <value> [-d <value>] [-a SHA-1|SHA-256|SHA-512] [-p <value>]

FLAGS
  -a, --algorithm=<option>  [default: SHA-1] hash algorithm (SHA-1, SHA-256, SHA-512)
                            <options: SHA-1|SHA-256|SHA-512>
  -d, --digits=<value>      [default: 6] number of digits in TOTP code
  -i, --issuer=<value>      (required) issuer of the TOTP token
  -n, --name=<value>        (required) name
  -p, --period=<value>      [default: 30] time period in seconds for TOTP code refresh
  -s, --secret=<value>      (required) TOTP secret

DESCRIPTION
  Add an entry to the vault

EXAMPLES
  $ twofa-cli entries add
```

_See code: [src/commands/entries/add.ts](https://github.com/boelensman1/2fa/blob/v0.0.0/src/commands/entries/add.ts)_

## `twofa-cli entries get-token ID`

Get a 2FA token for a specific entry

```
USAGE
  $ twofa-cli entries get-token ID [--json]

ARGUMENTS
  ID  ID of the entry to get token for

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Get a 2FA token for a specific entry

EXAMPLES
  $ twofa-cli entries get-token "entry-id-here"
```

_See code: [src/commands/entries/get-token.ts](https://github.com/boelensman1/2fa/blob/v0.0.0/src/commands/entries/get-token.ts)_

## `twofa-cli entries list`

Add an entry to the vault

```
USAGE
  $ twofa-cli entries list [--json]

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Add an entry to the vault

EXAMPLES
  $ twofa-cli entries list
```

_See code: [src/commands/entries/list.ts](https://github.com/boelensman1/2fa/blob/v0.0.0/src/commands/entries/list.ts)_

## `twofa-cli entries search QUERY`

Search for entries in the vault

```
USAGE
  $ twofa-cli entries search QUERY [--json] [--with-tokens]

ARGUMENTS
  QUERY  Search across name and issuer

FLAGS
  --with-tokens  Include current TOTP tokens in the output

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Search for entries in the vault

EXAMPLES
  $ twofa-cli entries search "Google"
```

_See code: [src/commands/entries/search.ts](https://github.com/boelensman1/2fa/blob/v0.0.0/src/commands/entries/search.ts)_

## `twofa-cli help [COMMAND]`

Display help for twofa-cli.

```
USAGE
  $ twofa-cli help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for twofa-cli.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.16/src/commands/help.ts)_

## `twofa-cli vault create`

Create a new vault

```
USAGE
  $ twofa-cli vault create

DESCRIPTION
  Create a new vault

EXAMPLES
  $ twofa-cli vault create
```

_See code: [src/commands/vault/create.ts](https://github.com/boelensman1/2fa/blob/v0.0.0/src/commands/vault/create.ts)_
<!-- commandsstop -->
