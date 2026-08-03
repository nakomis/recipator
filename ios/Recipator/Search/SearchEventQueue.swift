// SearchEventQueue.swift — durable, offline-tolerant queue for search-scoring events (RECP-21).
//
// Search runs entirely on-device and works with no network at all, so events cannot be posted
// synchronously at the point they happen. They are appended to a small JSON file in Application
// Support (alongside the search index) and flushed opportunistically; anything not acknowledged
// by the server stays queued for the next attempt.
//
// Nothing here is ever awaited on the UI path — a tap must not wait on a network call.
import Foundation

actor SearchEventQueue {
    static let shared = SearchEventQueue()

    /// Oldest events are dropped past this. Scoring tolerates gaps; unbounded disk growth on a
    /// long offline stretch does not.
    private let capacity = 500
    /// Must not exceed the server's per-batch limit.
    private let batchSize = 100

    private let fileURL: URL
    private var pending: [SearchEvent] = []
    private var loaded = false
    private var flushing = false

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("search-events.json")
    }

    // MARK: - Public

    func enqueue(_ event: SearchEvent) {
        load()
        pending.append(event)
        if pending.count > capacity { pending.removeFirst(pending.count - capacity) }
        persist()
        Task { await self.flush() }
    }

    /// Post queued events oldest-first, stopping at the first failure so ordering is preserved
    /// (a selection must never reach the server before the search it belongs to).
    func flush() async {
        load()
        guard !flushing, !pending.isEmpty else { return }
        flushing = true
        defer { flushing = false }

        while !pending.isEmpty {
            let batch = Array(pending.prefix(batchSize))
            do {
                try await APIClient.shared.postSearchEvents(batch)
                pending.removeFirst(batch.count)
                persist()
            } catch {
                // Offline, signed out, or a server error — keep everything and try later.
                print("search-events: flush deferred — \(error.localizedDescription)")
                return
            }
        }
    }

    // MARK: - Persistence

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let data = try? Data(contentsOf: fileURL) else { return }
        pending = (try? JSONDecoder().decode([SearchEvent].self, from: data)) ?? []
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        // .atomic so a crash mid-write can't leave a truncated file that fails to decode and
        // silently discards the whole queue on next launch.
        try? data.write(to: fileURL, options: .atomic)
    }
}
