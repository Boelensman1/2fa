# The iOS app and its AutoFill extension. Needs Xcode, so on anything but macOS
# every target is a no-op: the root Makefile fans out over every package.
# XcodeGen comes from the root flake's dev shell (`nix develop`).

ENGINE_RESOURCE:=../engine-jsc/swift/Sources/FavaEngine/Resources/fava-engine.js
SOURCES:=$(shell find App AutoFill Shared Tests -type f -not -name Info.plist 2>/dev/null)
# Xcode's own tools, past whatever `nix develop` put in the way: on Darwin its
# stdenv points DEVELOPER_DIR and SDKROOT at nixpkgs' Apple SDK and puts its own
# xcrun on PATH, which knows no xcodebuild or simctl ("tool 'xcodebuild' not
# found"). /usr/bin/xcrun with those unset resolves through xcode-select, the
# same as outside the shell.
XCRUN:=env -u DEVELOPER_DIR -u SDKROOT -u MACOSX_DEPLOYMENT_TARGET -u NIX_CFLAGS_COMPILE -u NIX_LDFLAGS /usr/bin/xcrun
# A simulator to test on: the first available iPhone, unless SIMULATOR names one.
SIMULATOR?=$(shell $(XCRUN) simctl list devices available 2>/dev/null | grep -m1 ' iPhone ' | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}')
# -quiet: only warnings, errors and failing tests.
XCODEBUILD:=$(XCRUN) xcodebuild -project Fava.xcodeproj -scheme Fava -destination 'platform=iOS Simulator,id=$(SIMULATOR)' -derivedDataPath build -quiet

ifeq ($(shell uname),Darwin)

build: Fava.xcodeproj engine
	@echo "xcodebuild build (Fava, simulator $(SIMULATOR))"
	@$(XCODEBUILD) build

test: Fava.xcodeproj engine
	@test -n "$(SIMULATOR)" || { echo "No iPhone simulator; install one with xcodebuild -downloadPlatform iOS"; exit 1; }
	@echo "xcodebuild test (Fava, simulator $(SIMULATOR))"
	@$(XCODEBUILD) test

# Regenerated whenever the spec changes or a source file is added or removed:
# XcodeGen lists the files in the project.
Fava.xcodeproj: project.yml $(SOURCES)
	@command -v xcodegen >/dev/null || { echo "xcodegen not found; run inside nix develop"; exit 1; }
	xcodegen generate --quiet
	@touch $@

project: Fava.xcodeproj

# Always delegates, so engine-jsc's own rules decide whether the bundle is stale.
engine:
	@$(MAKE) --no-print-directory -C ../engine-jsc build

clean:
	rm -rf build Fava.xcodeproj

else

build test project engine clean:
	@echo "app-ios needs Xcode; skipping on $(shell uname)"

endif

lint:

.PHONY: build test project engine clean lint
