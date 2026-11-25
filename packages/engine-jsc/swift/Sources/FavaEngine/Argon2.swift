import CArgon2

/// Argon2id (version 0x13) through the reference implementation.
///
/// This is the one primitive the engine cannot do in JS: with no JIT and no
/// WebAssembly, a pure-JS derivation at the vault's parameters takes over a
/// minute. The reference C code with four lanes on four threads takes about a
/// tenth of a second.
public enum Argon2 {
    public struct Failure: Error, CustomStringConvertible {
        public let code: Int32
        public var description: String { String(cString: argon2_error_message(code)) }
    }

    /// Computes a raw argon2id hash.
    /// - Parameters:
    ///   - password: The password bytes.
    ///   - salt: The salt bytes (at least 8).
    ///   - iterations: Passes (t).
    ///   - memoryKiB: Memory cost (m), in KiB.
    ///   - parallelism: Lanes (p); each runs on its own thread.
    ///   - length: Output length in bytes.
    /// - Returns: The hash.
    public static func id(
        password: [UInt8],
        salt: [UInt8],
        iterations: UInt32,
        memoryKiB: UInt32,
        parallelism: UInt32,
        length: Int
    ) throws -> [UInt8] {
        var output = [UInt8](repeating: 0, count: length)
        let code = password.withUnsafeBytes { pwd in
            salt.withUnsafeBytes { salt in
                output.withUnsafeMutableBytes { out in
                    argon2id_hash_raw(
                        iterations, memoryKiB, parallelism,
                        pwd.baseAddress, pwd.count,
                        salt.baseAddress, salt.count,
                        out.baseAddress, out.count
                    )
                }
            }
        }
        guard code == ARGON2_OK.rawValue else {
            throw Failure(code: code)
        }
        return output
    }
}
