INSTALL_DEPS:=node_modules ../jpake/build
SRC_FILES:=$(shell find src/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	npx tsc --project ./tsconfig.build.json
	@if [ -e node_modules ]; then touch node_modules; fi

../jpake/build:
	$(MAKE) -C ../jpake build

node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	@touch node_modules

clean:
	rm -rf build *.tsbuildinfo

test: $(INSTALL_DEPS)
	npx vitest

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

.PHONY: clean lint test all
