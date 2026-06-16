// ShoppingSync.swift — background reconciliation between the local store and the server
// (RECP-49, Phase B3). The local DB is the source of truth (Phase B2); this pushes the queued
// outbox mutations, then pulls the server snapshot and reconciles it back, so the list converges
// across devices and the web app. Triggered on connectivity regained, app foreground, after a
// local mutation, and by a periodic background-refresh task (see RecipatorApp).
import Foundation
import SwiftUI

/// The subset of the API the sync needs. A protocol so tests can drive it with a fake (the real
/// conformance is `APIClient`).
protocol ShoppingSyncAPI {
    func listShoppingItems() async throws -> [ShoppingItem]
    func addShoppingItem(text: String, itemId: String?, aisle: String?, source: String?, allowLlm: Bool) async throws -> ShoppingItem
    func updateShoppingItem(id: String, checked: Bool?, item: String?, aisle: String?) async throws -> ShoppingItem
    func deleteShoppingItem(id: String) async throws
    func clearTickedShoppingItems() async throws
    func clearAllShoppingItems() async throws
}

extension APIClient: ShoppingSyncAPI {}

@MainActor
final class ShoppingSync: ObservableObject {
    static let shared = ShoppingSync()

    /// A spinner while a sync runs, and the count of un-pushed mutations — for a subtle status.
    @Published private(set) var isSyncing = false
    @Published private(set) var pendingCount = 0

    private let store: ShoppingStore?
    private let api: ShoppingSyncAPI
    private let isOnline: @MainActor () -> Bool
    private let isWiFi: @MainActor () -> Bool
    private var inFlight = false

    init(
        store: ShoppingStore? = ShoppingStore.shared,
        api: ShoppingSyncAPI = APIClient.shared,
        isOnline: @escaping @MainActor () -> Bool = { Connectivity.shared.isOnline },
        isWiFi: @escaping @MainActor () -> Bool = { Connectivity.shared.isWiFi }
    ) {
        self.store = store
        self.api = api
        self.isOnline = isOnline
        self.isWiFi = isWiFi
        refreshPending()
    }

    func refreshPending() { pendingCount = (try? store?.outboxCount()) ?? 0 }

    /// Push the outbox, then pull + reconcile. Safe to call repeatedly — concurrent calls coalesce,
    /// and it's a no-op offline (the pending mutations simply wait for the next trigger).
    func sync() async {
        guard let store, !inFlight else { return }
        guard isOnline() else { refreshPending(); return }
        inFlight = true
        isSyncing = true
        defer { inFlight = false; isSyncing = false; refreshPending() }

        // The cloud LLM only ever runs server-side now, gated by the user's settings: never in
        // offline-only mode, and on mobile data only when "Cloud sorting on mobile data" is on.
        let allowCloudLlm = !offlineOnly && (isWiFi() || cloudOnCellular)

        // 1. Push the outbox in order; stop at the first failure and keep the remainder for next time.
        let pending = (try? store.pendingOutbox()) ?? []
        for entry in pending {
            do {
                try await push(entry.op, allowCloudLlm: allowCloudLlm)
                try store.removeOutbox(seq: entry.seq)
            } catch {
                return // network/server error — retry the rest on the next trigger
            }
        }

        // 2. Pull the authoritative snapshot and reconcile, preserving any mutation that raced in
        //    during the push (it stays in the outbox and is pushed next time).
        guard let snapshot = try? await api.listShoppingItems() else { return }
        try? store.reconcile(serverItems: snapshot, pendingItemIds: pendingItemIds())
    }

    // MARK: - Internal

    private func pendingItemIds() -> Set<String> {
        let ops = (try? store?.pendingOutbox()) ?? []
        return Set(ops.compactMap { $0.op.itemId ?? $0.op.item?.itemId })
    }

    private func push(_ op: OutboxOp, allowCloudLlm: Bool) async throws {
        switch op.kind {
        case .create:
            guard let item = op.item else { return }
            // Resolved on-device → store the decision verbatim. Unresolved (nil source) → send no
            // aisle so the server categorises it (cloud LLM, if allowed).
            let resolved = item.source != nil
            _ = try await api.addShoppingItem(
                text: item.raw,
                itemId: item.itemId,
                aisle: resolved ? item.aisle : nil,
                source: resolved ? item.source : nil,
                allowLlm: allowCloudLlm
            )
        case .update:
            guard let id = op.itemId else { return }
            _ = try await api.updateShoppingItem(id: id, checked: op.checked, item: op.name, aisle: op.aisle)
        case .delete:
            guard let id = op.itemId else { return }
            try await api.deleteShoppingItem(id: id)
        case .clearTicked:
            try await api.clearTickedShoppingItems()
        case .clearAll:
            try await api.clearAllShoppingItems()
        }
    }

    private var offlineOnly: Bool { UserDefaults.standard.bool(forKey: SettingsKeys.offlineOnly) }
    private var cloudOnCellular: Bool {
        UserDefaults.standard.object(forKey: SettingsKeys.cloudOnCellular) == nil
            ? true
            : UserDefaults.standard.bool(forKey: SettingsKeys.cloudOnCellular)
    }
}
