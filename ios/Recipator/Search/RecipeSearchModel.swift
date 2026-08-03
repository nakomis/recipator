// RecipeSearchModel.swift — orchestrates on-device search: model prep, index sync,
// and query → ranked recipe IDs. Combines keyword (FTS5) and semantic (embedding) results.
//
// Keyword search works as soon as text is synced — it does NOT wait for the model.
// Semantic search joins in once the model is downloaded/compiled. Results merge with
// literal keyword hits first (high confidence), then semantically-similar recipes.
import Foundation
import Combine

/// One search's results, keeping the keyword and semantic rankings separate alongside the
/// merged list the user actually sees.
///
/// Search always runs both strategies, so retaining all three rankings lets a single real
/// search score all three counterfactually — the selected recipe's rank in each is recorded
/// on tap (RECP-21). Only `ranked` was seen by the user; the other two are "where this would
/// have appeared", which is why the dashboard notes position bias.
struct SearchOutcome {
    let searchId: String
    /// The merged list, keyword hits first — what the UI renders.
    let ranked: [String]
    let keywordRanked: [String]
    let semanticRanked: [String]
    /// False until the embedding model has downloaded and compiled; semantic is empty until then.
    let semanticAvailable: Bool
    let latencyMs: Int
    let keywordMs: Int
    let semanticMs: Int
}

@MainActor
final class RecipeSearchModel: ObservableObject {
    @Published private(set) var modelStatus: EmbeddingModelManager.Status = .idle
    @Published private(set) var textCount: Int = 0
    /// Bumped whenever a sync writes to the index. Views key their search task on this so an
    /// active query re-ranks automatically once freshly-synced text/vectors land — without
    /// the user retyping or relaunching (e.g. a recipe whose vector arrives moments after add).
    @Published private(set) var indexVersion: Int = 0

    let manager = EmbeddingModelManager()
    private let store = RecipeStore.shared
    private var statusObservation: Task<Void, Never>?

    /// Minimum cosine similarity for a semantic result to count.
    private let minScore: Float = 0.3

    /// Search is usable if we have any keyword text synced OR the model is ready.
    var hasSearchCapability: Bool { textCount > 0 || manager.isReady }
    var semanticReady: Bool { manager.isReady }

    init() {
        statusObservation = Task { [weak self] in
            guard let self else { return }
            for await s in self.manager.$status.values { self.modelStatus = s }
        }
        textCount = (try? store?.textCount()) ?? 0
    }

    /// Download/compile the model (background) then sync the search index. Idempotent.
    func prepare() async {
        await manager.prepare()
    }

    /// Full background sync of recipe text + vectors, then prune deletions.
    func sync(knownRecipeIds: Set<String>? = nil) async {
        guard let store else { return }
        do {
            let rows = try await APIClient.shared.getSearchIndex(all: true)
            if !rows.isEmpty { try store.sync(rows) }
            if let knownRecipeIds { try store.prune(keeping: knownRecipeIds) }
            textCount = (try? store.textCount()) ?? textCount
            // Signal any active search to re-rank against the now-updated index. Counts alone
            // miss the case where only a vector changed (text already present), so bump always.
            indexVersion &+= 1
        } catch {
            print("search: sync failed — \(error.localizedDescription)")
        }
    }

    /// Ranked recipe IDs for `query`, restricted to `candidates` (the owner filter).
    /// Keyword (FTS) hits rank first; semantically-similar recipes follow.
    func search(_ query: String, candidates: Set<String>) async -> SearchOutcome {
        let clock = ContinuousClock()
        let started = clock.now
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let store else { return .empty }

        // 1. Keyword hits (fast, no model needed).
        let keywordStart = clock.now
        let keyword = (try? store.ftsSearch(trimmed, restrictedTo: candidates)) ?? []
        let keywordMs = Self.elapsedMs(from: keywordStart, clock: clock)

        // 2. Semantic hits (only if the model is ready).
        var semantic: [String] = []
        let semanticStart = clock.now
        if let embedder = manager.embedder, let modelVersion = manager.version {
            let prefixed = manager.queryPrefix + trimmed
            if let qv = await Task.detached(priority: .userInitiated, operation: {
                embedder.embed(prefixed)
            }).value {
                // Only vectors from the current model — see RecipeStore.embeddings(model:).
                let rows = (try? store.embeddings(model: modelVersion, restrictedTo: candidates)) ?? []
                semantic = await Task.detached(priority: .userInitiated) { [minScore] in
                    rows.map { ($0.recipeId, Cosine.similarity(qv, $0.vector)) }
                        .filter { $0.1 >= minScore }
                        .sorted { $0.1 > $1.1 }
                        .map(\.0)
                }.value
            }
        }
        let semanticMs = Self.elapsedMs(from: semanticStart, clock: clock)

        // 3. Merge: keyword first (literal matches), then new semantic matches.
        var seen = Set<String>()
        var merged: [String] = []
        for id in keyword + semantic where seen.insert(id).inserted { merged.append(id) }

        return SearchOutcome(
            searchId: UUID().uuidString,
            ranked: merged,
            keywordRanked: keyword,
            semanticRanked: semantic,
            semanticAvailable: manager.isReady,
            latencyMs: Self.elapsedMs(from: started, clock: clock),
            keywordMs: keywordMs,
            semanticMs: semanticMs,
        )
    }

    /// Whole milliseconds elapsed. 1ms = 10^15 attoseconds.
    private static func elapsedMs(from start: ContinuousClock.Instant, clock: ContinuousClock) -> Int {
        let d = clock.now - start
        return Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
    }
}

extension SearchOutcome {
    /// Used when a search short-circuits (empty query, no store) — never logged.
    static let empty = SearchOutcome(
        searchId: "", ranked: [], keywordRanked: [], semanticRanked: [],
        semanticAvailable: false, latencyMs: 0, keywordMs: 0, semanticMs: 0,
    )

    var isEmpty: Bool { searchId.isEmpty }

    /// 1-based position of `recipeId` in each ranking, or nil where that strategy did not
    /// return it. `visible` is the owner-filtered list actually shown, so all three ranks are
    /// measured against the same projection and the hybrid rank is the row the user tapped.
    func ranks(of recipeId: String, visible: [String]) -> (hybrid: Int?, keyword: Int?, semantic: Int?) {
        func rank(_ list: [String]) -> Int? {
            let shown = Set(visible)
            let projected = list.filter { shown.contains($0) }
            guard let idx = projected.firstIndex(of: recipeId) else { return nil }
            return idx + 1
        }
        return (rank(visible), rank(keywordRanked), rank(semanticRanked))
    }
}
