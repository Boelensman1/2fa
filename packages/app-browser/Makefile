INSTALL_DEPS=node_modules ../lib/build
SRC_FILES=$(shell find src/)

build: $(INSTALL_DEPS) $(SRC_FILES)
	pnpm exec tsc
	pnpm exec vite build

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

../lib/build:
	$(MAKE) -C ../lib build

dev: $(INSTALL_DEPS)
	pnpm exec vite

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore .
	pnpm exec tsc --noEmit
	pnpm exec eslint

preview: dist $(INSTALL_DEPS)
	pnpm exec vite preview

test:
	@echo no tests defined

clean:

.PHONY: dev lint preview ../lib/build
