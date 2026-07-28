import XCTest
@testable import Recipator

/// RECP-58: deciding whether a 4xx on the token endpoint really means "this refresh token is
/// dead". Getting this wrong destroys the user's credentials while they're offline, which is the
/// one situation where they cannot sign in again — so the bar for signing out is a body that
/// unambiguously came from Cognito.
final class AuthRefreshTests: XCTestCase {

    private func body(_ s: String) -> Data { Data(s.utf8) }

    func testCognitoInvalidGrantIsDead() {
        XCTAssertTrue(AuthService.isDeadRefreshToken(body(#"{"error":"invalid_grant"}"#)))
        // Cognito sends a description alongside it in some cases.
        XCTAssertTrue(AuthService.isDeadRefreshToken(
            body(#"{"error":"invalid_grant","error_description":"Refresh Token has expired"}"#)))
    }

    /// The supermarket case: WiFi is associated and the device reports itself online, but a
    /// captive portal answers instead of Cognito. None of these may sign the user out.
    func testCaptivePortalResponsesAreNotDead() {
        XCTAssertFalse(AuthService.isDeadRefreshToken(
            body("<!DOCTYPE html><html><body>Please sign in to FreeWiFi</body></html>")))
        XCTAssertFalse(AuthService.isDeadRefreshToken(body("")))
        XCTAssertFalse(AuthService.isDeadRefreshToken(body("Forbidden")))
        XCTAssertFalse(AuthService.isDeadRefreshToken(body(#"{"message":"Forbidden"}"#)))
        // Valid JSON, but not an OAuth error document.
        XCTAssertFalse(AuthService.isDeadRefreshToken(body(#"{"status":403}"#)))
        // A JSON array, not an object.
        XCTAssertFalse(AuthService.isDeadRefreshToken(body(#"[{"error":"invalid_grant"}]"#)))
    }

    /// Other OAuth error codes indicate a misconfigured client, a throttle, or a server fault —
    /// none of which mean the user's refresh token has stopped being valid.
    func testOtherOAuthErrorsAreNotDead() {
        for code in ["invalid_request", "unauthorized_client", "invalid_client",
                     "unsupported_grant_type", "slow_down", "temporarily_unavailable"] {
            XCTAssertFalse(AuthService.isDeadRefreshToken(body(#"{"error":"\#(code)"}"#)),
                           "\(code) must not sign the user out")
        }
    }
}
