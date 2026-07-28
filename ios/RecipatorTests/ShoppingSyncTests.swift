import XCTest
@testable import Recipator

/// Phase B3 background sync (RECP-49): the outbox is pushed in order, a resolved item is sent
/// verbatim while an unresolved one defers to the server, a push failure keeps the outbox intact
/// and skips the pull, and a clean push reconciles the local DB to the server snapshot.
@MainActor
final class ShoppingSyncTests: XCTestCase {

    /// Records what the sync pushes and serves a configurable snapshot.
    private final class FakeAPI: ShoppingSyncAPI {
        struct Add { let text: String; let itemId: String?; let aisle: String?; let source: String?; let allowLlm: Bool }
        var adds: [Add] = []
        var deletes: [String] = []
        var listCalls = 0
        var snapshot: [ShoppingItem] = []
        var failAdds = false
        var failList = false
        /// Status the "server" rejects an add with. Defaults to 500 (transient) when `failAdds`.
        var addFailStatus = 500
        /// Per-item rejection, so a test can poison one op and watch the rest go through.
        var rejectAddsWithItemId: [String: Int] = [:]
        /// When set, a deferred create (no aisle sent) comes back categorised by the "server".
        var categoriseDeferredAs: (aisle: String, source: String)?

        func listShoppingItems() async throws -> [ShoppingItem] {
            if failList { throw APIError.server(500, "boom") }
            listCalls += 1; return snapshot
        }

        func addShoppingItem(text: String, itemId: String?, aisle: String?, source: String?, allowLlm: Bool) async throws -> ShoppingItem {
            if failAdds { throw APIError.server(addFailStatus, "boom") }
            if let id = itemId, let status = rejectAddsWithItemId[id] { throw APIError.server(status, "rejected") }
            adds.append(Add(text: text, itemId: itemId, aisle: aisle, source: source, allowLlm: allowLlm))
            if aisle == nil, let cat = categoriseDeferredAs {   // server placed an unresolved item
                return makeItem(id: itemId ?? UUID().uuidString, item: text, aisle: cat.aisle, source: cat.source)
            }
            return makeItem(id: itemId ?? UUID().uuidString, item: text, aisle: aisle ?? "other")
        }
        func updateShoppingItem(id: String, checked: Bool?, item: String?, aisle: String?) async throws -> ShoppingItem {
            makeItem(id: id, item: "", aisle: aisle ?? "other", checked: checked ?? false)
        }
        func deleteShoppingItem(id: String) async throws { deletes.append(id) }
        func clearTickedShoppingItems() async throws {}
        func clearAllShoppingItems() async throws {}
    }

    func testPushSendsResolvedVerbatimAndUnresolvedDeferred() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "r1", item: "milk", aisle: "dairy-eggs", source: "rules"))
        try store.create(makeItem(id: "u1", item: "sauerkraut", aisle: "other", source: nil))
        let api = FakeAPI()
        api.snapshot = [makeItem(id: "r1", item: "milk", aisle: "dairy-eggs"),
                        makeItem(id: "u1", item: "sauerkraut", aisle: "world-foods")]

        let sync = ShoppingSync(store: store, api: api, isOnline: { true }, isWiFi: { true })
        await sync.sync()

        XCTAssertEqual(api.adds.count, 2)
        let resolved = try XCTUnwrap(api.adds.first { $0.itemId == "r1" })
        XCTAssertEqual(resolved.aisle, "dairy-eggs")   // sent verbatim
        XCTAssertEqual(resolved.source, "rules")
        let unresolved = try XCTUnwrap(api.adds.first { $0.itemId == "u1" })
        XCTAssertNil(unresolved.aisle)                 // deferred to the server
        XCTAssertNil(unresolved.source)

        XCTAssertEqual(try store.outboxCount(), 0)     // outbox drained
        XCTAssertEqual(api.listCalls, 1)               // pulled once
        // Reconciled to the snapshot (the server placed sauerkraut in world-foods).
        let byId = Dictionary(uniqueKeysWithValues: try store.allItems().map { ($0.itemId, $0) })
        XCTAssertEqual(byId["u1"]?.aisle, "world-foods")
    }

    /// Regression (RECP-49): an item the device couldn't place is categorised by the server on
    /// the create push; the local row must adopt that aisle/source immediately — even if the
    /// follow-up pull fails — instead of being stranded in Other (the bug seen in prod: gravadlax
    /// categorised "chilled" server-side but stuck in Other on every device).
    func testCreateAdoptsServerCategorisationEvenWhenPullFails() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "g1", item: "gravadlax", aisle: "other", source: nil))
        let api = FakeAPI()
        api.categoriseDeferredAs = (aisle: "chilled", source: "llm")
        api.failList = true   // pull fails → reconcile never runs; only push-adoption can fix it

        let sync = ShoppingSync(store: store, api: api, isOnline: { true }, isWiFi: { true })
        await sync.sync()

        let item = try XCTUnwrap(try store.allItems().first { $0.itemId == "g1" })
        XCTAssertEqual(item.aisle, "chilled")          // adopted the server's categorisation
        XCTAssertEqual(item.source, "llm")
        XCTAssertEqual(try store.outboxCount(), 0)     // the create was pushed + drained
    }

    /// A local edit made after the create but before its push completes must not be clobbered by
    /// the server's create response (the adoption is guarded on an unchanged `updatedAt`).
    func testAdoptDoesNotClobberLocalEdit() async throws {
        let store = try ShoppingStore.inMemory()
        let created = makeItem(id: "g1", item: "gravadlax", aisle: "other", source: nil)
        try store.create(created)
        // User moves it locally (a distinctly later updatedAt) before the create's push response
        // lands. A fixed future stamp avoids same-millisecond ties with the create's timestamp.
        let moved = created.with(aisle: "world-foods", updatedAt: "2099-01-01T00:00:00.000Z")
        try store.save(moved, op: OutboxOp(kind: .update, itemId: "g1", aisle: "world-foods", at: moved.updatedAt))

        XCTAssertFalse(try store.adoptServerCreate(
            makeItem(id: "g1", item: "gravadlax", aisle: "chilled", source: "llm"),
            ifLocalUnchangedSince: created.updatedAt   // stale — the row changed since
        ))
        XCTAssertEqual(try store.allItems().first { $0.itemId == "g1" }?.aisle, "world-foods")
    }

    func testPushFailureKeepsOutboxAndSkipsPull() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "x", item: "milk", aisle: "dairy-eggs", source: "rules"))
        let api = FakeAPI()
        api.failAdds = true   // 500 — transient

        let sync = ShoppingSync(store: store, api: api, isOnline: { true }, isWiFi: { true })
        await sync.sync()

        XCTAssertEqual(try store.outboxCount(), 1) // create kept for retry
        XCTAssertEqual(api.listCalls, 0)           // no pull after a failed push
    }

    /// Regression (RECP-58): a permanently-rejected op must not wedge the queue. Previously any
    /// error kept the op in the outbox *and* skipped the pull, so a 4xx the server would return
    /// forever froze the device's view of the list — the cause of the 2026-07-28 stall where one
    /// device stopped seeing the other's changes for hours.
    func testPermanentRejectionDropsOpAndStillPulls() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "x", item: "milk", aisle: "dairy-eggs", source: "rules"))
        let api = FakeAPI()
        api.failAdds = true
        api.addFailStatus = 404
        api.snapshot = [makeItem(id: "server1", item: "bread", aisle: "bakery")]

        let sync = ShoppingSync(store: store, api: api, isOnline: { true }, isWiFi: { true })
        await sync.sync()

        XCTAssertEqual(try store.outboxCount(), 0)  // dropped rather than retried forever
        XCTAssertEqual(api.listCalls, 1)            // and the pull still ran
        XCTAssertEqual(try store.allItems().map(\.itemId), ["server1"])
    }

    /// 401 is transient — it clears once the token refreshes — so it must keep the op queued.
    func testUnauthorisedIsTreatedAsTransient() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "x", item: "milk", aisle: "dairy-eggs", source: "rules"))
        let api = FakeAPI()
        api.failAdds = true
        api.addFailStatus = 401

        let sync = ShoppingSync(store: store, api: api, isOnline: { true }, isWiFi: { true })
        await sync.sync()

        XCTAssertEqual(try store.outboxCount(), 1)
        XCTAssertEqual(api.listCalls, 0)
    }

    /// One poisoned op must not stop the ops behind it from reaching the server.
    func testPermanentRejectionDoesNotBlockLaterOps() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "bad", item: "milk", aisle: "dairy-eggs", source: "rules"))
        try store.create(makeItem(id: "good", item: "bread", aisle: "bakery", source: "rules"))
        let api = FakeAPI()
        // Reject only the first item; the second must still be pushed.
        api.rejectAddsWithItemId = ["bad": 404]

        let sync = ShoppingSync(store: store, api: api, isOnline: { true }, isWiFi: { true })
        await sync.sync()

        XCTAssertEqual(api.adds.map(\.itemId), ["good"])
        XCTAssertEqual(try store.outboxCount(), 0)
        XCTAssertEqual(api.listCalls, 1)
    }

    func testOfflineIsNoOp() async throws {
        let store = try ShoppingStore.inMemory()
        try store.create(makeItem(id: "x", item: "milk", aisle: "dairy-eggs", source: "rules"))
        let api = FakeAPI()

        let sync = ShoppingSync(store: store, api: api, isOnline: { false }, isWiFi: { false })
        await sync.sync()

        XCTAssertEqual(api.adds.count, 0)
        XCTAssertEqual(try store.outboxCount(), 1)
    }
}

/// Shared item builder for the sync tests (file-scope so the FakeAPI can use it too).
private func makeItem(
    id: String, item: String, aisle: String = "other", checked: Bool = false, source: String? = "rules"
) -> ShoppingItem {
    let now = ShoppingClock.now()
    return ShoppingItem(
        itemId: id, listId: ShoppingItem.defaultListId, raw: item, item: item,
        amount: nil, unit: nil, aisle: aisle, checked: checked, sortOrder: 0,
        createdAt: now, updatedAt: now, source: source
    )
}
