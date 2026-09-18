# Browser E2E tests

The Playwright suite exercises the running app through its UI. Each test gets
a fresh browser context with isolated localStorage. The storage-version tests
load the frozen v1 fixture, which has no sync server configured, so they do not
connect to the sync backend or modify its database.

The import tests use the v2 vault fixture without sync and exercise real
encryption through the web app. `fixtures/export-legacy.txt.pgp` contains one
test entry encrypted with OpenPGP's previous iterated S2K and AEAD settings,
without an export-version marker. Its password is `old` with one space on
each side, deliberately weak to check that import accepts existing export
passwords without trimming or applying current strength requirements.

The pairing tests do open a sync socket -- the app refuses a pairing code
before reading it when there is no server connection, so there is no way to
reach the checks without one. They still write nothing: every payload they
submit is rejected client-side, before any message is sent, so the server only
ever answers the connect handshake with an empty command queue. The `server`
dev service has to be running for them.

## Running

Start the app before running the suite. In Milly it is the managed `browser`
service (`milly service status`, `milly service restart browser`). Elsewhere,
run `make -C packages/app-browser dev` in another terminal.

The Milly image and the Linux `nix develop` shell supply Chromium and configure
Playwright to use it. From the repository root:

```sh
make test-e2e
```

Outside those environments, install Playwright's browser once with
`pnpm --dir packages/app-browser exec playwright install chromium`.
On Darwin, the development shell also uses this Playwright-managed browser.
For an existing Milly session whose image predates the E2E tooling, enter the
updated shell:

```sh
nix develop -c make test-e2e
```

`E2E_BASE_URL` overrides the default `http://127.0.0.1:3266`.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects an existing Chromium binary;
otherwise Playwright uses its installed browser. The runner does not start or
stop app services.

Pass runner options through `E2E_ARGS`, for example:

```sh
make test-e2e E2E_ARGS='vault-v1-refused --headed'
```

Failed runs retain traces and screenshots in `test-results/`. The HTML report
is in `playwright-report/`; both directories are gitignored. `make test` runs
the separate Vitest suite and does not launch these E2E tests.

## Adding tests

Add `*.spec.ts` files here and import `test` and `expect` from `./fixtures`.
The shared fixture fails tests on uncaught browser errors. Use the configured
base URL with `page.goto('/')` and seed only the test's isolated context.
Assert UI behavior with Playwright's waiting assertions instead of sleeps.

Reuse the historical vault fixtures when testing what the app does with an
older stored format; never regenerate them with the current library. Add shared fixtures to `fixtures.ts` as other
flows need them. Browser projects and runner settings live in
`../playwright.config.mts`; see the
[Playwright configuration reference](https://playwright.dev/docs/test-configuration).
