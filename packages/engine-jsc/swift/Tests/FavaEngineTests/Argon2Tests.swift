import XCTest
@testable import FavaEngine

final class Argon2Tests: XCTestCase {
    /// The vault's own parameters (favalib's V2_KDF_PARAMETERS). The expected
    /// value is what hash-wasm -- favalib's argon2 everywhere else -- computes
    /// for the same input, so this pins byte-for-byte agreement with every
    /// other fava client.
    func testMatchesHashWasmAtVaultParameters() throws {
        let hash = try Argon2.id(
            password: Array("correct-horse-battery-staple-ios-9!".utf8),
            // favalib passes the salt's base64 STRING to argon2, as UTF-8.
            salt: Array("c2FsdHNhbHRzYWx0c2FsdA==".utf8),
            iterations: 3, memoryKiB: 65536, parallelism: 4, length: 64
        )
        XCTAssertEqual(
            hash.map { String(format: "%02x", $0) }.joined(),
            "24067992b7777c841d0b8094589469a9bdc29c8d1181d1bba98717cead8c5752"
                + "1ff92bcd7df42e2516d6bd17135dd672009d4181b3e5383b6157d0c6ec43f038"
        )
    }

    func testRejectsAShortSalt() {
        XCTAssertThrowsError(
            try Argon2.id(password: [1, 2, 3], salt: [1, 2, 3], iterations: 1,
                          memoryKiB: 64, parallelism: 1, length: 32)
        )
    }
}
