// RecipeSearchModel.swift — orchestrates the on-device semantic search:
// model preparation, embedding sync, and query → ranked recipe IDs.
import Foundation
import Combine

@MainActor
final class RecipeSearchModel: ObservableObject {
    @Published private(set) var modelStatus: EmbeddingModelManager.Status = .idle
    @Published private(set) var syncedCount: Int = 0

    let manager = EmbeddingModelManager()
    private let store = RecipeStore.shared
    private var statusObservation: Task<Void, Never>?

    /// Minimum cosine similarity for a result to be considered a match.
    private let minScore: Float = 0.3

    var isReady: Bool { manager.isReady }

    init() {
        // Mirror the manager's status onto our own published property.
        statusObservation = Task { [weak self] in
            guard let self else { return }
            for await s in self.manager.$status.values {
                self.modelStatus = s
            }
        }
    }

    /// Download/compile the model (background) then sync embeddings. Idempotent.
    func prepare() async {
        await manager.prepare()
        await sync()
    }

    /// Incrementally pull new embeddings and prune deleted ones.
    func sync(knownRecipeIds: Set<String>? = nil) async {
        guard let store else { return }
        do {
            let since = try store.latestEmbeddedAt()
            let rows = try await APIClient.shared.getEmbeddings(all: true, since: since)
            if !rows.isEmpty { try store.upsert(rows) }
            if let knownRecipeIds { try store.prune(keeping: knownRecipeIds) }
            syncedCount = (try? store.count()) ?? syncedCount
        } catch {
            // Sync failures are non-fatal; search still works on what's cached.
            print("search: sync failed — \(error.localizedDescription)")
        }
    }

    /// Rank recipe IDs by semantic similarity to `query`, restricted to `candidates`
    /// (the currently-displayed owner filter). Returns IDs best-first.
    func search(_ query: String, candidates: Set<String>) async -> [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let store, let embedder = manager.embedder else { return [] }

        let prefixed = manager.queryPrefix + trimmed
        guard let qv = await Task.detached(priority: .userInitiated, operation: {
            embedder.embed(prefixed)
        }).value else { return [] }

        let rows = (try? store.embeddings(restrictedTo: candidates)) ?? []
        let scored = await Task.detached(priority: .userInitiated) { [minScore] in
            rows.map { ($0.recipeId, Cosine.similarity(qv, $0.vector)) }
                .filter { $0.1 >= minScore }
                .sorted { $0.1 > $1.1 }
                .map(\.0)
        }.value
        return scored
    }
}
