INSTALL_DEPS:=node_modules ../server/build
SRC_FILES:=$(shell find src/)
TEST_FILES:=$(shell find tests/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build *.tsbuildinfo # TODO: find out why this is needed
	npx --no-install tsc --project ./tsconfig.build.json
	@if [ -e node_modules ]; then touch node_modules; fi

../server/build:
	$(MAKE) -C ../server build

node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	@touch node_modules

clean:
	rm -rf build *.tsbuildinfo

test: $(INSTALL_DEPS)
	npx --no-install vitest --run

test-watch: $(INSTALL_DEPS)
	npx --no-install vitest

test-debug: $(INSTALL_DEPS)
	npx --no-install vitest --run --inspect-brk --no-file-parallelism --test-timeout 99999999

coverage: $(INSTALL_DEPS) $(SRC_FILES) $(TEST_FILES)
	CI=1 npx --no-install vitest --coverage --coverage.exclude=build --coverage.exclude=tests --coverage.exclude=__mocks__

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

publish: build
	npm publish

.PHONY: clean lint test test-debug all publish
