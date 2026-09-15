{
  description = "2fa Milly container image";

  # Deliberately a separate flake from the repo root. The root flake publishes
  # favacli, which people install by taking this repo as a flake input, and a
  # flake's inputs are inherited by everything downstream. Keeping milly-base
  # here means a CLI consumer's lock stays at nixpkgs + flake-utils instead of
  # also dragging in milly2 (a private repo, so non-members could not install
  # favacli at all), claude-code, codex and a second nixpkgs.
  #
  # The input must keep the name `milly-base`: the Mill backend overrides it by
  # name (--override-input milly-base <pinned>) on whatever flake it evaluates,
  # and that name is global backend config rather than per-repo. The backend
  # takes the flake ref per spawn, so it points at this subdirectory with
  # `?dir=milly2-container`; it rejects path:/file:/./ refs, so that ref stays https/github:.
  inputs.milly-base.url = "git+https://github.com/wtflegal/milly2.git?dir=nix";

  outputs = { self, milly-base, ... }: {
    nixosConfigurations.container = milly-base.lib.mkMillyContainer {
      # self.outPath is this nix/ subdirectory; sourceInfo.outPath is the repo
      # root, which is what milly.project wants baked in as millySource. A
      # `path:..` input would work but is a trap: without `flake = false` it
      # reintroduces the absolute-path pure-eval failure two levels down.
      src = self.sourceInfo;
      module = ./milly.nix;
    };
  };
}
