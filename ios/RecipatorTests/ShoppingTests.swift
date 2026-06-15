import XCTest

final class ShoppingTests: XCTestCase {
    private func makeItem(item: String, amount: String?, unit: String?, checked: Bool = false,
                          aisle: String = "other") -> ShoppingItem {
        ShoppingItem(
            itemId: "1", listId: "default", raw: "", item: item, amount: amount, unit: unit,
            aisle: aisle, checked: checked, sortOrder: 0, createdAt: "", updatedAt: ""
        )
    }

    func testQuantityLabel() {
        XCTAssertEqual(makeItem(item: "Cream", amount: "200", unit: "ml").quantityLabel, "200ml")
        XCTAssertEqual(makeItem(item: "Milk", amount: "4", unit: "pt").quantityLabel, "4 pt")
        XCTAssertEqual(makeItem(item: "Cream", amount: "1/2", unit: "cup").quantityLabel, "1/2 cup")
        XCTAssertEqual(makeItem(item: "Milk", amount: "2", unit: "x").quantityLabel, "x2")
        XCTAssertEqual(makeItem(item: "Eggs", amount: "6", unit: nil).quantityLabel, "6")
        XCTAssertNil(makeItem(item: "Bin bags", amount: nil, unit: nil).quantityLabel)
    }

    func testDisplayLabel() {
        XCTAssertEqual(makeItem(item: "Cream", amount: "200", unit: "ml").displayLabel, "Cream (200ml)")
        XCTAssertEqual(makeItem(item: "Bin bags", amount: nil, unit: nil).displayLabel, "Bin bags")
    }

    func testAisleTaxonomy() {
        // Produce comes before Other in shop-route order; Other is last.
        XCTAssertLessThan(Aisle.produce.order, Aisle.other.order)
        XCTAssertEqual(Aisle.allCases.last, .other)
        XCTAssertEqual(Aisle.from("dairy-eggs"), .dairyEggs)
        XCTAssertEqual(Aisle.from("not-real"), .other)
        XCTAssertEqual(Aisle.dairyEggs.label, "Dairy & Eggs")
    }
}
