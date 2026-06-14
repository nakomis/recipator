// RecipeStore.swift — local GRDB store of recipe metadata + embedding vectors,
// synced from the API. Vectors live here so semantic search works offline and fast.
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
        return m
    }

    // MARK: - Sync

    /// Latest embeddedAt we hold, for incremental ?since= sync.
    func latestEmbeddedAt() throws -> String? {
        try dbQueue.read { db in
            try String.fetchOne(db, sql: "SELECT MAX(embeddedAt) FROM recipeEmbedding")
        }
    }

    func upsert(_ rows: [SyncedEmbedding]) throws {
        try dbQueue.write { db in
            for r in rows {
                guard let data = Data(base64Encoded: r.embedding) else { continue }
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

    /// Drop vectors for recipes no longer present (e.g. deleted).
    func prune(keeping ids: Set<String>) throws {
        try dbQueue.write { db in
            let all = try String.fetchAll(db, sql: "SELECT recipeId FROM recipeEmbedding")
            for id in all where !ids.contains(id) {
                try db.execute(sql: "DELETE FROM recipeEmbedding WHERE recipeId = ?", arguments: [id])
            }
        }
    }

    // MARK: - Read

    /// All embeddings, optionally restricted to a set of recipe IDs (for the active owner filter).
    func embeddings(restrictedTo ids: Set<String>? = nil) throws -> [StoredEmbedding] {
        try dbQueue.read { db in
            try Row.fetchAll(db, sql: "SELECT recipeId, vector FROM recipeEmbedding").compactMap { row in
                let id: String = row["recipeId"]
                if let ids, !ids.contains(id) { return nil }
                let data: Data = row["vector"]
                return StoredEmbedding(recipeId: id, vector: data.toFloatArray())
            }
        }
    }

    func count() throws -> Int {
        try dbQueue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM recipeEmbedding") ?? 0 }
    }
}

extension Data {
    func toFloatArray() -> [Float] {
        withUnsafeBytes { raw in Array(raw.bindMemory(to: Float.self)) }
    }
}
