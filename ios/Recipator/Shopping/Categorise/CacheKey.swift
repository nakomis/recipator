import Foundation

/// Text normalisation shared by the on-device rules engine and the cache key (RECP-49).
/// Mirrors the server (`cacheKey`/`normalise` in infra/lambda/shared): lower-case, then
/// every character that isn't ASCII a–z or 0–9 becomes a space, runs of spaces collapse,
/// and the result is trimmed. Keeping this byte-identical to the server is what lets a
/// locally-categorised item share the server's cache key.
enum CategoriseText {
    private static let asciiAlnum = Set("abcdefghijklmnopqrstuvwxyz0123456789")

    /// Lower-cased, punctuation→space, whitespace-collapsed, trimmed.
    static func normalise(_ text: String) -> String {
        let lowered = text.lowercased()
        var scrubbed = ""
        scrubbed.reserveCapacity(lowered.count)
        for ch in lowered { scrubbed.append(asciiAlnum.contains(ch) ? ch : " ") }
        return scrubbed.split(separator: " ").joined(separator: " ")
    }
}

/// Normalised cache/grouping key for an item text — matches `cacheKey` on the server.
enum CacheKey {
    static func key(_ itemText: String) -> String { CategoriseText.normalise(itemText) }
}
