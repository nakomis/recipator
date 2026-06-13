import Foundation

struct ExtractedRecipe {
    let title: String
    let ingredients: [String]
    let method: [String]
    let sourceURL: String

    var markdown: String {
        var md = "# \(title)\n\n"
        md += "Source: \(sourceURL)\n\n"
        md += "## Ingredients\n\n"
        for ingredient in ingredients {
            md += "- \(ingredient)\n"
        }
        md += "\n## Method\n\n"
        for (i, step) in method.enumerated() {
            md += "\(i + 1). \(step)\n"
        }
        return md
    }
}

final class RecipeExtractor {
    private let apiKey: String

    init(apiKey: String) {
        self.apiKey = apiKey
    }

    func extract(from url: URL) async throws -> ExtractedRecipe {
        var request = URLRequest(url: url)
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            forHTTPHeaderField: "User-Agent"
        )
        let (data, _) = try await URLSession.shared.data(for: request)
        let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""

        if let recipe = try? extractFromJSONLD(html: html, sourceURL: url.absoluteString), !recipe.ingredients.isEmpty {
            return recipe
        }

        return try await extractWithClaude(html: html, sourceURL: url.absoluteString)
    }

    // MARK: - JSON-LD (schema.org/Recipe)

    private func extractFromJSONLD(html: String, sourceURL: String) throws -> ExtractedRecipe? {
        let pattern = #"<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>"#
        let regex = try NSRegularExpression(pattern: pattern, options: .caseInsensitive)
        let matches = regex.matches(in: html, range: NSRange(html.startIndex..., in: html))

        for match in matches {
            guard let range = Range(match.range(at: 1), in: html),
                  let data = String(html[range]).data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data)
            else { continue }

            if let recipe = findRecipe(in: json, sourceURL: sourceURL) {
                return recipe
            }
        }
        return nil
    }

    private func findRecipe(in json: Any, sourceURL: String) -> ExtractedRecipe? {
        if let dict = json as? [String: Any] {
            let types = (dict["@type"] as? [String]) ?? ((dict["@type"] as? String).map { [$0] } ?? [])
            if types.contains("Recipe") {
                return parseRecipeDict(dict, sourceURL: sourceURL)
            }
            if let graph = dict["@graph"] as? [Any] {
                for item in graph {
                    if let found = findRecipe(in: item, sourceURL: sourceURL) { return found }
                }
            }
        }
        if let array = json as? [Any] {
            for item in array {
                if let found = findRecipe(in: item, sourceURL: sourceURL) { return found }
            }
        }
        return nil
    }

    private func parseRecipeDict(_ dict: [String: Any], sourceURL: String) -> ExtractedRecipe? {
        guard let name = dict["name"] as? String else { return nil }

        let ingredients = (dict["recipeIngredient"] as? [String]) ?? []

        let method: [String]
        if let instructions = dict["recipeInstructions"] as? [[String: Any]] {
            method = instructions.compactMap { step -> String? in
                if let text = step["text"] as? String { return text }
                if let name = step["name"] as? String { return name }
                return nil
            }
        } else if let instructions = dict["recipeInstructions"] as? [String] {
            method = instructions
        } else if let instruction = dict["recipeInstructions"] as? String {
            method = [instruction]
        } else {
            method = []
        }

        guard !ingredients.isEmpty || !method.isEmpty else { return nil }
        return ExtractedRecipe(title: name, ingredients: ingredients, method: method, sourceURL: sourceURL)
    }

    // MARK: - Claude Haiku fallback

    private func extractWithClaude(html: String, sourceURL: String) async throws -> ExtractedRecipe {
        let truncated = html.count > 40_000 ? String(html.prefix(40_000)) : html

        let prompt = """
        Extract the recipe from this HTML page. Return ONLY valid JSON in exactly this shape, with no explanation:
        {"title":"…","ingredients":["…"],"method":["…"]}
        If no recipe is found, return: {"error":"no recipe found"}

        HTML:
        \(truncated)
        """

        let body: [String: Any] = [
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 2048,
            "messages": [["role": "user", "content": prompt]]
        ]

        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let text = (response?["content"] as? [[String: Any]])?.first?["text"] as? String ?? ""

        guard let jsonData = text.data(using: .utf8),
              let result = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              result["error"] == nil,
              let title = result["title"] as? String,
              let ingredients = result["ingredients"] as? [String],
              let method = result["method"] as? [String]
        else {
            throw RecipeError.extractionFailed("Could not extract a recipe from this page.")
        }

        return ExtractedRecipe(title: title, ingredients: ingredients, method: method, sourceURL: sourceURL)
    }
}
