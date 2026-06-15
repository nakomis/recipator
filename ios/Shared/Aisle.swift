import Foundation

/// Canonical supermarket aisle taxonomy — MIRROR of the server source of truth at
/// infra/lambda/shared/aisles.ts (RECP-36). Keep the raw-value ids and the case ORDER
/// in lockstep with that file and web/src/lib/aisles.ts. Declaration order is the
/// shop-route display/grouping order; `.other` is last.
///
/// The String raw value is the id stored on each item and emitted by the categoriser.
/// CaseIterable backs the on-device Foundation Models fast path (a fixed enum the model
/// is constrained to) — see RECP-35.
enum Aisle: String, CaseIterable, Codable {
    case produce = "produce"
    case bakery = "bakery"
    case meatFish = "meat-fish"
    case dairyEggs = "dairy-eggs"
    case chilled = "chilled"
    case frozen = "frozen"
    case cupboard = "cupboard"
    case pastaRiceGrains = "pasta-rice-grains"
    case baking = "baking"
    case condiments = "condiments"
    case snacks = "snacks"
    case drinks = "drinks"
    case worldFoods = "world-foods"
    case healthBeauty = "health-beauty"
    case household = "household"
    case babyPet = "baby-pet"
    case other = "other"

    /// Human-readable section heading.
    var label: String {
        switch self {
        case .produce:         return "Fruit & Vegetables"
        case .bakery:          return "Bakery"
        case .meatFish:        return "Meat & Fish"
        case .dairyEggs:       return "Dairy & Eggs"
        case .chilled:         return "Chilled & Deli"
        case .frozen:          return "Frozen"
        case .cupboard:        return "Tins, Jars & Packets"
        case .pastaRiceGrains: return "Pasta, Rice & Grains"
        case .baking:          return "Baking & Home Baking"
        case .condiments:      return "Condiments & Sauces"
        case .snacks:          return "Snacks & Confectionery"
        case .drinks:          return "Drinks"
        case .worldFoods:      return "World Foods"
        case .healthBeauty:    return "Health & Beauty"
        case .household:       return "Household & Cleaning"
        case .babyPet:         return "Baby & Pet"
        case .other:           return "Other"
        }
    }

    /// Shop-route sort index (declaration order).
    var order: Int { Aisle.allCases.firstIndex(of: self) ?? Aisle.allCases.count }

    /// Coerce an arbitrary id to a known aisle, falling back to `.other`.
    static func from(_ id: String) -> Aisle { Aisle(rawValue: id) ?? .other }
}
