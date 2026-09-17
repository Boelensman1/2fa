# 2fa

A 2FA (TOTP) client suite: a core library, a WebSocket sync server, a CLI, a
browser PWA and a browser extension, in one pnpm workspace.

## Layout

| Package | npm name | What it is |
| --- | --- | --- |
| `packages/lib` | `favalib` | Vault/crypto core; `@noble/curves` (X25519 + Ed25519), openpgp, jpake, canvas, qrcode. Also owns the shared branded types (`favalib/types`) and the sync wire protocol (`favalib/protocol/*`) |
| `packages/server` | `favaserver` | WebSocket sync server; `ws` + knex/objection on PostgreSQL |
| `packages/app-cli` | `favacli` | Clipanion CLI; stores secrets with keytar |
| `packages/app-browser` | `favabrowser` | SolidJS + Vite PWA |
| `packages/app-extension` | `favabrowserext` | WXT + React MV3 browser extension |

Build order is `lib -> {server, app-cli, app-browser, app-extension}`.
`packages/deps.mk`, included by every package Makefile, encodes it as rules that
rebuild an upstream `build/` when it is missing or older than its sources, so
building or linting a leaf brings the whole chain up to date. A package that
consumes another's output lists it in `INSTALL_DEPS`.

The repo has two flakes, deliberately. The root `flake.nix` builds `favacli`
and the dev shell, and its only inputs are nixpkgs and flake-utils. The Milly
container image lives in `milly2-container/`, because that is what needs the
`milly-base` input — and a flake's inputs are inherited by everything
downstream, so keeping it at the root put the milly2 repo (private),
claude-code, codex and a second nixpkgs into the lock of anyone installing the
CLI, which also meant non-members could not install it at all. Build the image
with `nix build ./milly2-container#nixosConfigurations.container...`; the Mill
backend takes the flake ref per spawn and is pointed at
`...2fa.git?dir=milly2-container`. Keep that input named `milly-base` (the
backend overrides it by name) and keep `src = self.sourceInfo` in its
`flake.nix`: under `?dir=milly2-container`, `self.outPath` is the subdirectory
and only `sourceInfo` is the repo root.

`favalib` and `favacli` are published to npm; `favaserver`, `favabrowser` and
`favabrowserext` are marked `private`. A published package must have no
`workspace:*` dependencies — `pnpm publish` rewrites those to versions that
were never published, and `npm i favalib` then fails to resolve. That is why
the shared branded types and the sync wire protocol live in `favalib` and
`favaserver` imports them back from it, rather than the other way round. For
the same reason, anything appearing in `packages/lib/build/**/*.d.mts` has to
be a real entry in favalib's `dependencies` — that is why `type-fest` is a
dependency rather than a devDependency, even though no runtime code uses it.

Do not give a `../<pkg>/build` rule an empty prerequisite list: make would then
only ever run it when the directory is absent, and a stale build survives. It
fails quietly — `tsc` and eslint resolve the outdated `.d.mts` files and the
errors surface as unresolved ("error typed") values in the consuming package.

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

`milly2-container/milly.nix` declares two dev services, already running:

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
the full `database.connection` block **and `sync.sharedSecret`**, the static
secret a client must prove before the server will act on anything it sends.
Both are required, and `knexfile.ts` imports that config at module load, so a
missing key means no server, no migrations and no test run — not a server with
the gate switched off. The repo ships no config — the whole directory is
gitignored apart from a `default.yaml` that has never existed — so milly's
`setup.command` writes:

- `packages/server/config/local.yaml` — the dev connection and the dev
  `sync.sharedSecret`, loaded last in every environment.
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
  so their install scripts run, and `milly2-container/milly.nix` supplies the
  toolchain plus `PKG_CONFIG_PATH` / `LD_LIBRARY_PATH` for them. Outside the
  container, use `nix develop`, whose devShell does the same.
- `packages/app-browser/vite.config.mts` shells out to `git rev-parse`, so the
  build needs real git history.

## Browser sync in the container

`packages/app-browser/src/parameters.ts` defaults the sync server to `/api/sync`,
a path on whatever origin serves the app, and `vite.config.mts` proxies that path
through to `ws://localhost:8080`. The WebSocket therefore travels over the preview
port (3266) — the only one proxied out of the container — so sync works from a
browser on your own machine without pointing anything at port 8080. Vite falls
back to `server.proxy` for the preview server, so this covers
`make -C packages/app-browser preview` as well as `make -C packages/app-browser dev`.

The sync server refuses any socket that cannot prove `sync.sharedSecret`, so the
app asks for the server address and that secret together and stores both in the
vault — a new vault is created with sync switched off. In the container the
secret is `dev-only-sync-secret-not-for-real-use`.

Three env vars, and only the last one configures anything at runtime.
`VITE_DEVSYNCSERVERURL` and `VITE_DEVSERVERSECRET` **prefill the form** and
nothing more; milly.nix sets the second for the dev service. They have `DEV` in
their names because anything reachable from `import.meta.env` is compiled into
the bundle, and this PWA is meant to be served publicly — setting
`VITE_DEVSERVERSECRET` for a real build publishes the secret to everyone who
loads the app. `SYNC_SERVER_TARGET` changes where the vite proxy forwards to and
is server-side, so it is unaffected.
