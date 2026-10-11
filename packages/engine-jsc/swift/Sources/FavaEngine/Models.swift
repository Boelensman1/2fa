import Foundation

// The JSON shapes favaEngine.call takes and returns: favalib's own types
// (packages/lib/src/interfaces), minus the branding. Times are milliseconds
// since the epoch, as favalib keeps them.

public struct UrlMatcher: Codable, Hashable, Sendable {
    /// 'BaseDomain', 'Host', 'Origin', 'UrlPrefix' or 'Regex'.
    public var type: String
    public var value: String

    public init(type: String, value: String) {
        self.type = type
        self.value = value
    }
}

public struct TotpPayload: Codable, Hashable, Sendable {
    /// Base32.
    public var secret: String
    public var period: Int
    /// 'SHA-1', 'SHA-256' or 'SHA-512'.
    public var algorithm: String
    public var digits: Int

    public init(secret: String, period: Int = 30, algorithm: String = "SHA-1", digits: Int = 6) {
        self.secret = secret
        self.period = period
        self.algorithm = algorithm
        self.digits = digits
    }
}

public struct Token: Codable, Hashable, Sendable {
    public var otp: String
    public var validFrom: Double
    public var validTill: Double

    public var validFromDate: Date { Date(timeIntervalSince1970: validFrom / 1000) }
    public var validTillDate: Date { Date(timeIntervalSince1970: validTill / 1000) }
}

/// An entry's metadata. Never carries the secret.
public struct Entry: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var issuer: String
    public var type: String
    public var matchers: [UrlMatcher]
    public var url: String?
    public var inputSelector: String?
    public var addedAt: Double
    public var updatedAt: Double?
    /// Present when listed with codes.
    public var token: Token?
    /// Present in AutoFill matches: which matcher accepted the url.
    public var matchedBy: UrlMatcher?
}

public struct NewEntry: Encodable, Sendable {
    public var name: String
    public var issuer: String
    public var type = "TOTP"
    public var payload: TotpPayload
    public var matchers: [UrlMatcher]?
    public var url: String?
    public var inputSelector: String?

    public init(
        name: String, issuer: String, payload: TotpPayload,
        matchers: [UrlMatcher]? = nil, url: String? = nil, inputSelector: String? = nil
    ) {
        self.name = name
        self.issuer = issuer
        self.payload = payload
        self.matchers = matchers
        self.url = url
        self.inputSelector = inputSelector
    }
}

/// Fields to change on an entry; nil leaves a field as it is.
public struct EntryUpdate: Encodable, Sendable {
    public var name: String?
    public var issuer: String?
    public var payload: TotpPayload?
    public var matchers: [UrlMatcher]?
    public var url: String?
    public var inputSelector: String?

    public init(
        name: String? = nil, issuer: String? = nil, payload: TotpPayload? = nil,
        matchers: [UrlMatcher]? = nil, url: String? = nil, inputSelector: String? = nil
    ) {
        self.name = name
        self.issuer = issuer
        self.payload = payload
        self.matchers = matchers
        self.url = url
        self.inputSelector = inputSelector
    }
}

public struct PasswordStrength: Decodable, Hashable, Sendable {
    public struct Feedback: Decodable, Hashable, Sendable {
        public var warning: String?
        public var suggestions: [String]
    }

    /// 0-4. favalib refuses a vault password below 3.
    public var score: Int
    public var guessesLog10: Double
    public var feedback: Feedback

    public var isAcceptable: Bool { score >= 3 }
}

public struct EngineStatus: Decodable, Hashable, Sendable {
    public var unlocked: Bool
    public var syncConfigured: Bool
    public var syncConnected: Bool
}

public struct PairingCode: Decodable, Hashable, Sendable {
    /// To show or copy; what `respondToPairing` takes on the other device.
    public var text: String
    /// To draw as a QR code. Other fava clients scan this form.
    public var qrPayload: String
}

public struct ImportResult: Decodable, Hashable, Sendable {
    public var lineNr: Int
    public var entryId: String?
    public var error: String?
}

public struct SyncDevice: Decodable, Hashable, Identifiable, Sendable {
    public var deviceId: String
    public var deviceType: String?
    public var deviceFriendlyName: String?
    public var fingerprint: String
    public var acknowledged: Bool

    public var id: String { deviceId }
}

/// A FavaLibEvent, as the engine forwards it.
public struct EngineEvent: Sendable {
    /// FavaLibEvent's string value, e.g. 'changed' or 'passwordChanged'.
    public var type: String
    /// The event's detail, as JSON.
    public var detailJSON: String

    public var kind: Kind? { Kind(rawValue: type) }

    public enum Kind: String, Sendable {
        /// Re-read whatever is displayed.
        case changed
        /// Replace the stored unlocked session with a fresh export.
        case passwordChanged
        case loadedFromLockedRepresentation
        case connectToExistingVaultFinished
        case addDeviceFlowFinished
        case connectionToSyncServerStatusChanged
        case syncDeviceAdded
        case log
        case ready
    }
}

/// A rejection from the engine. `kind` is stable; branch on it, not on
/// `message`.
public struct FavaEngineError: Error, Hashable, Sendable, CustomStringConvertible {
    /// 'usage', 'authentication', 'initialization', 'storageVersion',
    /// 'unsupportedStorageVersion', 'crypto', 'entryNotFound',
    /// 'tokenGeneration', 'syncPairingVersion', 'syncDeviceKeyConflict',
    /// 'syncDeviceRemoved', 'favalib' or 'internal'.
    public var kind: String
    public var message: String

    public var description: String { "\(kind): \(message)" }

    init(kind: String, message: String) {
        self.kind = kind
        self.message = message
    }

    /// Decodes the `{ kind, message }` JSON the engine rejects with.
    init(rejectionMessage: String) {
        struct Wire: Decodable { var kind: String; var message: String }
        if let wire = try? JSONDecoder().decode(Wire.self, from: Data(rejectionMessage.utf8)) {
            self.init(kind: wire.kind, message: wire.message)
        } else {
            self.init(kind: "internal", message: rejectionMessage)
        }
    }
}
