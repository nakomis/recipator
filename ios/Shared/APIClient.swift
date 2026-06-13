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

// MARK: - Errors

enum APIError: LocalizedError {
    case notAuthenticated
    case tokenExpired
    case server(Int, String)
    case noURLFound
    case extractionFailed

    var errorDescription: String {
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

    func extract(url: URL) async throws -> RecipeDetail {
        struct Body: Encodable { let url: String }
        let data = try await request("/extract", method: "POST", body: Body(url: url.absoluteString))
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

    func reportFailure(url: String, errorType: String, htmlSnippet: String? = nil) async throws {
        struct Body: Encodable { let url: String; let errorType: String; let htmlSnippet: String? }
        _ = try await request("/failures", method: "POST", body: Body(url: url, errorType: errorType, htmlSnippet: htmlSnippet))
    }
}
