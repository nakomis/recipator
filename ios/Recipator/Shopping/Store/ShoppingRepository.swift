// ShoppingRepository.swift — the single data API the shopping UI uses (RECP-49, Phase B2).
//
// Reads and writes are local-first against ShoppingStore, so the list works fully offline and
// every action is instant. Each mutation also appends an outbox entry (handled by the store) for
// the Phase B3 background sync to push. New items are categorised on-device (cache → rules →
// Foundation Models); anything unresolved is stored in Other and carries a nil source so the sync
// can later ask the server's cloud LLM. Aisle corrections (a move) are written into the local
// cache so the next add of the same item lands correctly — even offline.
import Foundation

enum ShoppingRepositoryError: LocalizedError {
    case storeUnavailable
    var errorDescription: String? {
        switch self {
        case .storeUnavailable: return "The shopping list store is unavailable."
        }
    }
}

final class ShoppingRepository {
    static let shared = ShoppingRepository()

    private let store: ShoppingStore?

    init(store: ShoppingStore? = ShoppingStore.shared) {
        self.store = store
    }

    private func requireStore() throws -> ShoppingStore {
        guard let store else { throw ShoppingRepositoryError.storeUnavailable }
        return store
    }

    // MARK: - Reads

    func items() -> [ShoppingItem] { (try? store?.allItems()) ?? [] }

    func pendingSyncCount() -> Int { (try? store?.outboxCount()) ?? 0 }

    // MARK: - Seeding

    /// On first launch the local DB is empty; if we're online, pull the server snapshot once so
    /// the user starts with their existing list. Never overwrites a non-empty local DB (those
    /// edits are the source of truth until Phase B3 reconciles them). No-op offline.
    func seedIfEmptyFromServer() async {
        guard let store, (try? store.isEmpty()) == true else { return }
        guard await Connectivity.shared.isOnline else { return }
        guard let snapshot = try? await APIClient.shared.listShoppingItems() else { return }
        // Re-check emptiness: a fast offline add may have raced the network fetch.
        guard (try? store.isEmpty()) == true else { return }
        try? store.replaceAllFromServer(snapshot)
    }

    // MARK: - Mutations (instant, offline)

    /// Categorise on-device and add the item locally. `allowOnDeviceLlm` is left on; the cloud
    /// LLM is never called here (it's a sync concern) — an unresolved item lands in Other.
    @discardableResult
    func add(_ rawText: String) async throws -> ShoppingItem {
        let store = try requireStore()
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        let local = await Categoriser.categorise(text, cacheLookup: { [weak self] key in
            self?.cacheLookup(key)
        })
        let now = ShoppingClock.now()
        let item = ShoppingItem(
            itemId: UUID().uuidString.lowercased(),
            listId: ShoppingItem.defaultListId,
            raw: text,
            item: local.item,
            amount: local.amount,
            unit: local.unit,
            aisle: local.aisle ?? Aisle.other.rawValue,   // unresolved → Other; sync may refine
            checked: false,
            sortOrder: ShoppingClock.sortOrder(),
            createdAt: now,
            updatedAt: now,
            source: local.source                          // nil when unresolved on-device
        )
        try store.create(item)
        return item
    }

    func toggle(_ item: ShoppingItem) throws {
        let store = try requireStore()
        let now = ShoppingClock.now()
        let updated = item.with(checked: !item.checked, updatedAt: now)
        try store.save(updated, op: OutboxOp(kind: .update, itemId: item.itemId, checked: updated.checked, at: now))
    }

    /// Move an item to a different aisle and remember the correction in the local cache, so the
    /// next add of the same item text lands in the chosen aisle (RECP-34/49) — works offline.
    func move(_ item: ShoppingItem, to aisle: Aisle) throws {
        let store = try requireStore()
        guard aisle.rawValue != item.aisle else { return }
        let now = ShoppingClock.now()
        let updated = item.with(aisle: aisle.rawValue, updatedAt: now)
        try store.save(updated, op: OutboxOp(kind: .update, itemId: item.itemId, aisle: aisle.rawValue, at: now))
        try store.putCache(key: CacheKey.key(item.item), aisle: aisle.rawValue, item: item.item)
    }

    func delete(_ item: ShoppingItem) throws {
        try requireStore().remove(id: item.itemId, at: ShoppingClock.now())
    }

    func clearTicked() throws {
        _ = try requireStore().clearTicked(at: ShoppingClock.now())
    }

    func clearAll() throws {
        _ = try requireStore().clearAll(at: ShoppingClock.now())
    }

    // MARK: - Internal

    private func cacheLookup(_ key: String) -> (aisle: String, item: String)? {
        (try? store?.cacheLookup(key)) ?? nil
    }
}
