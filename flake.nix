{
  description = "favacli - 2FA command-line client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        favacli = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "favacli";
          version = "0.0.27";

          src = ./.;

          # pnpmConfigHook installs deps from this fetched store. Both
          # fetchDeps and the hook force --ignore-scripts, so dependency build
          # scripts never run here; native modules are rebuilt manually in
          # preBuild below (matching the old npmFlags = ["--ignore-scripts"]).
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            pnpm = pkgs.pnpm_10;
            fetcherVersion = 3;
            hash = "sha256-e90fb8DAwug34oPOcK4W5Bww5ZFF1IhT9YuXuDUYR4w=";
          };

          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm_10
            pkgs.pnpmConfigHook
            pkgs.python3
            pkgs.pkg-config
            pkgs.makeWrapper
          ];

          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
            pkgs.libsecret
            pkgs.glib
            pkgs.libuuid
          ];

          preBuild = ''
            # Newer clang rejects the `static_cast<napi_typedarray_type>(-1)`
            # sentinel in keytar's bundled node-addon-api v3. keytar never
            # touches typed-array code, so swap the sentinel for a valid
            # (unused) enum value just to get the header through the compiler.
            find node_modules -path '*node_modules/node-addon-api/napi.h' -print0 \
              | xargs -0 sed -i.bak 's|static_cast<napi_typedarray_type>(-1)|napi_int8_array|g'

            # The build sandbox has no network. Point node-gyp at the Node
            # headers shipped with the nixpkgs Node so it never fetches them
            # from nodejs.org, and force a from-source build so keytar's
            # prebuild-install doesn't try to download a prebuilt binary from
            # GitHub. keytar/bufferutil then compile fully offline.
            export npm_config_nodedir=${pkgs.nodejs_24}
            export npm_config_build_from_source=true

            npm rebuild --no-save keytar bufferutil

            ( cd packages/types && pnpm exec tsc --project tsconfig.build.json )
            ( cd packages/server && pnpm exec tsc --project tsconfig.build.json )
            ( cd packages/lib && pnpm exec tsc --project tsconfig.build.json )
          '';

          buildPhase = ''
            runHook preBuild
            ( cd packages/app-cli && pnpm exec tsc --project tsconfig.build.json )
            chmod +x packages/app-cli/build/main.mjs
            runHook postBuild
          '';

          # Manual install: lay down a self-contained tree under
          # $out/lib/node_modules/favacli with the workspace packages copied
          # in (not symlinked), so nothing dangles.
          installPhase = ''
            runHook preInstall

            root="$out/lib/node_modules/favacli"
            mkdir -p "$root/node_modules"

            cp -r packages/app-cli/build "$root/"
            cp packages/app-cli/package.json "$root/"

            # Copy the workspace packages app-cli depends on (favalib, which in
            # turn pulls in favaserver and favatypes). pnpm symlinks these from
            # the store, so their paths never contain a /node_modules/ segment
            # and they never show up in the allowlist below — copy them here.
            mkdir -p "$root/node_modules/favalib"
            cp packages/lib/package.json "$root/node_modules/favalib/"
            cp -r packages/lib/build "$root/node_modules/favalib/"

            mkdir -p "$root/node_modules/favaserver"
            cp packages/server/package.json "$root/node_modules/favaserver/"
            cp -r packages/server/build "$root/node_modules/favaserver/"

            mkdir -p "$root/node_modules/favatypes"
            cp packages/types/package.json "$root/node_modules/favatypes/"
            cp -r packages/types/build "$root/node_modules/favatypes/"

            # Ship only app-cli's transitive npm closure on top of those.
            # Anything hoisted to node_modules/ purely for other workspaces
            # (browser app's lightningcss, @tailwindcss, ...) or for dev
            # tooling stays out.
            allowlist=$(
              pnpm --filter favacli list --prod --depth Infinity --parseable \
                | grep '/node_modules/' \
                | sed 's|.*/node_modules/||' \
                | awk -F/ '{ if ($1 ~ /^@/) print $1 "/" $2; else print $1 }' \
                | sort -u
            )

            while IFS= read -r name; do
              case "$name" in
                ""|favacli|favabrowser|favalib|favaserver|favatypes) continue ;;
                *)
                  src="node_modules/$name"
                  [ -e "$src" ] || continue
                  mkdir -p "$(dirname "$root/node_modules/$name")"
                  cp -rL "$src" "$root/node_modules/$name"
                  ;;
              esac
            done <<< "$allowlist"

            # Run favacli with the Node it was built against (and, on Linux,
            # with libsecret/glib/libuuid on the loader path). A bare `env
            # node` shebang would instead use whatever Node is on the user's
            # PATH, whose glibc may be older than the one keytar's native deps
            # (libsecret -> libgpg-error) were linked against.
            mkdir -p "$out/bin"
            makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/favacli" \
              --add-flags "$root/build/main.mjs" ${
                pkgs.lib.optionalString pkgs.stdenv.isLinux
                  "--prefix LD_LIBRARY_PATH : ${pkgs.lib.makeLibraryPath [
                    pkgs.libsecret
                    pkgs.glib
                    pkgs.libuuid
                  ]}"
              }

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "favacli 2FA command-line client";
            license = licenses.isc;
            mainProgram = "favacli";
            platforms = platforms.unix;
          };
        });

        devShell = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm_10
            pkg-config
            cairo
            pango
            libpng
            libjpeg
            giflib
            librsvg
            pixman
            python3
          ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            libuuid
            libsecret
            glib
          ];
          # On Darwin the default stdenv now bundles the Apple SDK (Foundation
          # et al.), so the old `darwin.apple_sdk.frameworks.*` inputs — removed
          # from nixpkgs as legacy stubs — are no longer needed here.

          # canvas/keytar load these natively at runtime, so they must be on
          # the loader path inside `nix develop` (e.g. for `make test`).
          env = pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
              pkgs.libuuid
              pkgs.libsecret
              pkgs.glib
            ];
          };
        };
      in
      {
        packages.default = favacli;
        packages.favacli = favacli;
        devShells.default = devShell;
      });
}
