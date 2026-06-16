import XCTest
@testable import Recipator

/// Asserts the Swift categorisation port matches the server. The quantity + rules fixtures
/// are the SAME JSON the Jest suite asserts (RECP-49), so the two ports cannot drift. The
/// aisle test checks the Swift enum against the bundled canonical aisles.json.
final class CategoriseParityTests: XCTestCase {
    private struct QuantityCase: Decodable {
        let raw: String
        let amount: String?
        let unit: String?
        let itemText: String
    }
    private struct RuleCase: Decodable {
        let text: String
        let aisle: String?
    }

    private func loadFixture<T: Decodable>(_ name: String, _ type: T.Type) throws -> [T] {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"),
                                "missing fixture \(name).json")
        return try JSONDecoder().decode([T].self, from: Data(contentsOf: url))
    }

    func testQuantityFixtures() throws {
        for f in try loadFixture("quantity-fixtures", QuantityCase.self) {
            let parsed = QuantityParser.parse(f.raw)
            XCTAssertEqual(parsed.amount, f.amount, "amount for \"\(f.raw)\"")
            XCTAssertEqual(parsed.unit, f.unit, "unit for \"\(f.raw)\"")
            XCTAssertEqual(parsed.itemText, f.itemText, "itemText for \"\(f.raw)\"")
        }
    }

    func testRulesFixtures() throws {
        for f in try loadFixture("rules-fixtures", RuleCase.self) {
            XCTAssertEqual(CategoriseRules.aisle(for: f.text), f.aisle, "aisle for \"\(f.text)\"")
        }
    }

    /// The Aisle enum (ids + labels + order) must match the bundled canonical aisles.json.
    func testAisleEnumMatchesBundledJSON() throws {
        struct AisleRow: Decodable { let id: String; let label: String }
        let url = try XCTUnwrap(Bundle.main.url(forResource: "aisles", withExtension: "json"))
        let rows = try JSONDecoder().decode([AisleRow].self, from: Data(contentsOf: url))
        XCTAssertEqual(rows.map(\.id), Aisle.allCases.map(\.rawValue))
        XCTAssertEqual(rows.map(\.label), Aisle.allCases.map(\.label))
    }
}
