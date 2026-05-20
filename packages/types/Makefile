INSTALL_DEPS:=node_modules
SRC_FILES:=$(shell find src/)

build: $(INSTALL_DEPS) $(SRC_FILES) tsconfig.json tsconfig.build.json
	rm -rf build *.tsbuildinfo # TODO: find out why this is needed
	pnpm exec tsc --project ./tsconfig.build.json
	@if [ -e node_modules ]; then touch node_modules; fi

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	mkdir -p node_modules # pnpm (hoisted) creates no local node_modules for this deps-light package
	@touch node_modules

clean:
	rm -rf build *.tsbuildinfo

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore .
	pnpm exec tsc --noEmit

test:
	@echo no tests defined

.PHONY: clean lint test all
