# The iOS app and its AutoFill extension. Needs Xcode, so on anything but macOS
# every target is a no-op: the root Makefile fans out over every package.
# XcodeGen comes from the root flake's dev shell (`nix develop`).

ENGINE_RESOURCE:=../engine-jsc/swift/Sources/FavaEngine/Resources/fava-engine.js
SOURCES:=$(shell find App AutoFill Shared Tests -type f -not -name Info.plist 2>/dev/null)
# A simulator to test on: the first available iPhone, unless SIMULATOR names one.
SIMULATOR?=$(shell xcrun simctl list devices available 2>/dev/null | grep -m1 ' iPhone ' | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}')
XCODEBUILD:=xcodebuild -project Fava.xcodeproj -scheme Fava -destination 'platform=iOS Simulator,id=$(SIMULATOR)' -derivedDataPath build

ifeq ($(shell uname),Darwin)

build: Fava.xcodeproj engine
	$(XCODEBUILD) build

test: Fava.xcodeproj engine
	@test -n "$(SIMULATOR)" || { echo "No iPhone simulator; install one with xcodebuild -downloadPlatform iOS"; exit 1; }
	$(XCODEBUILD) test

# Regenerated whenever the spec changes or a source file is added or removed:
# XcodeGen lists the files in the project.
Fava.xcodeproj: project.yml $(SOURCES)
	@command -v xcodegen >/dev/null || { echo "xcodegen not found; run inside nix develop"; exit 1; }
	xcodegen generate --quiet
	@touch $@

project: Fava.xcodeproj

# Always delegates, so engine-jsc's own rules decide whether the bundle is stale.
engine:
	$(MAKE) -C ../engine-jsc build

clean:
	rm -rf build Fava.xcodeproj

else

build test project engine clean:
	@echo "app-ios needs Xcode; skipping on $(shell uname)"

endif

lint:

.PHONY: build test project engine clean lint
