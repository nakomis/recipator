import Foundation

// MARK: - Models

struct RecipeListItem: Codable, Identifiable {
    let recipeId: String
    let userId: String?
    let userEmail: String?
    let title: String
    let url: String
    let savedAt: String
    let imageUrl: String?
    var id: String { recipeId }

    /// First name extracted from email, e.g. "martin@nakomis.com" → "Martin"
    var ownerFirstName: String? {
        guard let handle = userEmail, !handle.isEmpty else { return nil }
        // handle is either an email or a Cognito username (no @)
        let local = handle.components(separatedBy: "@").first ?? handle
        let first = local.components(separatedBy: ".").first ?? local
        return first.prefix(1).uppercased() + first.dropFirst()
    }
}

struct GroupMember: Codable {
    let userId: String
    let displayName: String
}

/// Response of GET /model — describes the current on-device embedding model.
struct ModelInfo: Codable {
    let version: String
    let sha256: String
    let dim: Int
    let queryPrefix: String
    let url: String        // presigned S3 GET URL
    let expiresIn: Int
}

/// One recipe's search-index row from GET /embeddings: text for FTS plus the
/// embedding vector (base64 float32 LE) when one has been computed.
struct SearchIndexRow: Codable {
    let recipeId: String
    let userId: String
    let title: String
    let ingredients: [String]
    let method: [String]
    let model: String?
    let embeddedAt: String?
    let embedding: String?   // nil until the recipe has been embedded
}

struct RecipeDetail: Codable, Identifiable {
    let recipeId: String
    let title: String
    let url: String
    let savedAt: String
    let ingredients: [String]
    let method: [String]
    let markdown: String
    let imageUrl: String?
    let imageCandidates: [String]?
    var id: String { recipeId }
}

/// A shopping-list item (RECP-37). The server categorises raw text into a structured
/// item + aisle; quantity is parsed in code. `quantityLabel`/`displayLabel` mirror the
/// web app's formatting (RECP-40).
struct ShoppingItem: Codable, Identifiable {
    let itemId: String
    let listId: String
    let raw: String
    let item: String
    let amount: String?
    let unit: String?
    let aisle: String
    let checked: Bool
    let sortOrder: Int
    let createdAt: String
    let updatedAt: String
    var id: String { itemId }

    private static let tightUnits: Set<String> = ["g", "kg", "mg", "ml", "cl", "l"]

    /// "200ml", "4 pt", "1/2 cup", "x2", "4" — or nil when there's no quantity.
    var quantityLabel: String? {
        guard let amount, !amount.isEmpty else { return nil }
        guard let unit, !unit.isEmpty else { return amount }
        if unit == "x" { return "x\(amount)" }
        return ShoppingItem.tightUnits.contains(unit) ? "\(amount)\(unit)" : "\(amount) \(unit)"
    }

    /// "Item (quantity)" or just "Item".
    var displayLabel: String {
        if let q = quantityLabel { return "\(item) (\(q))" }
        return item
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case notAuthenticated
    case tokenExpired
    case server(Int, String)
    case noURLFound
    case extractionFailed

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:  return "Not signed in. Open Recipator and sign in first."
        case .tokenExpired:      return "Session expired. Open Recipator and sign in again."
        case .server(let s, _): return "Server error (\(s)). Please try again."
        case .noURLFound:        return "No URL found in the shared item."
        case .extractionFailed:  return "Could not extract a recipe from this page."
        }
    }
}

// MARK: - Client

final class APIClient {
    static let shared = APIClient()

    private func token() throws -> String {
        guard let stored = try? TokenStore.load() else { throw APIError.notAuthenticated }
        guard stored.expiresAt > Date() else { throw APIError.tokenExpired }
        return stored.accessToken
    }

    private func request(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> Data {
        let token = try token()
        var req = URLRequest(url: URL(string: AppConfig.apiBaseURL + path)!)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError.server(status, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    // MARK: - Endpoints

    /// Extract + save a recipe. If `html` is supplied (e.g. fetched on-device for a site
    /// that blocks server-side fetches), the server parses it directly instead of fetching.
    func extract(url: URL, html: String? = nil) async throws -> RecipeDetail {
        struct Body: Encodable { let url: String; let html: String? }
        let data = try await request("/extract", method: "POST", body: Body(url: url.absoluteString, html: html))
        guard let detail = try? JSONDecoder().decode(RecipeDetail.self, from: data) else {
            throw APIError.extractionFailed
        }
        return detail
    }

    func listRecipes(all: Bool = false, includeDeleted: Bool = false) async throws -> [RecipeListItem] {
        var params: [String] = []
        if all { params.append("all=true") }
        if includeDeleted { params.append("includeDeleted=true") }
        let query = params.isEmpty ? "" : "?" + params.joined(separator: "&")
        let data = try await request("/recipes\(query)")
        struct Response: Decodable { let recipes: [RecipeListItem] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.recipes ?? []
    }

    func getRecipe(id: String, userId: String? = nil) async throws -> RecipeDetail {
        var path = "/recipes/\(id)"
        if let userId { path += "?userId=\(userId)" }
        let data = try await request(path)
        guard let detail = try? JSONDecoder().decode(RecipeDetail.self, from: data) else {
            throw APIError.server(0, "Decoding failed")
        }
        return detail
    }

    func deleteRecipe(id: String) async throws {
        _ = try await request("/recipes/\(id)", method: "DELETE")
    }

    func updateRecipeImage(id: String, imageUrl: String) async throws {
        struct Body: Encodable { let imageUrl: String }
        _ = try await request("/recipes/\(id)", method: "PATCH", body: Body(imageUrl: imageUrl))
    }

    func getConfig() async throws -> [GroupMember] {
        let data = try await request("/config")
        struct Response: Decodable { let groupMembers: [GroupMember] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.groupMembers ?? []
    }

    func getModelInfo() async throws -> ModelInfo {
        let data = try await request("/model")
        return try JSONDecoder().decode(ModelInfo.self, from: data)
    }

    func getSearchIndex(all: Bool = true) async throws -> [SearchIndexRow] {
        let query = all ? "?all=true" : ""
        let data = try await request("/embeddings\(query)")
        struct Response: Decodable { let items: [SearchIndexRow] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.items ?? []
    }

    func reportFailure(url: String, errorType: String, htmlSnippet: String? = nil) async throws {
        struct Body: Encodable { let url: String; let errorType: String; let htmlSnippet: String? }
        _ = try await request("/failures", method: "POST", body: Body(url: url, errorType: errorType, htmlSnippet: htmlSnippet))
    }

    // MARK: - Shopping list (RECP-37)

    func listShoppingItems() async throws -> [ShoppingItem] {
        let data = try await request("/shopping/items")
        struct Response: Decodable { let items: [ShoppingItem] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.items ?? []
    }

    /// Add a free-text item; the server categorises it (item + aisle) and returns it.
    func addShoppingItem(text: String) async throws -> ShoppingItem {
        struct Body: Encodable { let text: String }
        let data = try await request("/shopping/items", method: "POST", body: Body(text: text))
        struct Response: Decodable { let item: ShoppingItem }
        guard let item = (try? JSONDecoder().decode(Response.self, from: data))?.item else {
            throw APIError.server(0, "Decoding failed")
        }
        return item
    }

    /// Patch an item. nil fields are omitted (Swift encodes optionals with encodeIfPresent),
    /// so only the supplied fields change.
    @discardableResult
    func updateShoppingItem(
        id: String, checked: Bool? = nil, item: String? = nil, aisle: String? = nil
    ) async throws -> ShoppingItem {
        struct Body: Encodable { let checked: Bool?; let item: String?; let aisle: String? }
        let data = try await request(
            "/shopping/items/\(id)", method: "PATCH",
            body: Body(checked: checked, item: item, aisle: aisle)
        )
        struct Response: Decodable { let item: ShoppingItem }
        guard let updated = (try? JSONDecoder().decode(Response.self, from: data))?.item else {
            throw APIError.server(0, "Decoding failed")
        }
        return updated
    }

    func deleteShoppingItem(id: String) async throws {
        _ = try await request("/shopping/items/\(id)", method: "DELETE")
    }

    func clearTickedShoppingItems() async throws {
        _ = try await request("/shopping/clear-ticked", method: "POST")
    }
}
