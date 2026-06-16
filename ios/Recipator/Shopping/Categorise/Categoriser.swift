import Foundation

/// Result of on-device categorisation (RECP-49). `aisle`/`source` are nil when the device
/// couldn't place the item and the server should decide (remote LLM if permitted, else Other).
struct LocalCategorisation {
    let item: String
    let amount: String?
    let unit: String?
    let aisle: String?
    let source: String?   // "cache" | "rules" | "device" — nil = unresolved
}

/// The on-device categorisation cascade (RECP-49): 1. local cache (incl. learned corrections),
/// 2. deterministic rules, 3. on-device LLM (Foundation Models). The cache lookup is injected
/// (the cache lives in the local DB — Phase B2), so this stays pure and unit-testable; callers
/// without a cache (e.g. parity tests) omit it. The remote LLM (step 4) and the Other fallback
/// (step 5) are decided server-side when this returns an unresolved aisle.
enum Categoriser {
    /// Resolve an item against the local cache, keyed on its normalised text. Returns the cached
    /// aisle + label, or nil on a miss.
    typealias CacheLookup = (_ key: String) -> (aisle: String, item: String)?

    static func categorise(_ raw: String, cacheLookup: CacheLookup? = nil) async -> LocalCategorisation {
        let q = QuantityParser.parse(raw)
        let basis = q.itemText.isEmpty ? raw : q.itemText
        let label = cleanLabel(q.itemText.isEmpty ? raw : q.itemText)

        // 1. Local cache — a previously-resolved item or a learned aisle correction.
        if let cacheLookup, let hit = cacheLookup(CacheKey.key(basis)) {
            let cachedLabel = cleanLabel(hit.item)
            return LocalCategorisation(
                item: cachedLabel.isEmpty ? label : cachedLabel,
                amount: q.amount, unit: q.unit, aisle: hit.aisle, source: "cache"
            )
        }

        // 2. Deterministic rules — free, instant.
        if let aisle = CategoriseRules.aisle(for: basis) {
            return LocalCategorisation(item: label, amount: q.amount, unit: q.unit, aisle: aisle, source: "rules")
        }

        // 3. On-device LLM (Foundation Models), when available.
        if let aisle = await OnDeviceCategoriser.aisle(for: basis) {
            return LocalCategorisation(item: label, amount: q.amount, unit: q.unit, aisle: aisle, source: "device")
        }

        // Unresolved on-device → server decides (remote LLM if permitted, else Other).
        return LocalCategorisation(item: label, amount: q.amount, unit: q.unit, aisle: nil, source: nil)
    }

    private static func cleanLabel(_ text: String) -> String {
        text.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).joined(separator: " ")
    }
}
