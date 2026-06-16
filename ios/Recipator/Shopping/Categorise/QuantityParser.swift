import Foundation

/// On-device port of the server's quantity parsing (RECP-40/RECP-49). Splits raw free text
/// ("4 pints of milk", "200ml cream", "1/2 cup cream", "milk x2") into {amount, unit} and the
/// remaining item text. Kept byte-for-byte in step with infra/lambda/shared/quantity.ts —
/// a shared fixtures file is asserted by both Jest and XCTest.
struct ParsedQuantity {
    let amount: String?
    let unit: String?
    let itemText: String
}

enum QuantityParser {
    // Known units → normalised id. Anything else is treated as part of the item text.
    private static let unitSynonyms: [String: String] = [
        "g": "g", "gram": "g", "grams": "g", "gramme": "g", "grammes": "g",
        "kg": "kg", "kilo": "kg", "kilos": "kg", "kilogram": "kg", "kilograms": "kg",
        "mg": "mg",
        "ml": "ml", "milliliter": "ml", "millilitre": "ml", "millilitres": "ml", "milliliters": "ml",
        "cl": "cl",
        "l": "l", "litre": "l", "litres": "l", "liter": "l", "liters": "l",
        "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
        "oz": "oz", "ounce": "oz", "ounces": "oz",
        "pt": "pt", "pint": "pt", "pints": "pt",
        "cup": "cup", "cups": "cup",
        "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
        "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp",
        "tin": "tin", "tins": "tin", "can": "can", "cans": "can",
        "pack": "pack", "packs": "pack", "packet": "pack", "packets": "pack",
        "bottle": "bottle", "bottles": "bottle",
        "jar": "jar", "jars": "jar",
        "box": "box", "boxes": "box",
        "bag": "bag", "bags": "bag",
        "bunch": "bunch", "bunches": "bunch",
        "clove": "clove", "cloves": "clove",
        "dozen": "dozen",
        "slice": "slice", "slices": "slice",
        "punnet": "punnet", "punnets": "punnet",
    ]

    // Units rendered with no space after the number ("200ml"); everything else gets a space.
    private static let tightUnits: Set<String> = ["g", "kg", "mg", "ml", "cl", "l"]

    private static let number = #"\d+\s*\/\s*\d+|\d+(?:\.\d+)?"#
    private static let leadingRE = regex("^\\s*(\(number))\\s*([a-zA-Z]+)?\\.?\\s*(.*)$")
    private static let trailingXRE = regex(#"^(.*?)\s*[x×]\s*(\d+)\s*$"#, caseInsensitive: true)
    private static let leadingXRE = regex(#"^\s*(\d+)\s*[x×]\s+(.*)$"#, caseInsensitive: true)

    static func parse(_ raw: String) -> ParsedQuantity {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if input.isEmpty { return ParsedQuantity(amount: nil, unit: nil, itemText: "") }

        // "2 x tomatoes" / "2x tomatoes" → count 2.
        if let m = firstMatch(leadingXRE, input), let amount = group(m, 1, input), let rest = group(m, 2, input) {
            return ParsedQuantity(amount: amount, unit: "x", itemText: rest.trimmingCharacters(in: .whitespaces))
        }

        // "milk x2" / "milk ×2" → count 2.
        if let m = firstMatch(trailingXRE, input), let head = group(m, 1, input),
           !head.trimmingCharacters(in: .whitespaces).isEmpty, let count = group(m, 2, input) {
            return ParsedQuantity(amount: count, unit: "x", itemText: head.trimmingCharacters(in: .whitespaces))
        }

        // Leading "<number><unit?> rest".
        if let m = firstMatch(leadingRE, input), let rawAmount = group(m, 1, input) {
            let amount = rawAmount.components(separatedBy: .whitespaces).joined()
            let word = (group(m, 2, input) ?? "").lowercased()
            let rest = group(m, 3, input) ?? ""
            if let unit = unitSynonyms[word] {
                return ParsedQuantity(amount: amount, unit: unit, itemText: stripLeadingOf(rest))
            }
            // The word after the number wasn't a unit — it's part of the item ("4 large eggs").
            let wordPrefix = (group(m, 2, input).map { "\($0) " }) ?? ""
            let itemText = stripLeadingOf("\(wordPrefix)\(rest)".trimmingCharacters(in: .whitespaces))
            return ParsedQuantity(amount: amount, unit: nil, itemText: itemText)
        }

        return ParsedQuantity(amount: nil, unit: nil, itemText: input)
    }

    /// Render a quantity for display, e.g. "200ml", "4 pt", "1/2 cup", "x2", "4". Mirrors
    /// `formatQuantity`. Returns nil when there is no quantity to show.
    static func format(amount: String?, unit: String?) -> String? {
        guard let amount, !amount.isEmpty else { return nil }
        guard let unit, !unit.isEmpty else { return amount }
        if unit == "x" { return "x\(amount)" }
        return tightUnits.contains(unit) ? "\(amount)\(unit)" : "\(amount) \(unit)"
    }

    // MARK: - Regex helpers

    private static func stripLeadingOf(_ text: String) -> String {
        let stripped = text.replacingOccurrences(
            of: #"^(?:of|x)\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
        return stripped.trimmingCharacters(in: .whitespaces)
    }

    private static func regex(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        let opts: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
        // swiftlint:disable:next force_try — patterns are constant and known-valid.
        return try! NSRegularExpression(pattern: pattern, options: opts)
    }

    private static func firstMatch(_ re: NSRegularExpression, _ s: String) -> NSTextCheckingResult? {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s))
    }

    /// A capture group's text, or nil if the group didn't participate (NSNotFound).
    private static func group(_ m: NSTextCheckingResult, _ idx: Int, _ s: String) -> String? {
        let r = m.range(at: idx)
        guard r.location != NSNotFound, let range = Range(r, in: s) else { return nil }
        return String(s[range])
    }
}
