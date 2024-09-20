{ system ? builtins.currentSystem, pkgs ? import <nixpkgs> { inherit system; } }:
  pkgs.mkShell {
    nativeBuildInputs = with pkgs.buildPackages; [ pkg-config cairo pango libpng libjpeg giflib librsvg pixman darwin.apple_sdk.frameworks.Foundation python3 ];
}
