# favacli

## Installing

```sh
npm install -g favacli     # or pnpm add -g favacli, or yarn global add favacli
```

No build step and no install script: favacli reaches the OS keychain through
[@napi-rs/keyring](https://www.npmjs.com/package/@napi-rs/keyring), which ships
a prebuilt binary for each platform as an optional dependency. Installing with
optional dependencies omitted (`npm install --omit=optional` and its
equivalents) leaves nothing to load, and every command that opens the keychain
then says so.

On Linux the keychain is a Secret Service over D-Bus: a desktop session usually
provides one, and a headless machine needs gnome-keyring or KWallet running.
favacli asks for that store by name rather than falling back to the kernel
keyring, where a stored password would not survive a reboot.

### Upgrading from 0.1.3 or earlier

Those versions stored the vault password through `keytar`, which keys its Linux
keychain entries differently. On Linux the password already on this device will
not be found; store it again with:

```sh
favacli vault restore-password
```

Your vault file is untouched. On macOS both libraries key their entries by
service and account, so the stored password should be found as it is; run the
command above if a favacli command reports that it is not.

## Getting started

```sh
favacli setup
```

One guided run: it asks for a vault password, then whether to connect to a sync
server, and then whether to import an existing vault from another device. Say
no at either question and you are left with a working local vault; the sync
commands below pick up from there.

Importing an existing vault from another device needs a connection string from
the device that already holds it: run `favacli sync add-device` there, or use the
browser app's Add Device screen. Both devices must point at the same sync server.

`setup` refuses to run when a vault already exists, so it cannot replace one
that holds entries. On an existing vault, use `sync setServerUrl` and
`sync connect` directly, or `vault delete` first to start over.

## Importing text exports

Create a local vault with `favacli setup` or `favacli vault create`, then import
an export into it:

```sh
favacli import text --path backup.txt
favacli import text --path backup.asc --password-file /run/secrets/export-password
```

The importer accepts `otpauth://` text exports, including Fava's version header
and older exports without one. Password-encrypted OpenPGP exports are detected
automatically. Without `--password-file`, encrypted imports prompt for a masked
password in an interactive terminal; unattended imports must use a password
file. The export password can differ from your local vault password, and is
never stored. Password files are UTF-8; one final LF or CRLF is removed and all
other whitespace is preserved.

Valid lines are appended to the current vault, even if other lines fail. The
command reports counts and failed file line numbers, and exits nonzero if any
line failed. Repeating an import adds entries again. Wrong passwords and
decryption failures import nothing. Empty exports succeed with zero entries.

Use `--format json` for counts and per-line results (with one-based file line
numbers), or `--no-sync` to keep the import local until the next sync. Saved vault
JSON files and HTML exports are not text entry exports.

## Sending a vault to another device

On the device that already has the entries:

```sh
favacli sync add-device
```

This displays a connection string and a terminal QR code. On the receiving CLI,
create a local vault, configure the same sync server and secret, and run
`favacli sync connect`. In the browser, use Connect to Existing Vault and paste
the text or a QR image. Pairing does not share the sender's vault password or
sync server secret.

Keep the sender running until pairing finishes. It reports the receiving
device's fingerprint after sending the vault and saving enrollment locally;
this is not an acknowledgment that the receiver finished importing. A terminal
about 100 columns wide is usually needed for the QR code. Use `--no-qr` for text
only, and `--timeout 600` to wait up to ten minutes instead of the default five.
Ctrl-C cancels with exit status 130; timeout, disconnect, and pairing failures
exit nonzero. Run the command again to generate a fresh code after a failure.

With `--format json`, pairing codes and instructions appear immediately on
stderr, while stdout contains only the final result. Treat the pairing code as
a temporary secret: anyone holding it and access to the sync server can join.

## Sync configuration

For automatic configuration, provide the URL and a secret source in the
environment. No `sync setServerUrl` command is needed:

```sh
export FAVACLI_SYNC_SERVER_URL=wss://sync.example.com/sync
export FAVACLI_SYNC_SERVER_SECRET_FILE=/run/secrets/fava-sync
favacli sync status
```

`FAVACLI_SYNC_SERVER_SECRET` can supply the secret directly instead of a file.
Set exactly one secret source, together with the URL. Incomplete configuration,
empty secrets, and unreadable files produce an error instead of falling back to
stored credentials or prompting. A file is read as UTF-8 on each vault load;
one trailing LF or CRLF is removed, and other whitespace is preserved.

Environment settings override the vault's saved connection settings before
connecting. Existing paired devices and queued changes are preserved, including
when rotating a secret or moving the same sync service to another URL. Normal
sync intervals and `--no-sync` still apply. The effective URL and secret are
included in subsequent encrypted vault saves; removing the environment settings
returns to the last saved values. The secret is never printed by `sync status`
or included in a vault sent to a peer.

Create or restore your local vault and its keychain password as usual. Runtime
sync settings apply when a command opens that vault; they do not create it or
pair it with another device.

## Nix / Home Manager

With favacli installed, configure
[`home.sessionVariables`](https://nix-community.github.io/home-manager/options/home-manager/home.html):

```nix
home.sessionVariables = {
  FAVACLI_SYNC_SERVER_URL = "wss://sync.example.com/sync";
  FAVACLI_SYNC_SERVER_SECRET_FILE = "/run/secrets/fava-sync";
};
```

Use a quoted runtime path to the secret file supplied by your secret manager,
readable by the user running favacli. Keep its contents out of the Nix expression;
favacli reads the file at runtime. Start a new login session to pick up changes
to Home Manager's session variables. Replacing the file's contents takes effect
on the next vault load without reapplying the settings to the vault.

## One-time setup

`favacli setup` walks through this interactively. To store the settings in the
vault explicitly instead:

```sh
favacli sync setServerUrl wss://sync.example.com/sync \
  --secret-file /run/secrets/fava-sync
```

The secret cannot be given as a command line argument; `--secret-file` is the
only explicit source and takes precedence over the secret environment
variables. Without it, the command uses an environment secret source, or else
prompts for the secret, masked, the way `vault create` asks for a vault
password. It connects directly to the URL given on the command line. Later
commands still prefer runtime environment settings when present.

## Security notes

Prefer the secret-file option for Nix configuration. Keep only its runtime path
in Nix: plaintext secrets embedded in derivations can enter the
[store, which is readable by all local users](https://nix.dev/manual/nix/2.34/store/secrets).
Give the runtime file restrictive permissions (for example, `0400` or `0600`,
owned by the user running favacli), or configure equivalent access in your
secret manager. favacli does not enforce file permissions. The direct secret
environment variable remains available, but may expose the value through
process environments and shell history; there is no command line option for
the secret itself, since arguments are visible in process listings.

The secret controls access to the sync service; it is separate from the vault
password and device encryption keys. Knowing it alone does not decrypt a vault,
but does allow access to the service. Use a random secret, such as one generated
with `openssl rand -base64 32`, and deploy the matching value to the server and
clients. The client sends an HMAC-SHA256 proof over a per-connection challenge,
not the secret itself. This does not replace TLS:
[use `wss://` for remote servers](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

The secret exists in process memory and is included in encrypted vault saves.
Older vault backups can retain an old secret after rotation. Removing an
environment variable or deleting the runtime file does not erase those copies;
rotate the server's secret to invalidate the old value for new connections.
