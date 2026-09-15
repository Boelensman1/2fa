# Cross-package build rules, shared by every package Makefile.
#
# A package that consumes another package's build output declares that output
# as a prerequisite, e.g. `INSTALL_DEPS:=node_modules ../lib/build`. The
# rules below rebuild that output when it is missing *or* out of date.
#
# The prerequisites matter: a bare `../lib/build:` rule with no
# prerequisites only ever fires when the directory is absent, so a build left
# over from older sources is reused forever. Nothing fails loudly when that
# happens - `tsc` and eslint just resolve the stale .d.mts files, and the
# errors surface as unresolved ("error typed") values in the *consuming*
# package.
#
# Build order is lib -> {server, app-cli, app-browser, app-extension}. Each
# rule takes the upstream build directory as a prerequisite as well as its own
# sources, so staleness propagates down the whole chain: touching
# packages/lib/src rebuilds server and the apps too.
#
# Paths are relative to the including Makefile, which is always
# packages/<name>/Makefile. The guards skip the rule for the package doing the
# including, so packages/lib does not get a second rule for its own build.

CURRENT_PACKAGE:=$(notdir $(CURDIR))

LIB_BUILD_DEPS:=$(shell find ../lib/src) ../lib/tsconfig.json ../lib/tsconfig.build.json
SERVER_BUILD_DEPS:=$(shell find ../server/src) ../server/tsconfig.json ../server/tsconfig.build.json

ifneq ($(CURRENT_PACKAGE),lib)
../lib/build: $(LIB_BUILD_DEPS)
	$(MAKE) -C ../lib build
endif

ifneq ($(CURRENT_PACKAGE),server)
../server/build: ../lib/build $(SERVER_BUILD_DEPS)
	$(MAKE) -C ../server build
endif
