import AuthenticationServices
import FavaEngine
@testable import Fava
import XCTest

/// The domains registered with iOS have to be the hosts favalib matches on,
/// or a suggestion shows up where the extension then finds no entry.
final class SiteDomainsTests: XCTestCase {
    func testHostLevelMatchersGiveTheirHost() {
        XCTAssertEqual(SiteDomains.of(UrlMatcher(type: "BaseDomain", value: "pangolin.appeal.nl")), "pangolin.appeal.nl")
        XCTAssertEqual(SiteDomains.of(UrlMatcher(type: "Host", value: ".Example.COM.")), "example.com")
    }

    func testUrlMatchersGiveTheirUrlsHost() {
        XCTAssertEqual(SiteDomains.of(UrlMatcher(type: "Origin", value: "https://Login.example.com:8443")), "login.example.com")
        XCTAssertEqual(SiteDomains.of(UrlMatcher(type: "UrlPrefix", value: "https://example.com/login")), "example.com")
        XCTAssertNil(SiteDomains.of(UrlMatcher(type: "UrlPrefix", value: "not a url")))
    }

    func testRegexAndEmptyMatchersGiveNone() {
        XCTAssertNil(SiteDomains.of(UrlMatcher(type: "Regex", value: "^https://example\\.com/")))
        XCTAssertNil(SiteDomains.of(UrlMatcher(type: "BaseDomain", value: "..")))
    }

    func testServiceIdentifiersGiveTheirHost() {
        XCTAssertEqual(SiteDomains.of(ASCredentialServiceIdentifier(identifier: "Pangolin.Appeal.nl", type: .domain)), "pangolin.appeal.nl")
        XCTAssertEqual(SiteDomains.of(ASCredentialServiceIdentifier(identifier: "https://pangolin.appeal.nl/auth/login", type: .URL)), "pangolin.appeal.nl")
    }
}
