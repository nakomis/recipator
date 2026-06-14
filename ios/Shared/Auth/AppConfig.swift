import Foundation

/// Environment config baked in at build time via Info.plist.
/// Values differ between the Sandbox and Production Xcode schemes.
enum AppConfig {
    static let apiBaseURL: String       = plist("RecipatorApiBaseURL")
    static let cognitoClientID: String  = plist("RecipatorCognitoClientID")
    static let cognitoLoginDomain: String = plist("RecipatorCognitoLoginDomain")
    static let cognitoRedirectURI       = "com.nakomis.recipator://callback"

    /// True when this build points at the sandbox API (vs production). Used to show a
    /// visible environment marker so it's obvious which backend the app is talking to.
    static var isSandbox: Bool { apiBaseURL.contains("sandbox") }

    private static func plist(_ key: String) -> String {
        guard let value = Bundle.main.infoDictionary?[key] as? String, !value.isEmpty else {
            fatalError("Missing Info.plist key: \(key)")
        }
        return value
    }
}
