INSTALL_DEPS=node_modules
SRC_FILES=$(shell find src/)
TEST_FILES:=$(shell find tests/)

node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

clean:
	rm -rf node_modules coverage build

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	npx tsc --project ./tsconfig.build.json
	@touch build

test: $(INSTALL_DEPS)
	npx vitest

coverage: $(INSTALL_DEPS) $(SRC_FILES) $(TEST_FILES)
	CI=1 npx vitest --coverage --coverage.exclude=build --coverage.exclude=tests --coverage.exclude=__mocks__

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

clean:

.PHONY: clean lint test
