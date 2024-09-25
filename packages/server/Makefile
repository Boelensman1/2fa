INSTALL_DEPS:=node_modules
SRC_FILES:=$(shell find src/)


build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	npx tsc --project ./tsconfig.build.json
	@touch build

dev: $(INSTALL_DEPS)
	npx --no-install tsx --watch ./src/main.mts


node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	@touch node_modules

clean:
	rm -rf node_modules

test: $(INSTALL_DEPS)
	npx vitest

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

.PHONY: clean lint test all dev
