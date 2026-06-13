import Foundation

// MARK: - Models

struct RecipeListItem: Codable, Identifiable {
    let recipeId: String
    let title: String
    let url: String
    let savedAt: String
    var id: String { recipeId }
}

struct RecipeDetail: Codable, Identifiable {
    let recipeId: String
    let title: String
    let url: String
    let savedAt: String
    let ingredients: [String]
    let method: [String]
    let markdown: String
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

    func listRecipes(includeDeleted: Bool = false) async throws -> [RecipeListItem] {
        let path = includeDeleted ? "/recipes?includeDeleted=true" : "/recipes"
        let data = try await request(path)
        struct Response: Decodable { let recipes: [RecipeListItem] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.recipes ?? []
    }

    func getRecipe(id: String) async throws -> RecipeDetail {
        let data = try await request("/recipes/\(id)")
        guard let detail = try? JSONDecoder().decode(RecipeDetail.self, from: data) else {
            throw APIError.server(0, "Decoding failed")
        }
        return detail
    }

    func deleteRecipe(id: String) async throws {
        _ = try await request("/recipes/\(id)", method: "DELETE")
    }

    func reportFailure(url: String, errorType: String, htmlSnippet: String? = nil) async throws {
        struct Body: Encodable { let url: String; let errorType: String; let htmlSnippet: String? }
        _ = try await request("/failures", method: "POST", body: Body(url: url, errorType: errorType, htmlSnippet: htmlSnippet))
    }
}
