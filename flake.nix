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

        favacli = pkgs.buildNpmPackage (finalAttrs: {
          pname = "favacli";
          version = "0.0.22";

          src = ./.;

          npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          # Don't use npmWorkspace / built-in install: the default install
          # copies node_modules including relative symlinks to workspace dirs
          # that aren't in $out, leaving dangling links. Install manually
          # (see installPhase below).
          dontNpmInstall = true;

          npmFlags = [ "--ignore-scripts" ];

          nativeBuildInputs = [
            pkgs.nodejs_20
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

            npm rebuild --no-save keytar bufferutil

            ( cd packages/types && npx --no-install tsc --project tsconfig.build.json )
            ( cd packages/server && npx --no-install tsc --project tsconfig.build.json )
            ( cd packages/lib && npx --no-install tsc --project tsconfig.build.json )
          '';

          buildPhase = ''
            runHook preBuild
            ( cd packages/app-cli && npx --no-install tsc --project tsconfig.build.json )
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
              npm ls --omit=dev --all --parseable --workspace packages/app-cli \
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
      in
      {
        packages.default = favacli;
        packages.favacli = favacli;
      });
}
