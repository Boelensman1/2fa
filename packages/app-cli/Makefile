INSTALL_DEPS:=node_modules ../lib/build
SRC_FILES:=$(shell find src/)
TEST_FILES:=$(shell find tests/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build dist *.tsbuildinfo # TODO: find out why this is needed
	@if [ -e node_modules ]; then touch node_modules; fi
	pnpm exec tsc --project ./tsconfig.build.json
	chmod +x ./build/main.mjs

../lib/build:
	$(MAKE) -C ../lib build

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	mkdir -p node_modules
	@touch node_modules

clean:
	rm -rf build *.tsbuildinfo

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore .
	pnpm exec tsc --noEmit
	pnpm exec eslint

test: $(INSTALL_DEPS) $(SRC_FILES) $(TEST_FILES)
	pnpm exec vitest --run

publish: build
	pnpm publish

.PHONY: clean lint test test-debug all publish
