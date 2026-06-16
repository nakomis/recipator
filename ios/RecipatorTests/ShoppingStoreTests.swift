import XCTest
@testable import Recipator

/// Phase B2 offline-first store + repository (RECP-49): local writes persist, the outbox grows,
/// the cache feeds categorisation, and a move's correction is honoured on the next add — all
/// without any network. Uses an isolated in-memory store (GRDB stays inside the app module).
final class ShoppingStoreTests: XCTestCase {

    private func makeItem(
        id: String = UUID().uuidString, item: String = "milk",
        aisle: String = "dairy-eggs", checked: Bool = false
    ) -> ShoppingItem {
        let now = ShoppingClock.now()
        return ShoppingItem(
            itemId: id, listId: ShoppingItem.defaultListId, raw: item, item: item,
            amount: nil, unit: nil, aisle: aisle, checked: checked, sortOrder: 0,
            createdAt: now, updatedAt: now, source: "rules"
        )
    }

    // MARK: - Store

    func testCreatePersistsItemAndQueuesOutbox() throws {
        let store = try ShoppingStore.inMemory()
        XCTAssertTrue(try store.isEmpty())
        try store.create(makeItem(item: "milk"))
        XCTAssertEqual(try store.allItems().count, 1)
        XCTAssertEqual(try store.outboxCount(), 1)
        XCTAssertEqual(try store.pendingOutbox().first?.op.kind, .create)
        XCTAssertEqual(try store.pendingOutbox().first?.op.item?.item, "milk")
    }

    func testSaveUpdatesRowAndQueuesUpdate() throws {
        let store = try ShoppingStore.inMemory()
        let item = makeItem()
        try store.create(item)
        let toggled = item.with(checked: true, updatedAt: ShoppingClock.now())
        try store.save(toggled, op: OutboxOp(kind: .update, itemId: item.itemId, checked: true, at: toggled.updatedAt))
        XCTAssertEqual(try store.allItems().first?.checked, true)
        XCTAssertEqual(try store.outboxCount(), 2)
    }

    func testRemoveDeletesAndQueuesDelete() throws {
        let store = try ShoppingStore.inMemory()
        let item = makeItem()
        try store.create(item)
        try store.remove(id: item.itemId, at: ShoppingClock.now())
        XCTAssertTrue(try store.isEmpty())
        XCTAssertEqual(try store.pendingOutbox().last?.op.kind, .delete)
    }

    func testClearTickedRemovesOnlyChecked() throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "a", checked: true))
        try store.create(makeItem(id: "b", checked: false))
        XCTAssertEqual(try store.clearTicked(at: ShoppingClock.now()), 1)
        XCTAssertEqual(try store.allItems().map(\.itemId), ["b"])
    }

    func testCacheRoundTrip() throws {
        let store = try ShoppingStore.inMemory()
        XCTAssertNil(try store.cacheLookup("gochujang"))
        try store.putCache(key: "gochujang", aisle: "world-foods", item: "gochujang")
        XCTAssertEqual(try store.cacheLookup("gochujang")?.aisle, "world-foods")
    }

    func testReplaceAllFromServerSeedsWithoutOutbox() throws {
        let store = try ShoppingStore.inMemory()
        try store.replaceAllFromServer([makeItem(id: "x", item: "eggs"), makeItem(id: "y", item: "bread")])
        XCTAssertEqual(try store.allItems().count, 2)
        XCTAssertEqual(try store.outboxCount(), 0) // seeding is not a local mutation
    }

    func testReconcileMatchesServerWhenNothingPending() throws {
        let store = try ShoppingStore.inMemory()
        try store.replaceAllFromServer([makeItem(id: "a", item: "eggs"), makeItem(id: "b", item: "bread")])
        // Server now has b (moved aisle) and a new c; a is gone.
        try store.reconcile(
            serverItems: [makeItem(id: "b", item: "bread", aisle: "frozen"), makeItem(id: "c", item: "peas")],
            pendingItemIds: []
        )
        let byId = Dictionary(uniqueKeysWithValues: try store.allItems().map { ($0.itemId, $0) })
        XCTAssertNil(byId["a"])                    // deleted server-side
        XCTAssertEqual(byId["b"]?.aisle, "frozen") // updated
        XCTAssertNotNil(byId["c"])                 // added
    }

    func testReconcilePreservesPendingItems() throws {
        let store = try ShoppingStore.inMemory()
        try store.replaceAllFromServer([makeItem(id: "a", item: "eggs"), makeItem(id: "b", item: "bread")])
        // "a" has an un-pushed local change; the server snapshot omits it. It must survive.
        try store.reconcile(serverItems: [makeItem(id: "b", item: "bread")], pendingItemIds: ["a"])
        XCTAssertEqual(Set(try store.allItems().map(\.itemId)), ["a", "b"])
    }

    // MARK: - Categoriser cache step

    func testCacheHitWinsOverRules() async {
        // "milk" matches the rules table (dairy-eggs), but a cache hit (a learned correction)
        // must take precedence — step 1 beats step 2.
        let result = await Categoriser.categorise("milk", cacheLookup: { key in
            key == "milk" ? (aisle: "world-foods", item: "milk") : nil
        })
        XCTAssertEqual(result.aisle, "world-foods")
        XCTAssertEqual(result.source, "cache")
    }

    // MARK: - Repository (offline, end-to-end)

    func testRepositoryAddCategorisesAndPersistsOffline() async throws {
        let repo = ShoppingRepository(store: try ShoppingStore.inMemory())
        let item = try await repo.add("200ml milk")
        XCTAssertEqual(item.aisle, "dairy-eggs") // rules
        XCTAssertEqual(item.amount, "200")
        XCTAssertEqual(item.unit, "ml")
        XCTAssertEqual(repo.items().count, 1)
        XCTAssertEqual(repo.pendingSyncCount(), 1)
    }

    func testMoveWritesCorrectionThatNextAddHonoursOffline() async throws {
        let repo = ShoppingRepository(store: try ShoppingStore.inMemory())
        let item = try await repo.add("milk")       // rules → dairy-eggs
        XCTAssertEqual(item.aisle, "dairy-eggs")
        try repo.move(item, to: .worldFoods)         // correction → cache
        let again = try await repo.add("milk")       // should now hit the cache
        XCTAssertEqual(again.aisle, "world-foods")
        XCTAssertEqual(again.source, "cache")
    }
}
