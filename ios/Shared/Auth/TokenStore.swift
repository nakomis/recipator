import Foundation
import Security

struct StoredTokens: Codable {
    var accessToken: String
    var idToken: String
    var refreshToken: String?
    var expiresAt: Date
}

/// Keychain-backed token store shared between the main app and Share Extension
/// via the keychain access group com.nakomis.recipator.
enum TokenStore {
    private static let service      = "com.nakomis.recipator.tokens"
    private static let account      = "cognito"
    // Access group allows both the app and the Share Extension to read/write tokens.
    // The $(AppIdentifierPrefix) is the Apple team ID (62YFUFBSFX).
    private static let accessGroup  = "62YFUFBSFX.com.nakomis.recipator"

    static func save(_ tokens: StoredTokens) throws {
        let data = try JSONEncoder().encode(tokens)
        let query: [String: Any] = [
            kSecClass as String:           kSecClassGenericPassword,
            kSecAttrService as String:     service,
            kSecAttrAccount as String:     account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String]       = data
        add[kSecAttrAccessible as String]  = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
    }

    static func load() throws -> StoredTokens? {
        let query: [String: Any] = [
            kSecClass as String:           kSecClassGenericPassword,
            kSecAttrService as String:     service,
            kSecAttrAccount as String:     account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String:      true,
            kSecMatchLimit as String:      kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unhandled(status)
        }
        return try JSONDecoder().decode(StoredTokens.self, from: data)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String:           kSecClassGenericPassword,
            kSecAttrService as String:     service,
            kSecAttrAccount as String:     account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum KeychainError: Error {
    case unhandled(OSStatus)
}
