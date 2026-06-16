// ShoppingStore.swift — the local source of truth for the shopping list (RECP-49, Phase B2).
//
// The UI reads and writes here so the list works fully offline; every mutation also appends
// an `outbox` row that the background sync (Phase B3) will push to the server. A `categoryCache`
// table holds previously-resolved categorisations and the user's aisle corrections, so the
// on-device cascade (step 1) can place a repeat item instantly, even offline.
//
// Kept in a separate sqlite file from the search store (RecipeStore) so the two migrators
// evolve independently.
import Foundation
import GRDB

// ShoppingItem (declared in Shared/APIClient.swift) is the wire model; its stored properties map
// 1:1 onto the shoppingItem columns, so GRDB can persist it directly via its Codable conformance.
extension ShoppingItem: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "shoppingItem"
}

extension ShoppingItem {
    /// The default list id — matches the server's `DEFAULT_LIST_ID` (`infra/lambda/shopping/store.ts`).
    static let defaultListId = "default"

    /// A copy with selected fields changed — used to produce the edited row for a toggle/move/rename.
    func with(
        checked: Bool? = nil, aisle: String? = nil, item: String? = nil, updatedAt: String? = nil
    ) -> ShoppingItem {
        ShoppingItem(
            itemId: itemId, listId: listId, raw: raw, item: item ?? self.item,
            amount: amount, unit: unit, aisle: aisle ?? self.aisle, checked: checked ?? self.checked,
            sortOrder: sortOrder, createdAt: createdAt, updatedAt: updatedAt ?? self.updatedAt,
            source: source
        )
    }
}

/// One queued local mutation, replayed against the server by the Phase B3 sync. `at` is the
/// mutation's `updatedAt`, used for last-write-wins reconciliation. Stored as JSON in `outbox`.
struct OutboxOp: Codable {
    enum Kind: String, Codable { case create, update, delete, clearTicked, clearAll }
    let kind: Kind
    var item: ShoppingItem?     // create: the full row (with its client-generated itemId)
    var itemId: String?         // update / delete
    var checked: Bool?          // update
    var aisle: String?          // update (a move)
    var name: String?           // update (a rename of the item label)
    let at: String              // op timestamp (the new updatedAt)
}

struct OutboxEntry {
    let seq: Int64
    let op: OutboxOp
}

/// ISO-8601 timestamps that match the server's `new Date().toISOString()` (millisecond
/// precision, `Z`), so string comparison gives a correct chronological order for sync.
enum ShoppingClock {
    private static let fmt: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static func now() -> String { fmt.string(from: Date()) }
    /// Monotonic-ish ordering key, matching the server's `Date.now()` (epoch ms).
    static func sortOrder() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
}

final class ShoppingStore {
    static let shared = try? ShoppingStore()

    private let dbQueue: DatabaseQueue

    init(dbQueue: DatabaseQueue) throws {
        self.dbQueue = dbQueue
        try migrator.migrate(dbQueue)
    }

    convenience init() throws {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try self.init(dbQueue: DatabaseQueue(path: dir.appendingPathComponent("recipator-shopping.sqlite").path))
    }

    #if DEBUG
    /// An isolated in-memory store for unit tests (keeps GRDB out of the test target).
    static func inMemory() throws -> ShoppingStore { try ShoppingStore(dbQueue: DatabaseQueue()) }
    #endif

    private var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1") { db in
            try db.create(table: "shoppingItem") { t in
                t.primaryKey("itemId", .text)
                t.column("listId", .text).notNull()
                t.column("raw", .text).notNull()
                t.column("item", .text).notNull()
                t.column("amount", .text)
                t.column("unit", .text)
                t.column("aisle", .text).notNull()
                t.column("checked", .boolean).notNull()
                t.column("sortOrder", .integer).notNull()
                t.column("createdAt", .text).notNull()
                t.column("updatedAt", .text).notNull()
                t.column("source", .text)
            }
            // Learned categorisations + the user's aisle corrections, keyed on the normalised
            // item text (CacheKey) — byte-identical to the server's category cache key.
            try db.create(table: "categoryCache") { t in
                t.primaryKey("key", .text)
                t.column("aisle", .text).notNull()
                t.column("item", .text).notNull()
                t.column("updatedAt", .text).notNull()
            }
            // Pending local mutations awaiting push (Phase B3). `seq` preserves order.
            try db.create(table: "outbox") { t in
                t.autoIncrementedPrimaryKey("seq")
                t.column("kind", .text).notNull()
                t.column("payload", .text).notNull()    // JSON-encoded OutboxOp
                t.column("createdAt", .text).notNull()
            }
        }
        return m
    }

    // MARK: - Reads

    func isEmpty() throws -> Bool {
        try dbQueue.read { db in try ShoppingItem.fetchCount(db) == 0 }
    }

    func allItems() throws -> [ShoppingItem] {
        try dbQueue.read { db in try ShoppingItem.fetchAll(db) }
    }

    func cacheLookup(_ key: String) throws -> (aisle: String, item: String)? {
        try dbQueue.read { db in
            guard let row = try Row.fetchOne(
                db, sql: "SELECT aisle, item FROM categoryCache WHERE key = ?", arguments: [key]
            ) else { return nil }
            return (aisle: row["aisle"], item: row["item"])
        }
    }

    func outboxCount() throws -> Int {
        try dbQueue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM outbox") ?? 0 }
    }

    func pendingOutbox() throws -> [OutboxEntry] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: "SELECT seq, payload FROM outbox ORDER BY seq").compactMap { row in
                let seq: Int64 = row["seq"]
                let payload: String = row["payload"]
                guard let data = payload.data(using: .utf8),
                      let op = try? JSONDecoder().decode(OutboxOp.self, from: data) else { return nil }
                return OutboxEntry(seq: seq, op: op)
            }
        }
    }

    // MARK: - Mutations (local row + outbox, atomically)

    /// Insert a new locally-created item and queue its create.
    func create(_ item: ShoppingItem) throws {
        try dbQueue.write { db in
            try item.insert(db)
            try enqueue(OutboxOp(kind: .create, item: item, at: item.updatedAt), db)
        }
    }

    /// Upsert an edited item (toggle/move/rename) and queue the corresponding update.
    func save(_ item: ShoppingItem, op: OutboxOp) throws {
        try dbQueue.write { db in
            try item.save(db)
            try enqueue(op, db)
        }
    }

    func remove(id: String, at: String) throws {
        try dbQueue.write { db in
            _ = try ShoppingItem.deleteOne(db, key: id)
            try enqueue(OutboxOp(kind: .delete, itemId: id, at: at), db)
        }
    }

    @discardableResult
    func clearTicked(at: String) throws -> Int {
        try dbQueue.write { db in
            let n = try ShoppingItem.filter(Column("checked") == true).deleteAll(db)
            try enqueue(OutboxOp(kind: .clearTicked, at: at), db)
            return n
        }
    }

    @discardableResult
    func clearAll(at: String) throws -> Int {
        try dbQueue.write { db in
            let n = try ShoppingItem.deleteAll(db)
            try enqueue(OutboxOp(kind: .clearAll, at: at), db)
            return n
        }
    }

    /// Record a categorisation / correction in the local cache (no outbox — the cache is a
    /// local accelerator; corrections reach the server as part of the item's update op).
    func putCache(key: String, aisle: String, item: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: """
                INSERT INTO categoryCache (key, aisle, item, updatedAt) VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET aisle=excluded.aisle, item=excluded.item, updatedAt=excluded.updatedAt
                """, arguments: [key, aisle, item, ShoppingClock.now()])
        }
    }

    /// Remove an outbox entry once it has been pushed to the server (RECP-49 B3).
    func removeOutbox(seq: Int64) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM outbox WHERE seq = ?", arguments: [seq])
        }
    }

    // MARK: - Seeding & sync (server snapshot → local, no outbox)

    /// Replace the local item set with a server snapshot. Used to seed an empty DB on first
    /// launch; carries no outbox entries because it isn't a local mutation.
    func replaceAllFromServer(_ items: [ShoppingItem]) throws {
        try dbQueue.write { db in
            try ShoppingItem.deleteAll(db)
            for item in items { try item.insert(db) }
        }
    }

    /// Reconcile a server snapshot into the local DB after the outbox has been pushed (RECP-49 B3).
    /// Items still referenced by a pending outbox op are left untouched (a local change that hasn't
    /// been pushed yet wins); everything else is made to match the server — upserting present rows
    /// and deleting rows the server no longer has. With an empty outbox this is a full replace.
    func reconcile(serverItems: [ShoppingItem], pendingItemIds: Set<String>) throws {
        try dbQueue.write { db in
            let serverIds = Set(serverItems.map(\.itemId))
            for item in serverItems where !pendingItemIds.contains(item.itemId) {
                try item.save(db)
            }
            let localIds = try String.fetchAll(db, sql: "SELECT itemId FROM shoppingItem")
            for id in localIds where !serverIds.contains(id) && !pendingItemIds.contains(id) {
                _ = try ShoppingItem.deleteOne(db, key: id)
            }
        }
    }

    // MARK: - Internal

    private func enqueue(_ op: OutboxOp, _ db: Database) throws {
        let payload = String(data: try JSONEncoder().encode(op), encoding: .utf8) ?? "{}"
        try db.execute(
            sql: "INSERT INTO outbox (kind, payload, createdAt) VALUES (?, ?, ?)",
            arguments: [op.kind.rawValue, payload, ShoppingClock.now()]
        )
    }
}
