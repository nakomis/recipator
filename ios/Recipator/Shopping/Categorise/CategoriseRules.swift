import Foundation

/// On-device port of the server's deterministic grocery→aisle rules (RECP-49). Loads the
/// SAME categorise-rules.json that the Lambda uses (bundled into the app), and matches the
/// longest whole-word phrase, mirroring `ruleAisle` in infra/lambda/shared/categorise-rules.ts.
enum CategoriseRules {
    /// (phrase, aisle id) pairs, sorted most-specific (most words, then longest) first.
    private static let phrases: [(phrase: String, aisle: String)] = load()

    private static func load() -> [(String, String)] {
        guard let url = Bundle.main.url(forResource: "categorise-rules", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let map = try? JSONDecoder().decode([String: [String]].self, from: data)
        else { return [] }

        var pairs: [(String, String)] = []
        for (aisle, list) in map {
            for phrase in list { pairs.append((phrase, aisle)) }
        }
        pairs.sort { a, b in
            let wa = a.0.split(separator: " ").count
            let wb = b.0.split(separator: " ").count
            if wa != wb { return wa > wb }
            return a.0.count > b.0.count
        }
        return pairs
    }

    /// Aisle id of the most specific matching phrase, or nil if nothing matches (the caller
    /// then falls back to the on-device LLM / server). Whole-word matching via space-padding.
    static func aisle(for itemText: String) -> String? {
        guard !itemText.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let haystack = " \(CategoriseText.normalise(itemText)) "
        for (phrase, aisle) in phrases where haystack.contains(" \(phrase) ") {
            return aisle
        }
        return nil
    }
}
