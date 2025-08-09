SRC_FILES=$(shell find src)

INSTALL_DEPS=node_modules
DIST_DEPS=$(SRC_FILES) install lint

VERSION=$(shell jq .version ./package.json)

DIST_COMMAND=NODE_ENV=production npx --no-install vite build
WATCH_COMMAND=NODE_ENV=development npx --no-install vite build --watch --mode development --minify false

install: $(INSTALL_DEPS)

node_modules: package.json package-lock.json
	npm ci

clean:
	rm -rf web-ext-artifacts dist

bump-version:
	npm version patch --git-tag-version false

lint:
	npx --no-install prettier . --check
	npx --no-install eslint .
	npx --no-install tsc --project ./tsconfig.json --skipLibCheck --noEmit

dist/watch: install

dist/watch/firefox: $(DIST_DEPS)
	VITE_BUILDFOR=firefox $(WATCH_COMMAND)

dist/watch/chrome: $(DIST_DEPS)
	VITE_BUILDFOR=chrome $(WATCH_COMMAND)

dist/firefox: $(DIST_DEPS)
	VITE_BUILDFOR=firefox $(DIST_COMMAND)

dist/chrome: $(DIST_DEPS)
	VITE_BUILDFOR=chrome $(DIST_COMMAND)

dist/performance/chrome: $(DIST_DEPS)
	VITE_BUILDFOR=chrome VITE_LOG_PERFORMANCE=1 $(DIST_COMMAND)

dist/performance/firefox: $(DIST_DEPS)
	VITE_BUILDFOR=firefox VITE_LOG_PERFORMANCE=1 $(DIST_COMMAND)

stats.html:
	GENERATE_STATS=1 $(MAKE) dist/chrome

open-chrome-watch:
	npx --no-install web-ext run --target chromium --start-url "https://example.com" --source-dir ./dist/watch/chrome

open-firefox-watch:
	npx --no-install web-ext run --target firefox-desktop --firefox-profile=fava-ext-dev --keep-profile-changes --start-url "https://example.com" --source-dir ./dist/watch/firefox

artifacts:
	mkdir -p ./artifacts

artifacts/fava-ext.chrome.zip: dist/chrome artifacts
	rm ./artifacts/fava-ext.chrome.zip || true
	mv ./dist/chrome ./fava-ext
	zip -r ./artifacts/fava-ext.chrome.zip ./fava-ext/*
	rm -rf ./fava-ext

artifacts/fava-ext.firefox.zip: dist/firefox artifacts
	rm ./artifacts/fava-ext.firefox.zip || true
	npx web-ext build -s ./dist/firefox
	mv ./web-ext-artifacts/*.zip ./artifacts/fava-ext.firefox.zip
	rm -rf ./web-ext-artifacts

artifacts/fava-ext.firefox.source.zip: artifacts
	rm -rf ./artifacts/fava-ext.firefox.source* || true
	git clone . ./artifacts/fava-ext.firefox.source
	rm -rf ./artifacts/fava-ext.firefox.source/.git # remove .git, no need to upload
	(cd ./artifacts/fava-ext.firefox.source && zip -r ../fava-ext.firefox.source.zip .)
	rm -rf ./artifacts/fava-ext.firefox.source

lib: $(SRC_FILES)
	npx --no-install tsc -p tsconfig.lib.json

#test: $(INSTALL_DEPS)
#	npx --no-install vitest

#test-debug: $(INSTALL_DEPS)
#	npx --no-install vitest --inspect-brk --no-file-parallelism --test-timeout 99999999

.PHONY: lint clean open-chromium-watch open-firefox-watch test debug-test
