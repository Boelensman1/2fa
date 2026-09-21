{ pkgs, lib, ... }:

let
  # The sync server refuses any socket that cannot prove this value, and
  # packages/app-browser prefills its sync-server form with it so the container
  # is usable without anyone typing it.
  #
  # In the repository on purpose, and useless on purpose: it gates a dev server
  # on loopback inside one container. A real deployment generates its own with
  # `openssl rand -base64 32` and never puts it in a public build - see
  # packages/app-browser/src/parameters.ts, which explains why VITE_DEVSERVERSECRET
  # has DEV in its name.
  devSharedSecret = "dev-only-sync-secret-not-for-real-use";

  # packages/server reads its database settings from packages/server/config
  # through wtfconfig, and ConfigObject.mts requires the whole connection block.
  # That directory is gitignored and the repo has never shipped a default.yaml,
  # so the container supplies the entire thing.
  #
  # wtfconfig loads local.yaml last in every environment and local-test.yaml
  # after it when NODE_ENV=test. Putting the test database in test.yaml instead
  # would not work: local.yaml loads after test.yaml and would drag the test run
  # back onto the dev database.
  serverLocalConfig = pkgs.writeText "fava-server-local.yaml" ''
    database:
      connection:
        host: "127.0.0.1"
        port: 5432
        user: "fava"
        password: ""
        database: "fava"
    sync:
      sharedSecret: "${devSharedSecret}"
  '';

  # Only the database differs for tests. The shared secret comes from local.yaml,
  # which loads first, and the server test suite reads it back from the config
  # rather than hardcoding one.
  serverLocalTestConfig = pkgs.writeText "fava-server-local-test.yaml" ''
    database:
      connection:
        database: "fava_test"
  '';

  # favacli stores the vault password in the OS keychain through
  # @napi-rs/keyring, which on Linux is a Secret Service over D-Bus -- and
  # app-cli pins it to that store rather than let it fall back to the kernel
  # keyring, whose entries do not survive a reboot. The base image has no
  # desktop session, so there is neither a session bus nor a keyring daemon,
  # and every favacli command that touches a vault -- `setup`, `vault create`,
  # and anything that loads one -- dies with "Cannot autolaunch D-Bus without
  # X11 $DISPLAY". The `keyring` dev service below supplies both.
  #
  # The password must not be empty. `gnome-keyring-daemon --unlock` with an
  # empty one starts perfectly happily and then creates no login collection at
  # all, and the failure only surfaces later, in the client, as "Object does not
  # exist at path /org/freedesktop/secrets/collection/login".
  #
  # In the repository on purpose and useless on purpose, like devSharedSecret:
  # it unlocks a keyring inside one dev container, holding dev vault passwords.
  devKeyringPassword = "dev-only-keyring-password-not-for-real-use";

  # Fixed, because the address has to be known before the daemon that serves it
  # starts: environment.variables below hands it to every shell and dev service,
  # and this script binds it. $HOME is expanded by the shell that sources
  # /etc/set-environment, which is why this is not an absolute path.
  keyringDir = "$HOME/.cache/fava-keyring";

  # Two daemons, one service: a private session bus at the fixed address above,
  # and gnome-keyring serving org.freedesktop.secrets on it. The keyring is the
  # main process so the service lives and dies with it; the bus is cleaned up by
  # the trap.
  keyringCommand = pkgs.writeShellScript "fava-keyring" ''
    set -eu
    mkdir -p "${keyringDir}"

    # Exported here as well as in environment.variables, not instead of it: this
    # is the process that has to bind the address, and inheriting it from the
    # login shell would make the service that provides the bus depend on
    # something outside it. gnome-keyring otherwise tries to autolaunch a bus of
    # its own and fails with the very error this service exists to prevent.
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${keyringDir}/bus"

    # A restart finds the old socket still on disk, which stops dbus-daemon
    # binding the address, and possibly the old dbus-daemon still holding it,
    # which would serve a bus whose keyring has gone. Clear both first.
    ${pkgs.procps}/bin/pkill -f "dbus-daemon --session --address=unix:path=${keyringDir}/bus" || true
    rm -f "${keyringDir}/bus"

    ${pkgs.dbus}/bin/dbus-daemon --session \
      --address="unix:path=${keyringDir}/bus" \
      --fork --print-pid > "${keyringDir}/dbus.pid"
    trap 'kill "$(cat "${keyringDir}/dbus.pid")" 2>/dev/null || true' EXIT TERM INT

    # --unlock takes the password on stdin and creates the login keyring on the
    # first run, under $HOME/.local/share/keyrings, so vault passwords survive a
    # restart. If that keyring was ever created with a different password the
    # unlock fails and this service restart-loops: delete the directory to reset.
    printf '%s' '${devKeyringPassword}' |
      ${pkgs.gnome-keyring}/bin/gnome-keyring-daemon \
        --unlock --components=secrets --foreground
  '';

  # pnpm blocks dependency lifecycle scripts by default, and canvas is listed in
  # pnpm-workspace.yaml's allowBuilds, which is what lets its script run. Neither
  # .npmrc has a say: pnpm 11 takes ignore-scripts and node-linker
  # only from pnpm-workspace.yaml (and ~/.config/pnpm/rc), reading .npmrc for
  # registry and auth alone, so the repo's ignore-scripts=false and the base
  # image's ~/.npmrc ignore-scripts=true are both inert here. The scripts either
  # compile through node-gyp or unpack a prebuilt .node, and both want these
  # libraries. The base image ships neither the libraries nor a C toolchain, and
  # nix-ld covers neither case (it only supplies an ELF interpreter for prebuilt
  # executables). Same set as the devShell in flake.nix.
  buildLibs = with pkgs; [
    # canvas
    cairo
    pango
    libpng
    libjpeg
    giflib
    librsvg
    pixman
    libuuid
    glib
  ];

  # What the addons have to find at *load* time, which is deliberately far less
  # than buildLibs. Both arrive as prebuilt binaries, and canvas's prebuilt
  # ships its own cairo/pango/freetype/fontconfig/librsvg/... beside canvas.node
  # with an $ORIGIN rpath. LD_LIBRARY_PATH outranks that rpath, so putting
  # nixpkgs' cairo here makes it shadow the bundled one and canvas then dies on
  # `undefined symbol: FT_Get_Transform` against the bundled freetype. Only what
  # the prebuilts do not bundle belongs here:
  #   canvas -> libuuid.so.1, needed by its bundled fontconfig and librsvg
  #   @napi-rs/keyring -> libgcc_s.so.1; it reaches the Secret Service over
  #   D-Bus, so it needs no libsecret and no glib
  runtimeLibs = with pkgs; [
    libuuid
    stdenv.cc.cc.lib
  ];

  # Kept out of systemPackages: installing both the out and dev outputs of these
  # libraries system-wide collides in the profile, so they are reached through
  # search paths instead.
  pkgConfigPath = lib.makeSearchPathOutput "dev" "lib/pkgconfig" buildLibs;
  libraryPath = lib.makeLibraryPath runtimeLibs;

  nativeEnv = ''
    export PKG_CONFIG_PATH="${pkgConfigPath}''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
    export LD_LIBRARY_PATH="${libraryPath}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${lib.getExe pkgs.chromium}
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  '';
in
{
  milly.project = {
    enable = true;
    name = "2fa";

    source.git = {
      url = "https://github.com/Boelensman1/2fa.git";
      ref = "main";
    };

    packages = with pkgs; [
      pkg-config
      stdenv.cc # node-gyp needs a C/C++ toolchain; the base image has none
      postgresql_17 # psql/createdb for setup.command
      zip # packages/app-extension: the firefox source-upload zip target
      chromium # browser E2E tests use this instead of Playwright's download
      gnome-keyring # the Secret Service favacli uses; see the keyring service
    ];

    node.enable = true;

    # node.install runs from a generated script under millyd, not a login shell,
    # so it does not pick up /etc/profile. This is where the native addons are
    # built, so the exports have to be inline.
    node.install.command = ''
      ${nativeEnv}
      pnpm install --frozen-lockfile
    '';

    # The role defaults to the database name. Both are set explicitly rather than
    # inherited from milly.project.name, because "2fa" leads with a digit and
    # would need quoting in every hand-written psql or createdb call.
    postgresql = {
      enable = true;
      database = "fava";
      user = "fava";
      createdb = true;
    };

    # Runs from the repo root after checkout, and reruns when the source or this
    # command changes, so every step is idempotent.
    setup.command = ''
      ${nativeEnv}

      install -D -m 0644 ${serverLocalConfig} packages/server/config/local.yaml
      install -D -m 0644 ${serverLocalTestConfig} packages/server/config/local-test.yaml

      # packages/server/test/global-setup.mts runs `knex migrate:latest` under
      # NODE_ENV=test but never issues CREATE DATABASE, so the test database has
      # to exist before `make test`. postgresql.createdb grants the role the
      # CREATEDB it needs for this.
      if ! psql -h 127.0.0.1 -U fava -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = 'fava_test'" | grep -q 1; then
        createdb -h 127.0.0.1 -U fava fava_test
      fi

      make -C packages/server migrate-latest

      # Builds types -> server -> lib through the Makefile dependency chain, so
      # the first `make dev` of either dev service is not stuck compiling the
      # whole workspace.
      make -C packages/lib build
    '';

    devServices = {
      server = {
        command = "make -C packages/server dev";
        ports = [ 8080 ]; # packages/server/src/server.mts: process.env.PORT ?? 8080
        restartOnLogin = true;
      };
      # No ports and no restartOnLogin: nothing connects to it over TCP, and a
      # restart would drop the unlocked keyring for every favacli process still
      # running. It re-unlocks from disk anyway, but there is nothing to gain.
      keyring = {
        command = "${keyringCommand}";
      };
      browser = {
        # VITE_DEVSERVERSECRET only prefills the sync-server form. It is compiled
        # into the bundle, which is exactly why it must never be set for a build
        # that gets served to anyone.
        command = "VITE_DEVSERVERSECRET=${devSharedSecret} make -C packages/app-browser dev";
        ports = [ 3266 ]; # packages/app-browser/vite.config.mts: server.port
        restartOnLogin = true;
      };
    };

    startup.command = ''
      exec claude --dangerously-skip-permissions
    '';
  };

  # NixOS's generated /etc/profile sources /etc/set-environment, /etc/profile.local
  # and /etc/bashrc and nothing else — it never reads /etc/profile.d, so a drop-in
  # there is dead on arrival. environment.variables writes to /etc/set-environment,
  # which the login shell that opens the session exports, so dev services,
  # interactive shells and anything they start (agents, editors, `make test`) all
  # inherit it. The generated setup and install scripts source no profile at all
  # and carry the same exports inline.
  environment.variables = {
    PKG_CONFIG_PATH = pkgConfigPath;
    LD_LIBRARY_PATH = libraryPath;
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = lib.getExe pkgs.chromium;
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

    # Points at the bus the keyring dev service binds. $HOME is left for the
    # shell to expand -- /etc/set-environment is sourced, not parsed, and NixOS
    # writes several of its own variables the same way.
    DBUS_SESSION_BUS_ADDRESS = "unix:path=${keyringDir}/bus";
  };

  milly.metadata."preview.port" = "3266";

  milly.claude.enable = true;
  milly.claude.seedConfig = true;
  milly.codex.enable = true;
  milly.codex.seedConfig = true;

  milly.agentGuidance.extraMd = ''
    2fa dev services (`milly service status|logs|restart <name>`):
    - `server` — sync server on ws port 8080, log
      `$HOME/.cache/milly/2fa/dev-services/server.log`
    - `browser` — vite dev server on http port 3266, log
      `$HOME/.cache/milly/2fa/dev-services/browser.log`
    - `keyring` — a session D-Bus plus gnome-keyring, no port

    favacli keeps the vault password in the OS keychain via @napi-rs/keyring,
    which on Linux needs a Secret Service. The `keyring` service provides one and
    `DBUS_SESSION_BUS_ADDRESS` already points at it, so `favacli setup`,
    `vault create` and every command that opens a vault work as they are. If one
    reports "Cannot autolaunch D-Bus without X11 $DISPLAY", that service is
    down; if it reports no collection at `/org/freedesktop/secrets/collection/login`,
    delete `$HOME/.local/share/keyrings` and restart it.

    PostgreSQL runs locally with trust auth over loopback: database `fava`, test
    database `fava_test`, user `fava`, no password. The server's connection
    settings are written to `packages/server/config/local.yaml` (and
    `local-test.yaml`) by milly setup; both are gitignored.

    The sync server refuses any connection that cannot prove `sync.sharedSecret`
    from that same `local.yaml`. In the container it is
    `dev-only-sync-secret-not-for-real-use`, and the browser dev server is
    started with `VITE_DEVSERVERSECRET` set to it, so the app's sync-server form
    comes up prefilled. Without that key nothing in `packages/server` runs at
    all - not the server, not migrations, not the tests.
  '';
}
