import AuthenticationServices
import CryptoKit
import Foundation

/// Cognito hosted-UI auth via PKCE authorization code flow.
///
/// The access token is sent as the `Authorization: Bearer` header on every
/// API call. The Share Extension reads the same token from the shared Keychain
/// (access group 62YFUFBSFX.com.nakomis.recipator) without going through
/// this service — it just calls TokenStore.load() directly.
@MainActor
final class AuthService: NSObject, ObservableObject {
    @Published private(set) var isSignedIn = false
    /// True until `restore()` has settled at launch. The root view shows neither the app nor the
    /// sign-in screen while this holds, so a valid session goes straight in (RECP-58).
    @Published private(set) var isRestoring = true
    @Published private(set) var displayName: String?  // Cognito username, e.g. "nakomis"
    @Published private(set) var email: String?
    @Published private(set) var userId: String?        // sub — stable key matching DynamoDB userId
    @Published private(set) var lastError: String?

    private var tokens: StoredTokens?

    // MARK: - Lifecycle

    /// Restore a previous session at launch. Adopts the stored tokens *before* attempting any
    /// network refresh, so an expired-but-refreshable session offline still opens the app rather
    /// than dropping to sign-in (RECP-58). `isRestoring` stays true for the duration so the root
    /// view can hold a splash instead of flashing the sign-in screen on every cold launch.
    func restore() async {
        defer { isRestoring = false }
        guard let stored = try? TokenStore.load() else { return }

        // Expired with no way back — the only honest outcome is the sign-in screen.
        guard stored.expiresAt > Date() || stored.refreshToken != nil else {
            signOut()
            return
        }

        adopt(stored)
        if stored.expiresAt <= Date(), let refreshToken = stored.refreshToken {
            // Signs out only if Cognito rejects the token; a network failure leaves us signed in
            // with a stale access token, which the local shopping store can still work behind.
            await refresh(using: refreshToken)
        }
    }

    /// Take a set of tokens as the live session and publish the identity claims from the id token.
    private func adopt(_ stored: StoredTokens) {
        tokens = stored
        isSignedIn = true
        let c = claims(from: stored.idToken)
        displayName = c?["cognito:username"] as? String
        email = c?["email"] as? String
        userId = c?["sub"] as? String
    }

    // MARK: - Public API

    /// Returns a valid access token, refreshing silently if needed. When the session is genuinely
    /// dead (no refresh token, or Cognito rejected it) it signs out — flipping `isSignedIn` so the
    /// root view drops to the sign-in screen automatically, rather than surfacing a "session
    /// expired" error the user has to clear and then manually log out from (RECP-56).
    ///
    /// A refresh that fails for want of a network is *not* a dead session: we return the stale
    /// token and stay signed in. The caller's request will fail, its caller will treat that as
    /// transient, and the user keeps offline access to their data (RECP-58).
    func accessToken() async -> String? {
        guard let t = tokens else { signOut(); return nil }
        if t.expiresAt > Date().addingTimeInterval(60) { return t.accessToken }
        guard let rt = t.refreshToken else { signOut(); return nil }
        await refresh(using: rt)   // signs out only if Cognito rejects the refresh token
        return tokens?.accessToken
    }

    func signIn() async {
        lastError = nil
        let verifier = pkceVerifier()
        let challenge = pkceChallenge(for: verifier)

        var comps = URLComponents(string: "https://\(AppConfig.cognitoLoginDomain)/oauth2/authorize")!
        comps.queryItems = [
            URLQueryItem(name: "response_type",          value: "code"),
            URLQueryItem(name: "client_id",              value: AppConfig.cognitoClientID),
            URLQueryItem(name: "redirect_uri",           value: AppConfig.cognitoRedirectURI),
            URLQueryItem(name: "scope",                  value: "openid email profile"),
            URLQueryItem(name: "code_challenge",         value: challenge),
            URLQueryItem(name: "code_challenge_method",  value: "S256"),
        ]

        do {
            let callback = try await beginSession(url: comps.url!)
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "code" })?.value
            else { lastError = "No auth code in callback"; return }
            try await exchangeCode(code, verifier: verifier)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func signOut() {
        TokenStore.clear()
        tokens = nil
        isSignedIn = false
        displayName = nil
        email = nil
        userId = nil
    }

    // MARK: - Private

    private func beginSession(url: URL) async throws -> URL {
        let scheme = URL(string: AppConfig.cognitoRedirectURI)!.scheme!
        return try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { url, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: url!)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            session.start()
        }
    }

    private func exchangeCode(_ code: String, verifier: String) async throws {
        var req = URLRequest(url: URL(string: "https://\(AppConfig.cognitoLoginDomain)/oauth2/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = [
            "grant_type":    "authorization_code",
            "client_id":     AppConfig.cognitoClientID,
            "code":          code,
            "redirect_uri":  AppConfig.cognitoRedirectURI,
            "code_verifier": verifier,
        ].formEncoded()

        let (data, _) = try await URLSession.shared.data(for: req)
        try applyTokenResponse(data)
    }

    /// Exchange the refresh token for a fresh access token.
    ///
    /// Only a genuine rejection by Cognito (a 4xx — `invalid_grant` when the refresh token has been
    /// revoked or expired) signs the user out. A transport failure must **not**: previously any
    /// error, including "no network", cleared the Keychain — so opening the app in a supermarket
    /// with no WiFi and no tether destroyed the credentials and locked the user out of their own
    /// shopping list precisely when they couldn't sign in again (RECP-58). On a transport failure
    /// we keep the tokens and stay signed in; the local store still serves the list offline.
    ///
    /// - Returns: `true` if the session is still usable afterwards.
    @discardableResult
    private func refresh(using refreshToken: String) async -> Bool {
        var req = URLRequest(url: URL(string: "https://\(AppConfig.cognitoLoginDomain)/oauth2/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = [
            "grant_type":    "refresh_token",
            "client_id":     AppConfig.cognitoClientID,
            "refresh_token": refreshToken,
        ].formEncoded()

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (400..<500).contains(status) {
                // Cognito rejected the refresh token itself — it will never work again.
                signOut()
                return false
            }
            guard (200..<300).contains(status) else {
                // 5xx or something unexpected — Cognito's problem, not the token's. Try again later.
                return tokens != nil
            }
            try applyTokenResponse(data, existingRefreshToken: refreshToken)
            return true
        } catch {
            // Transport failure (offline, DNS, timeout). Keep the credentials.
            return tokens != nil
        }
    }

    private func applyTokenResponse(_ data: Data, existingRefreshToken: String? = nil) throws {
        struct Response: Decodable {
            let access_token: String
            let id_token: String
            let refresh_token: String?
            let expires_in: Int
        }
        let r = try JSONDecoder().decode(Response.self, from: data)
        let stored = StoredTokens(
            accessToken:  r.access_token,
            idToken:      r.id_token,
            refreshToken: r.refresh_token ?? existingRefreshToken,
            expiresAt:    Date().addingTimeInterval(TimeInterval(r.expires_in))
        )
        try TokenStore.save(stored)
        adopt(stored)
    }

    // MARK: - PKCE helpers

    private func pkceVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncoded()
    }

    private func pkceChallenge(for verifier: String) -> String {
        let data = Data(verifier.utf8)
        let hash = SHA256.hash(data: data)
        return Data(hash).base64URLEncoded()
    }

    // MARK: - JWT helpers

    private func claims(from jwt: String) -> [String: Any]? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { ASPresentationAnchor() }
    }
}

// MARK: - Helpers

private extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension [String: String] {
    func formEncoded() -> Data? {
        map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")" }
            .joined(separator: "&")
            .data(using: .utf8)
    }
}
