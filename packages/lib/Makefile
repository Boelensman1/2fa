INSTALL_DEPS:=node_modules ../types/build ../server/build
SRC_FILES:=$(shell find src/)
TEST_FILES:=$(shell find tests/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build *.tsbuildinfo # TODO: find out why this is needed
	pnpm exec tsc --project ./tsconfig.build.json
	@if [ -e node_modules ]; then touch node_modules; fi

../types/build:
	$(MAKE) -C ../types build

../server/build:
	$(MAKE) -C ../server build

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	@touch node_modules

clean:
	rm -rf build *.tsbuildinfo

test: $(INSTALL_DEPS)
	pnpm exec vitest --run

test-watch: $(INSTALL_DEPS)
	pnpm exec vitest

test-debug: $(INSTALL_DEPS)
	pnpm exec vitest --run --inspect-brk --no-file-parallelism --test-timeout 99999999

coverage: $(INSTALL_DEPS) $(SRC_FILES) $(TEST_FILES)
	CI=1 pnpm exec vitest --coverage --coverage.exclude=build --coverage.exclude=tests --coverage.exclude=__mocks__

docs: $(INSTALL_DEPS) $(SRC_FILES) typedoc.json
	pnpm exec typedoc

docs-serve: docs
	@echo "Serving documentation at http://localhost:8485"
	@echo "Press Ctrl+C to stop the server"
	python3 -m http.server 8485 --directory docs

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore .
	pnpm exec tsc --noEmit
	pnpm exec eslint

publish: build
	pnpm publish

.PHONY: clean lint test test-debug docs docs-serve all publish
