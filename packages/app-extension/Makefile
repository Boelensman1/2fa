INSTALL_DEPS=node_modules ../lib/build
ENTRYPOINT_FILES=$(shell find entrypoints)

include ../deps.mk

install: $(INSTALL_DEPS)

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	@if [ -e node_modules ]; then touch node_modules; fi

build: dist/chrome

clean:
	rm -rf .output dev-output .wxt artifacts web-ext-artifacts

bump-version:
	pnpm version patch --git-tag-version false

lint: $(INSTALL_DEPS)
	pnpm -s exec prettier . --check
	pnpm -s exec eslint .
	pnpm -s exec tsc --noEmit

test: $(INSTALL_DEPS)
	pnpm -s exec vitest --run

test-watch: $(INSTALL_DEPS)
	pnpm -s exec vitest

dev: dev-firefox

# WXT_OUT_DIR keeps the unpacked dev build out of the hidden .output directory
dev-firefox: $(INSTALL_DEPS)
	WXT_OUT_DIR=dev-output pnpm -s exec wxt -b firefox

dev-chrome: $(INSTALL_DEPS)
	WXT_OUT_DIR=dev-output pnpm -s exec wxt

dist/firefox: $(INSTALL_DEPS)
	pnpm -s exec wxt build -b firefox

dist/chrome: $(INSTALL_DEPS)
	pnpm -s exec wxt build

artifacts:
	mkdir -p ./artifacts

artifacts/favabrowserext.chrome.zip: dist/chrome artifacts
	pnpm -s exec wxt zip
	mv ./.output/chrome.zip ./artifacts/favabrowserext.chrome.zip

artifacts/favabrowserext.firefox.zip: dist/firefox artifacts
	pnpm -s exec wxt zip -b firefox
	mv ./.output/firefox.zip ./artifacts/favabrowserext.firefox.zip

# The whole monorepo is the source tree now that this package is no longer its
# own git root; Mozilla's source upload gets a clone of the repo.
artifacts/favabrowserext.firefox.source.zip: artifacts
	rm -rf ./artifacts/favabrowserext.firefox.source* || true
	git clone ../.. ./artifacts/favabrowserext.firefox.source
	rm -rf ./artifacts/favabrowserext.firefox.source/.git
	(cd ./artifacts/favabrowserext.firefox.source && zip -r ../favabrowserext.firefox.source.zip .)
	rm -rf ./artifacts/favabrowserext.firefox.source

.PHONY: install build clean bump-version lint test test-watch dev dev-firefox dev-chrome dist/firefox dist/chrome
