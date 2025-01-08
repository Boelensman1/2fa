INSTALL_DEPS:=node_modules ../lib/build
SRC_FILES:=$(shell find src/)
#TEST_FILES:=$(shell find tests/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build dist *.tsbuildinfo # TODO: find out why this is needed
	@if [ -e node_modules ]; then touch node_modules; fi
	npx tsc --project ./tsconfig.build.json
	chmod +x ./build/main.mjs

../lib/build:
	$(MAKE) -C ../lib build

node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	mkdir -p node_modules
	@touch node_modules

clean:
	rm -rf build *.tsbuildinfo

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

publish: build
	npm publish

.PHONY: clean lint test test-debug all publish
