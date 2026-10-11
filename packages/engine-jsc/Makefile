INSTALL_DEPS:=node_modules ../lib/build
SRC_FILES:=$(shell find src/)
TEST_FILES:=$(shell find tests/)
SWIFT_RESOURCE:=swift/Sources/FavaEngine/Resources/fava-engine.js

include ../deps.mk

# The bundle is the product: favalib, its dependencies and the polyfills in one
# classic script for JSContext.evaluateScript. It is also copied into the Swift
# package, which ships it as a resource.
build: $(INSTALL_DEPS) $(SRC_FILES) scripts/build.mts
	rm -rf build
	pnpm exec tsx scripts/build.mts
	mkdir -p $(dir $(SWIFT_RESOURCE))
	cp build/fava-engine.js $(SWIFT_RESOURCE)

node_modules: package.json ../../pnpm-lock.yaml
	$(MAKE) -C ../.. node_modules
	mkdir -p node_modules
	@touch node_modules

clean:
	rm -rf build $(SWIFT_RESOURCE)

lint: $(INSTALL_DEPS)
	pnpm exec prettier --check --ignore-path=../../.gitignore --ignore-path=.gitignore .
	pnpm exec tsc --noEmit
	pnpm exec eslint

test: $(INSTALL_DEPS) $(SRC_FILES) $(TEST_FILES)
	pnpm exec vitest --run

# Runs the Swift package's tests. Needs Xcode (macOS), not available in the
# container.
test-swift: build
	cd swift && swift test

.PHONY: clean lint test test-swift
