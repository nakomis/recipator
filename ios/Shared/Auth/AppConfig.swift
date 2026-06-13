import Foundation

/// Environment config baked in at build time via Info.plist.
/// Values differ between the Sandbox and Production Xcode schemes.
enum AppConfig {
    static let apiBaseURL: String       = plist("RecipatorApiBaseURL")
    static let cognitoClientID: String  = plist("RecipatorCognitoClientID")
    static let cognitoLoginDomain: String = plist("RecipatorCognitoLoginDomain")
    static let cognitoRedirectURI       = "com.nakomis.recipator://callback"

    private static func plist(_ key: String) -> String {
        guard let value = Bundle.main.infoDictionary?[key] as? String, !value.isEmpty else {
            fatalError("Missing Info.plist key: \(key)")
        }
        return value
    }
}
