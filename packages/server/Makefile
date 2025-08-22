INSTALL_DEPS=node_modules generated/configSchema.json
SRC_FILES:=$(shell find src/)

generated/configSchema.json: node_modules src/types/ConfigObject.mts
	mkdir -p ./generated
	npx --no-install ts-json-schema-generator --path './src/types/ConfigObject.mts' --type 'ConfigObject' --no-type-check > generated/configSchema.json

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
	npx vitest run --poolOptions.forks.singleFork

test-watch: $(INSTALL_DEPS)
	npx vitest --poolOptions.forks.singleFork

migrate-latest: $(INSTALL_DEPS)
	NODE_OPTIONS='--import tsx/esm' npx --no-install knex migrate:latest

migrate-rollback: $(INSTALL_DEPS)
	NODE_OPTIONS='--import tsx/esm' npx --no-install knex migrate:rollback

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

.PHONY: clean lint test test-watch all dev migrate-latest migrate-rollback
