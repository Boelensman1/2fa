// swift-tools-version: 5.9
//
// favalib for iOS: the JS engine bundle (built by `make -C packages/engine-jsc
// build`, which copies it into Sources/FavaEngine/Resources) running in a
// JavaScriptCore JSContext, plus the native half it needs -- argon2id, a
// CSPRNG, sockets, timers -- and the Keychain store for the unlocked session.
import PackageDescription

let package = Package(
    name: "FavaEngine",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "FavaEngine", targets: ["FavaEngine"]),
    ],
    targets: [
        .target(
            name: "CArgon2",
            exclude: ["LICENSE", "README.md"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("."),
                .headerSearchPath("blake2"),
            ]
        ),
        .target(
            name: "FavaEngine",
            dependencies: ["CArgon2"],
            resources: [.copy("Resources/fava-engine.js")]
        ),
        .testTarget(
            name: "FavaEngineTests",
            dependencies: ["FavaEngine"]
        ),
    ]
)
