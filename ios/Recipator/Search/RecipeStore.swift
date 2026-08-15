// RecipeStore.swift — local GRDB store backing on-device search:
//   • recipeEmbedding: embedding vectors for semantic search (when computed)
//   • recipeFTS:       FTS5 index over title/ingredients/method for keyword search
// Both are synced from the API in the background; search works on whatever's present.
import Foundation
import GRDB

struct StoredEmbedding {
    let recipeId: String
    let vector: [Float]
}

final class RecipeStore {
    static let shared = try? RecipeStore()

    private let dbQueue: DatabaseQueue

    init() throws {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        dbQueue = try DatabaseQueue(path: dir.appendingPathComponent("recipator.sqlite").path)
        try migrator.migrate(dbQueue)
    }

    private var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1") { db in
            try db.create(table: "recipeEmbedding") { t in
                t.primaryKey("recipeId", .text)
                t.column("userId", .text)
                t.column("model", .text)
                t.column("embeddedAt", .text)
                t.column("vector", .blob).notNull()   // float32 little-endian
            }
        }
        m.registerMigration("v2-fts") { db in
            // FTS5 over recipe text. recipeId is unindexed (a key, not searched).
            try db.create(virtualTable: "recipeFTS", using: FTS5()) { t in
                t.column("recipeId").notIndexed()
                t.column("title")
                t.column("ingredients")
                t.column("method")
            }
        }
        m.registerMigration("v3-fts-notes") { db in
            // FTS5 has no ADD COLUMN, so the index is rebuilt with `notes` (RECP-59).
            // Dropping the contents costs nothing: the index is a cache of the server's
            // /embeddings response and the next background sync refills it in full.
            try db.execute(sql: "DROP TABLE IF EXISTS recipeFTS")
            try db.create(virtualTable: "recipeFTS", using: FTS5()) { t in
                t.column("recipeId").notIndexed()
                t.column("title")
                t.column("ingredients")
                t.column("method")
                t.column("notes")
            }
        }
        return m
    }

    // MARK: - Sync

    /// Upsert search-index rows: text into FTS always, vector when present.
    func sync(_ rows: [SearchIndexRow]) throws {
        try dbQueue.write { db in
            for r in rows {
                // FTS5 has no UPSERT — replace the row for this recipe.
                try db.execute(sql: "DELETE FROM recipeFTS WHERE recipeId = ?", arguments: [r.recipeId])
                try db.execute(sql: """
                    INSERT INTO recipeFTS (recipeId, title, ingredients, method, notes)
                    VALUES (?, ?, ?, ?, ?)
                    """, arguments: [r.recipeId, r.title,
                                     r.ingredients.joined(separator: " "),
                                     r.method.joined(separator: " "),
                                     r.notes ?? ""])

                if let b64 = r.embedding, let data = Data(base64Encoded: b64) {
                    try db.execute(sql: """
                        INSERT INTO recipeEmbedding (recipeId, userId, model, embeddedAt, vector)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(recipeId) DO UPDATE SET
                            userId=excluded.userId, model=excluded.model,
                            embeddedAt=excluded.embeddedAt, vector=excluded.vector
                        """, arguments: [r.recipeId, r.userId, r.model, r.embeddedAt, data])
                }
            }
        }
    }

    /// Drop rows for recipes no longer present (e.g. deleted).
    func prune(keeping ids: Set<String>) throws {
        try dbQueue.write { db in
            for table in ["recipeEmbedding", "recipeFTS"] {
                let all = try String.fetchAll(db, sql: "SELECT recipeId FROM \(table)")
                for id in all where !ids.contains(id) {
                    try db.execute(sql: "DELETE FROM \(table) WHERE recipeId = ?", arguments: [id])
                }
            }
        }
    }

    // MARK: - Read

    /// Stored vectors for the given model tag only. Filtering by model is what makes a
    /// model switch safe: vectors from a previous model (different space/dimension) are
    /// never compared against the current query embedding — they're simply ignored until
    /// the background re-sync overwrites them with the new model's vectors.
    func embeddings(model: String, restrictedTo ids: Set<String>? = nil) throws -> [StoredEmbedding] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: "SELECT recipeId, vector FROM recipeEmbedding WHERE model = ?",
                             arguments: [model]).compactMap { row in
                let id: String = row["recipeId"]
                if let ids, !ids.contains(id) { return nil }
                let data: Data = row["vector"]
                return StoredEmbedding(recipeId: id, vector: data.toFloatArray())
            }
        }
    }

    /// FTS5 keyword search over title/ingredients/method/notes, best-match first (bm25).
    /// Tokens are sanitised and prefix-matched ("bind" matches "binding"); OR'd for recall.
    func ftsSearch(_ query: String, restrictedTo ids: Set<String>? = nil) throws -> [String] {
        let tokens = query.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 2 }
            .map { "\($0)*" }
        guard !tokens.isEmpty else { return [] }
        let match = tokens.joined(separator: " OR ")
        return try dbQueue.read { db in
            // Weights per column in table order (recipeId, title, ingredients, method, notes);
            // recipeId is unindexed so its weight is irrelevant. Title matches rank highest.
            // Notes are hand-written and deliberate, so they rank between ingredients and method.
            try String.fetchAll(db, sql: """
                SELECT recipeId FROM recipeFTS
                WHERE recipeFTS MATCH ?
                ORDER BY bm25(recipeFTS, 0.0, 10.0, 5.0, 3.0, 4.0)
                """, arguments: [match])
                .filter { ids?.contains($0) ?? true }
        }
    }

    func embeddingCount() throws -> Int {
        try dbQueue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM recipeEmbedding") ?? 0 }
    }
    func textCount() throws -> Int {
        try dbQueue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM recipeFTS") ?? 0 }
    }
}

extension Data {
    func toFloatArray() -> [Float] {
        withUnsafeBytes { raw in Array(raw.bindMemory(to: Float.self)) }
    }
}
