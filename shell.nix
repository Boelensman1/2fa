{ system ? builtins.currentSystem
, pkgs ? import <nixpkgs> { inherit system; }
}:

let
  isLinux = pkgs.stdenv.isLinux;
  isDarwin = pkgs.stdenv.isDarwin;
in
pkgs.mkShell {
  nativeBuildInputs = with pkgs.buildPackages; [
    pkg-config
    cairo
    pango
    libpng
    libjpeg
    giflib
    librsvg
    pixman
    python3
  ] ++ (if isLinux then [
    libuuid
  ] else if isDarwin then [
    darwin.apple_sdk.frameworks.Foundation
  ] else []);

  env = if isLinux then {
    LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [pkgs.libuuid];
  } else {};
}
