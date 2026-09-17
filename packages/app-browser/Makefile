INSTALL_DEPS=node_modules ../lib/build
SRC_FILES=$(shell find src/)

include ../deps.mk

build: $(INSTALL_DEPS) $(SRC_FILES)
	pnpm exec tsc
	pnpm exec vite build

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

dev: $(INSTALL_DEPS)
	pnpm exec vite

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore .
	pnpm exec tsc --noEmit
	pnpm exec eslint

preview: build $(INSTALL_DEPS)
	pnpm exec vite preview

test: $(INSTALL_DEPS)
	pnpm exec vitest run

test-e2e: $(INSTALL_DEPS)
	pnpm exec playwright test $(E2E_ARGS)

clean:
	rm -rf build *.tsbuildinfo

.PHONY: dev lint preview clean test test-e2e
