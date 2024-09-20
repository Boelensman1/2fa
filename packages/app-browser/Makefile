INSTALL_DEPS=node_modules ../lib/build
SRC_FILES=$(shell find src/)

node_modules: package.json ../../package-lock.json
	(cd ../.. && $(MAKE) node_modules)
	touch node_modules

../lib/build:
	(cd ../lib && $(MAKE) build)

dev: $(INSTALL_DEPS)
	npx --no-install vite

build: $(INSTALL_DEPS) $(SRC_FILES)
	npx --no-install tsc
	npx --no-install vite build

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

preview: dist $(INSTALL_DEPS)
	npx --no-install vite preview

test:
	@echo no tests defined

clean:

.PHONY: dev lint preview ../lib/build
