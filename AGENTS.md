# 2fa

A 2FA (TOTP) client suite: a core library, a WebSocket sync server, a CLI, and a
browser PWA, in one pnpm workspace.

## Layout

| Package | npm name | What it is |
| --- | --- | --- |
| `packages/types` | `favatypes` | Shared types, no dependencies |
| `packages/server` | `favaserver` | WebSocket sync server; `ws` + knex/objection on PostgreSQL |
| `packages/lib` | `favalib` | Vault/crypto core; openpgp, node-forge, jpake, canvas, qrcode |
| `packages/app-cli` | `favacli` | Clipanion CLI; stores secrets with keytar |
| `packages/app-browser` | `favabrowser` | SolidJS + Vite PWA |

Build order is `types -> server -> lib -> {app-cli, app-browser}`. The per-package
Makefiles encode it, so building a leaf builds what it needs.

## Commands

Make is the interface; the Makefiles wrap `pnpm exec` and own the dependency
graph. Prefer them over calling `pnpm exec` or `vitest` directly.

- Root: `make build`, `make lint`, `make test`, `make clean` — each fans out over
  every package.
- Per package: `make -C packages/<name> build|lint|test`.
- `make lint` is `prettier --check` + `tsc --noEmit` + `eslint`. Run it, and
  `make test`, before considering a change done.
- Server migrations: `make -C packages/server migrate-latest` / `migrate-rollback`.
- `packages/lib` also has `test-watch`, `test-debug`, `coverage`, and `docs`.

Shared dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`;
reference them from a package as `"<dep>": "catalog:"` rather than pinning twice.

## Running it in this container

`milly.nix` declares two dev services, already running:

| Service | Command | Port |
| --- | --- | --- |
| `server` | `make -C packages/server dev` | 8080 (ws) |
| `browser` | `make -C packages/app-browser dev` | 3266 (http, previewed) |

Manage them with `milly service status`, `milly service logs <name>`, and
`milly service restart <name>` rather than starting or killing them by hand.
Logs are at `$HOME/.cache/milly/2fa/dev-services/<name>.log`.

## Database and server config

PostgreSQL runs locally with trust auth over loopback: user `fava`, database
`fava`, test database `fava_test`, no password.

`packages/server` reads its settings from `packages/server/config/` via
wtfconfig, whose schema (`packages/server/src/types/ConfigObject.mts`) requires
the full `database.connection` block. The repo ships no config — the whole
directory is gitignored apart from a `default.yaml` that has never existed — so
milly's `setup.command` writes:

- `packages/server/config/local.yaml` — the dev connection, loaded last in every
  environment.
- `packages/server/config/local-test.yaml` — overrides the database to
  `fava_test`, loaded after `local.yaml` when `NODE_ENV=test`.

A plain `test.yaml` would not work: `local.yaml` loads after it and would pull the
test run back onto the dev database.

Server tests migrate and roll back `fava_test` themselves
(`packages/server/test/global-setup.mts`) but never create it; milly setup does.
They run with `fileParallelism: false` because they share that one database.

## Container caveats

- pnpm is pinned by `packageManager` in `package.json` and resolved through
  corepack. Its prebuilt glibc binary only runs here because the base image
  enables `nix-ld`.
- The image quarantines newly published npm releases for 7 days
  (`minimumReleaseAge`), so a brand-new dependency version may not install.
- `canvas` and `keytar` are native. The repo `.npmrc` sets `ignore-scripts=false`
  so their install scripts run, and `milly.nix` supplies the toolchain plus
  `PKG_CONFIG_PATH` / `LD_LIBRARY_PATH` for them. Outside the container, use
  `nix develop`, whose devShell does the same.
- `packages/app-browser/vite.config.mts` shells out to `git rev-parse`, so the
  build needs real git history.

## Known limitation: browser sync in the container

`packages/app-browser/src/parameters.ts` defaults the sync server to
`ws://localhost:8080`. Only the preview port (3266) is proxied out of the
container, so in a browser on your own machine `localhost:8080` is *your*
machine, not the container, and the browser app's sync feature will not reach the
container's sync server. The CLI, the server, and all tests are unaffected.
Point `VITE_SYNCSERVERURL` at a reachable URL if you need sync in the preview.
