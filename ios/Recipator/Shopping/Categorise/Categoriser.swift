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

/// The on-device categorisation cascade (RECP-49). Phase B1 implements the steps that need
/// no local store: deterministic rules, then the on-device LLM (Foundation Models). The local
/// cache (step 1) and learned corrections arrive with the local DB in Phase B2; the remote
/// LLM (step 4) and the Other fallback (step 5) are decided server-side when this returns an
/// unresolved aisle.
enum Categoriser {
    static func categorise(_ raw: String) async -> LocalCategorisation {
        let q = QuantityParser.parse(raw)
        let basis = q.itemText.isEmpty ? raw : q.itemText
        let label = cleanLabel(q.itemText.isEmpty ? raw : q.itemText)

        // 2. Deterministic rules — free, instant. (1. local cache lands in B2.)
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
