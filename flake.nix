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
          version = "0.0.23";

          src = ./.;

          # pnpmConfigHook installs deps from this fetched store. Both
          # fetchDeps and the hook force --ignore-scripts, so dependency build
          # scripts never run here; native modules are rebuilt manually in
          # preBuild below (matching the old npmFlags = ["--ignore-scripts"]).
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            pnpm = pkgs.pnpm_10;
            fetcherVersion = 3;
            hash = "sha256-p+UWfoGs8FsLo83EevnpyDcT19CBxKmwYCIMzzsoVWg=";
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

            # Ship only app-cli's transitive runtime closure. Anything hoisted
            # to node_modules/ purely for other workspaces (browser app's
            # lightningcss, @tailwindcss, ...) or for dev tooling stays out.
            allowlist=$(
              pnpm --filter favacli list --prod --depth Infinity --parseable \
                | grep '/node_modules/' \
                | sed 's|.*/node_modules/||' \
                | awk -F/ '{ if ($1 ~ /^@/) print $1 "/" $2; else print $1 }' \
                | sort -u
            )

            while IFS= read -r name; do
              case "$name" in
                ""|favacli|favabrowser) continue ;;
                favalib)
                  mkdir -p "$root/node_modules/favalib"
                  cp packages/lib/package.json "$root/node_modules/favalib/"
                  cp -r packages/lib/build "$root/node_modules/favalib/"
                  ;;
                favaserver)
                  mkdir -p "$root/node_modules/favaserver"
                  cp packages/server/package.json "$root/node_modules/favaserver/"
                  cp -r packages/server/build "$root/node_modules/favaserver/"
                  ;;
                favatypes)
                  mkdir -p "$root/node_modules/favatypes"
                  cp packages/types/package.json "$root/node_modules/favatypes/"
                  cp -r packages/types/build "$root/node_modules/favatypes/"
                  ;;
                *)
                  src="node_modules/$name"
                  [ -e "$src" ] || continue
                  mkdir -p "$(dirname "$root/node_modules/$name")"
                  cp -rL "$src" "$root/node_modules/$name"
                  ;;
              esac
            done <<< "$allowlist"

            mkdir -p "$out/bin"
            ln -s "$root/build/main.mjs" "$out/bin/favacli"

            runHook postInstall
          '';

          postFixup = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            wrapProgram $out/bin/favacli \
              --prefix LD_LIBRARY_PATH : ${pkgs.lib.makeLibraryPath [
                pkgs.libsecret
                pkgs.glib
                pkgs.libuuid
              ]}
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
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            darwin.apple_sdk.frameworks.Foundation
          ];

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
