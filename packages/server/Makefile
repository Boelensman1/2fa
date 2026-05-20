INSTALL_DEPS=node_modules ../types/build
SRC_FILES:=$(shell find src/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build *.tsbuildinfo # TODO: find out why this is needed
	pnpm exec tsc --project ./tsconfig.build.json
	@touch build

../types/build:
	$(MAKE) -C ../types build

dev: $(INSTALL_DEPS)
	pnpm exec tsx --watch ./src/server.mts


node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

clean:
	rm -rf node_modules

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

.PHONY: clean lint test test-watch all dev migrate-latest migrate-rollback
