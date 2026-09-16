{ pkgs, lib, ... }:

let
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
  '';

  serverLocalTestConfig = pkgs.writeText "fava-server-local-test.yaml" ''
    database:
      connection:
        database: "fava_test"
  '';

  # pnpm blocks dependency lifecycle scripts by default, and canvas and keytar
  # are listed in pnpm-workspace.yaml's allowBuilds, which is what lets theirs
  # run. Neither .npmrc has a say: pnpm 11 takes ignore-scripts and node-linker
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
    # keytar
    libuuid
    libsecret
    glib
  ];

  # What the addons have to find at *load* time, which is deliberately far less
  # than buildLibs. Both currently install as prebuilt binaries, and canvas's
  # prebuilt ships its own cairo/pango/freetype/fontconfig/librsvg/... beside
  # canvas.node with an $ORIGIN rpath. LD_LIBRARY_PATH outranks that rpath, so
  # putting nixpkgs' cairo here makes it shadow the bundled one and canvas then
  # dies on `undefined symbol: FT_Get_Transform` against the bundled freetype.
  # Only what the prebuilts do not bundle belongs here:
  #   canvas -> libuuid.so.1, needed by its bundled fontconfig and librsvg
  #   keytar -> libsecret, glib/gio/gobject, libstdc++
  runtimeLibs = with pkgs; [
    libuuid
    libsecret
    glib
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
      browser = {
        command = "make -C packages/app-browser dev";
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

    PostgreSQL runs locally with trust auth over loopback: database `fava`, test
    database `fava_test`, user `fava`, no password. The server's connection
    settings are written to `packages/server/config/local.yaml` (and
    `local-test.yaml`) by milly setup; both are gitignored.
  '';
}
