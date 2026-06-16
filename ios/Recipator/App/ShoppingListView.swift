import SwiftUI

/// The day-to-day shopping list (RECP-38): quick text add, items grouped into aisle
/// sections in shop-route order, tap to tick/untick, swipe to delete, clear ticked.
/// Server-backed via the /shopping API; the optional on-device Foundation Models fast
/// path for instant aisle assignment is a follow-up (see RECP-35).
struct ShoppingListView: View {
    @State private var items: [ShoppingItem] = []
    @State private var newItem = ""
    @State private var isLoading = false
    @State private var isAdding = false
    @State private var error: String?
    @State private var confirmClearAll = false
    @FocusState private var addFocused: Bool
    @AppStorage(SettingsKeys.showBadges) private var showBadges = AppConfig.isSandbox
    @ObservedObject private var sync = ShoppingSync.shared

    private var unchecked: [ShoppingItem] { items.filter { !$0.checked } }
    private var checked: [ShoppingItem] { items.filter { $0.checked } }

    // Aisle sections in shop-route order; within an aisle, same-item lines sit adjacently
    // (sort by item label) then by sortOrder — RECP-40.
    private var groups: [(aisle: Aisle, items: [ShoppingItem])] {
        Dictionary(grouping: unchecked) { Aisle.from($0.aisle) }
            .map { (aisle: $0.key, items: $0.value.sorted(by: itemsAdjacent)) }
            .sorted { $0.aisle.order < $1.aisle.order }
    }

    /// Sandbox-only label + colour for how an item was categorised. "llm" is the Bedrock
    /// Lambda; an on-device source (RECP-35) would map to its own badge when it lands.
    private func sourceBadge(_ source: String?) -> (label: String, colour: Color)? {
        switch source {
        case "rules":    return ("rules", .gray)
        case "cache":    return ("cache", .teal)
        case "llm":      return ("Lambda", .orange)
        case "device":   return ("on-device", .green)
        case "fallback": return ("other", .brown)
        default:         return nil
        }
    }

    private func itemsAdjacent(_ a: ShoppingItem, _ b: ShoppingItem) -> Bool {
        let byName = a.item.localizedCaseInsensitiveCompare(b.item)
        if byName != .orderedSame { return byName == .orderedAscending }
        return a.sortOrder < b.sortOrder
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                addBar
                listContent
            }
            .navigationTitle("Shopping")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    syncStatus
                }
                if !items.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            if !checked.isEmpty {
                                Button("Clear Ticked", role: .destructive) { Task { await clearTicked() } }
                            }
                            Button("Clear All", role: .destructive) { confirmClearAll = true }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    ProfileButton()
                }
                // Dismiss the keyboard — the add field otherwise has no way to close it.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { addFocused = false }
                }
            }
            .confirmationDialog("Clear the whole list?", isPresented: $confirmClearAll,
                                titleVisibility: .visible) {
                Button("Clear All", role: .destructive) { Task { await clearAll() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes every item, ticked or not. This can't be undone.")
            }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: { Text(error ?? "") }
        }
        .task { await load() }
        .onChange(of: sync.isSyncing) { _, syncing in
            // Any background sync (post-add, foreground, connectivity regained, BG refresh) just
            // reconciled the local DB — re-read so adopted server categorisations appear live,
            // not only after a manual pull-to-refresh (RECP-49).
            if !syncing { items = repo.items() }
        }
    }

    /// A subtle sync status: a spinner while syncing, or a count of changes waiting to upload
    /// (e.g. edits made offline). Nothing when idle and fully in sync (RECP-49 B3).
    @ViewBuilder
    private var syncStatus: some View {
        if sync.isSyncing {
            ProgressView().controlSize(.small)
        } else if sync.pendingCount > 0 {
            Label("\(sync.pendingCount)", systemImage: "arrow.triangle.2.circlepath")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(sync.pendingCount) changes waiting to sync")
        }
    }

    private var addBar: some View {
        HStack {
            TextField("Add an item… e.g. 4 pints of milk", text: $newItem)
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .focused($addFocused)
                .onSubmit { Task { await add() } }
            if isAdding {
                ProgressView()
            } else {
                Button {
                    Task { await add() }
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .disabled(newItem.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var listContent: some View {
        if isLoading && items.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if items.isEmpty {
            ContentUnavailableView(
                "List is empty",
                systemImage: "cart",
                description: Text("Add an item above to get started.")
            )
        } else {
            List {
                ForEach(groups, id: \.aisle) { group in
                    Section(group.aisle.label) {
                        ForEach(group.items) { item in
                            row(item)
                        }
                    }
                }
                if !checked.isEmpty {
                    Section("Ticked") {
                        ForEach(checked) { item in
                            row(item)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await load() }
        }
    }

    private func row(_ item: ShoppingItem) -> some View {
        Button {
            Task { await toggle(item) }
        } label: {
            HStack {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.checked ? Color.accentColor : .secondary)
                Text(item.displayLabel)
                    .strikethrough(item.checked)
                    .foregroundStyle(item.checked ? .secondary : .primary)
                Spacer()
                if showBadges, let badge = sourceBadge(item.source) {
                    Text(badge.label)
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(badge.colour, in: Capsule())
                        .accessibilityLabel("Categorised by \(badge.label)")
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button("Delete", role: .destructive) { Task { await delete(item) } }
        }
        .contextMenu {
            Menu("Move to aisle") {
                ForEach(Aisle.allCases.filter { $0 != Aisle.from(item.aisle) }, id: \.self) { aisle in
                    Button(aisle.label) { Task { await move(item, to: aisle) } }
                }
            }
        }
    }

    // MARK: - Actions

    private let repo = ShoppingRepository.shared

    /// Push the local change to the server in the background (RECP-49 B3), then refresh the list
    /// from the reconciled local DB — so a server-categorised item (adopted on the create push)
    /// appears in its aisle without needing a manual pull-to-refresh.
    private func kickSync() { Task { await sync.sync(); items = repo.items() } }

    private func load() async {
        // The local DB is the source of truth — read it instantly (works offline). The first time
        // only (empty DB + online) seed from the server snapshot, then re-read (RECP-49 B2).
        items = repo.items()
        if items.isEmpty {
            isLoading = true
            await repo.seedIfEmptyFromServer()
            items = repo.items()
            isLoading = false
        }
        // Push anything pending and pull the latest, then refresh from the reconciled local DB.
        await sync.sync()
        items = repo.items()
    }

    private func add() async {
        let text = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isAdding else { return }
        isAdding = true
        defer { isAdding = false }
        do {
            // Categorise on-device (cache → rules → Foundation Models) and add locally — instant
            // and fully offline (RECP-49). Anything on-device can't place lands in Other; the
            // background sync refines it via the cloud LLM when permitted + online.
            _ = try await repo.add(text)
            items = repo.items()
            newItem = ""
            addFocused = true   // keep the keyboard up for rapid entry
            kickSync()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ item: ShoppingItem) async {
        do { try repo.toggle(item); items = repo.items(); kickSync() }
        catch { self.error = error.localizedDescription }
    }

    private func delete(_ item: ShoppingItem) async {
        do { try repo.delete(item); items = repo.items(); kickSync() }
        catch { self.error = error.localizedDescription }
    }

    private func clearTicked() async {
        do { try repo.clearTicked(); items = repo.items(); kickSync() }
        catch { self.error = error.localizedDescription }
    }

    private func clearAll() async {
        do { try repo.clearAll(); items = repo.items(); kickSync() }
        catch { self.error = error.localizedDescription }
    }

    /// Move an item to a different aisle. The correction is remembered in the local cache so the
    /// next add of the same item text lands there too — even offline (RECP-34/49).
    private func move(_ item: ShoppingItem, to aisle: Aisle) async {
        do { try repo.move(item, to: aisle); items = repo.items(); kickSync() }
        catch { self.error = error.localizedDescription }
    }
}
