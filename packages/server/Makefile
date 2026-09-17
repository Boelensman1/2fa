INSTALL_DEPS:=node_modules ../lib/build
SRC_FILES:=$(shell find src/)

include ../deps.mk

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build *.tsbuildinfo # TODO: find out why this is needed
	pnpm exec tsc --project ./tsconfig.build.json
	@touch build

dev: $(INSTALL_DEPS)
	pnpm exec tsx --watch ./src/server.mts

# Production: plain node on the compiled output, no tsx and no watcher. The
# `build` prerequisite is the directory rule above, so this recompiles when the
# sources (or ../lib/build) are newer. It runs from this directory because
# src/config.mts resolves `config/` relative to the working directory. Migrating
# the database is a separate step - run `make migrate-latest` first.
run: build
	NODE_ENV=production node ./build/src/server.mjs


node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

clean:
	rm -rf build *.tsbuildinfo

test: $(INSTALL_DEPS)
	pnpm exec vitest run

test-watch: $(INSTALL_DEPS)
	pnpm exec vitest

migrate-latest: $(INSTALL_DEPS)
	NODE_OPTIONS='--import tsx/esm' pnpm exec knex migrate:latest

migrate-rollback: $(INSTALL_DEPS)
	NODE_OPTIONS='--import tsx/esm' pnpm exec knex migrate:rollback

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore .
	pnpm exec tsc --noEmit
	pnpm exec eslint

.PHONY: clean lint test test-watch all dev run migrate-latest migrate-rollback
