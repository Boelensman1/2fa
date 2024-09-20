-include .env

PACKAGES=$(shell find packages -mindepth 1 -maxdepth 1 -type d | xargs -n 1 basename)
SUB_PACKAGE_JSONS=$(shell find packages -maxdepth 2 -type f -name 'package.json')

node_modules: package.json package-lock.json $(SUB_PACKAGE_JSONS)
	npm ci

clean-%:
	(cd ./packages/$* && $(MAKE) clean)

lint-%: node_modules
	(cd ./packages/$* && $(MAKE) lint)

test-%: node_modules
	(cd ./packages/$* && $(MAKE) test)

build-%: node_modules
	(cd ./packages/$* && $(MAKE) build)

lint: $(PACKAGES:%=lint-%)
test:
	CI=1 $(MAKE) $(PACKAGES:%=test-%)
build: $(PACKAGES:%=build-%)

clean: $(PACKAGES:%=clean-%)
	rm -rf ./node_modules
	rm -rf ./packages/*/node_modules

.PHONY: lint test clean clean-% install install-% build-% version-% lint-%
