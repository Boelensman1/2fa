INSTALL_DEPS=node_modules
SRC_FILES=$(shell find src/)

node_modules: package.json ../../package-lock.json
	$(MAKE) -C ../.. node_modules
	touch node_modules

clean:
	rm -rf node_modules

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	npx tsc --project ./tsconfig.build.json
	touch build

test: $(INSTALL_DEPS)
	npx vitest

lint: $(INSTALL_DEPS)
	npx --no-install prettier --check --ignore-path=../../.gitignore .
	npx --no-install tsc --noEmit
	npx --no-install eslint

clean:

.PHONY: clean lint test
