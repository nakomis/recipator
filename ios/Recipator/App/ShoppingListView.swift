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
    @FocusState private var addFocused: Bool

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
                if !checked.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Clear Ticked", role: .destructive) { Task { await clearTicked() } }
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    AccountMenu()
                }
                // Dismiss the keyboard — the add field otherwise has no way to close it.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { addFocused = false }
                }
            }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: { Text(error ?? "") }
        }
        .task { await load() }
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
                if AppConfig.isSandbox, let badge = sourceBadge(item.source) {
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
    }

    // MARK: - Actions

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { items = try await APIClient.shared.listShoppingItems() }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }

    private func add() async {
        let text = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isAdding else { return }
        isAdding = true
        defer { isAdding = false }
        do {
            let item = try await APIClient.shared.addShoppingItem(text: text)
            items.append(item)
            newItem = ""
            addFocused = true   // keep the keyboard up for rapid entry
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func toggle(_ item: ShoppingItem) async {
        // Optimistic flip for instant feedback; reconcile/revert on the server's response.
        setChecked(item.itemId, !item.checked)
        do { _ = try await APIClient.shared.updateShoppingItem(id: item.itemId, checked: !item.checked) }
        catch {
            setChecked(item.itemId, item.checked)
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete(_ item: ShoppingItem) async {
        let previous = items
        items.removeAll { $0.itemId == item.itemId }
        do { try await APIClient.shared.deleteShoppingItem(id: item.itemId) }
        catch {
            items = previous
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func clearTicked() async {
        let previous = items
        items.removeAll { $0.checked }
        do { try await APIClient.shared.clearTickedShoppingItems() }
        catch {
            items = previous
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func setChecked(_ id: String, _ checked: Bool) {
        guard let idx = items.firstIndex(where: { $0.itemId == id }) else { return }
        let it = items[idx]
        items[idx] = ShoppingItem(
            itemId: it.itemId, listId: it.listId, raw: it.raw, item: it.item,
            amount: it.amount, unit: it.unit, aisle: it.aisle, checked: checked,
            sortOrder: it.sortOrder, createdAt: it.createdAt, updatedAt: it.updatedAt,
            source: it.source
        )
    }
}
