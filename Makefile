-include .env

PACKAGES=$(shell find packages -mindepth 1 -maxdepth 1 -type d | xargs -n 1 basename)
SUB_PACKAGE_JSONS=$(shell find packages -maxdepth 2 -type f -name 'package.json')


build: $(PACKAGES:%=build-%)

lint: $(PACKAGES:%=lint-%)

test:
	CI=1 $(MAKE) $(PACKAGES:%=test-%)

clean: $(PACKAGES:%=clean-%)
	rm -rf ./node_modules
	rm -rf ./packages/*/node_modules

node_modules: package.json package-lock.json $(SUB_PACKAGE_JSONS)
	npm ci

build-%: node_modules
	make -C ./packages/$* build

lint-%: node_modules
	make -C ./packages/$* lint

test-%: node_modules
	make -C ./packages/$* test

clean-%:
	make -C ./packages/$* clean


.PHONY: lint test clean clean-% install install-% build-% version-% lint-%
