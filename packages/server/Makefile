INSTALL_DEPS:=node_modules
SRC_FILES:=$(shell find src/)


build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build *.tsbuildinfo # TODO: find out why this is needed
	npx tsc --project ./tsconfig.build.json
	@touch build

dev: $(INSTALL_DEPS)
	npx --no-install tsx --watch ./src/server.mts


node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

clean:
	rm -rf node_modules

test: $(INSTALL_DEPS)
	# npx vitest

migrate-latest: $(INSTALL_DEPS)
	NODE_OPTIONS='--import tsx/esm' npx --no-install knex --knexfile ./knexfile.json migrate:latest

migrate-rollback: $(INSTALL_DEPS)
	NODE_OPTIONS='--import tsx/esm' npx --no-install knex --knexfile ./knexfile.json migrate:rollback

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

.PHONY: clean lint test all dev migrate-latest migrate-rollback
