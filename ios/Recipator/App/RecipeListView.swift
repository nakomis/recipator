import SwiftUI
import UIKit

private let everyoneTag = "__everyone__"

struct RecipeListView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var allRecipes: [RecipeListItem] = []
    @State private var selected: RecipeDetail?
    @State private var isLoading = false
    @State private var error: String?
    // Filter key: userId (sub UUID) — consistent across access token & stored data.
    // The segmented picker uses userId as the tag value; everyoneTag is the sentinel for "all".
    @State private var selectedUserId: String = ""
    @State private var groupMembers: [GroupMember] = []
    @StateObject private var search = RecipeSearchModel()
    @State private var searchText = ""
    @State private var rankedIds: [String]? = nil   // nil = not yet computed for this query

    private var isInGroup: Bool {
        guard let uid = auth.userId else { return false }
        return groupMembers.contains { $0.userId == uid }
    }

    private var myUserId: String { auth.userId ?? "" }

    // Current user first, then others, deduplicated by userId (not email, which can vary).
    private var owners: [(userId: String, firstName: String)] {
        var seen = Set<String>()
        var result: [(String, String)] = []
        let me = myUserId
        if !me.isEmpty {
            seen.insert(me)
            let myLabel = auth.displayName.map { firstName(from: $0) } ?? "Me"
            result.append((me, myLabel))
        }
        for recipe in allRecipes {
            if let uid = recipe.userId, !seen.contains(uid) {
                seen.insert(uid)
                result.append((uid, recipe.ownerFirstName ?? uid))
            }
        }
        return result
    }

    private var displayedRecipes: [RecipeListItem] {
        guard selectedUserId != everyoneTag, !selectedUserId.isEmpty else { return allRecipes }
        return allRecipes.filter { $0.userId == selectedUserId }
    }

    private var trimmedQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var isSearching: Bool { !trimmedQuery.isEmpty }

    // When searching, reorder the owner-filtered list by semantic rank (best first).
    private var visibleRecipes: [RecipeListItem] {
        guard isSearching else { return displayedRecipes }
        guard let ranked = rankedIds else { return [] }
        let byId = Dictionary(displayedRecipes.map { ($0.recipeId, $0) }, uniquingKeysWith: { a, _ in a })
        return ranked.compactMap { byId[$0] }
    }

    private func firstName(from email: String) -> String {
        let local = email.components(separatedBy: "@").first ?? email
        let first = local.components(separatedBy: ".").first ?? local
        return first.prefix(1).uppercased() + first.dropFirst()
    }

    var body: some View {
        NavigationStack {
            Group {
                if isSearching {
                    searchContent
                } else if isLoading && allRecipes.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if displayedRecipes.isEmpty {
                    ContentUnavailableView(
                        "No Recipes Yet",
                        systemImage: "fork.knife",
                        description: Text("Share a recipe URL from Safari or Chrome to save it here.")
                    )
                } else {
                    recipeList(displayedRecipes, refreshable: true)
                }
            }
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search recipes")
            .navigationTitle("Recipator")
            .toolbar {
                if isInGroup {
                    ToolbarItem(placement: .principal) {
                        Picker("", selection: $selectedUserId) {
                            ForEach(owners, id: \.userId) { owner in
                                Text(owner.firstName).tag(owner.userId)
                            }
                            Text("Everyone").tag(everyoneTag)
                        }
                        .pickerStyle(.segmented)
                        .frame(minWidth: 200, maxWidth: 320)
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await fetch() }
                    } label: {
                        if isLoading {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isLoading)
                }
                if AppConfig.isSandbox {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text("SANDBOX")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.green, in: Capsule())
                            .accessibilityLabel("Sandbox environment")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    AccountMenu()
                }
            }
            .alert("Error", isPresented: .constant(error != nil), actions: {
                Button("OK") { error = nil }
            }, message: { Text(error ?? "") })
            .fullScreenCover(item: $selected) { detail in
                RecipeDetailView(recipe: detail)
            }
        }
        .task {
            if selectedUserId.isEmpty {
                selectedUserId = myUserId.isEmpty ? everyoneTag : myUserId
            }
            async let config: () = loadConfig()
            async let recipes: () = fetch()
            _ = await (config, recipes)
            // Sync the search index immediately (enables keyword search now); prepare the
            // embedding model in parallel (enables semantic search once it lands).
            Task { await search.sync(knownRecipeIds: Set(allRecipes.map(\.recipeId))) }
            Task { await search.prepare() }
        }
        // Debounced search: recompute when the query settles, and again whenever the search
        // index is re-synced (search.indexVersion) so freshly-synced data fills in live.
        .task(id: "\(search.indexVersion)\u{0}\(searchText)") {
            guard isSearching else { rankedIds = nil; return }
            guard search.hasSearchCapability else { rankedIds = nil; return }
            rankedIds = nil
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            let candidates = Set(displayedRecipes.map(\.recipeId))
            let result = await search.search(searchText, candidates: candidates)
            if !Task.isCancelled { rankedIds = result }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            // Re-fetch the list AND re-sync the search index — a recipe added via the share
            // extension while backgrounded must become searchable without a cold relaunch.
            Task {
                await fetch()
                await search.sync(knownRecipeIds: Set(allRecipes.map(\.recipeId)))
            }
        }
    }

    // MARK: - Search UI

    @ViewBuilder
    private var searchContent: some View {
        if !search.hasSearchCapability {
            ContentUnavailableView {
                Label(searchPrepLabel, systemImage: "sparkles")
            } description: {
                Text("Search is getting ready. This happens once.")
            }
        } else if rankedIds == nil {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleRecipes.isEmpty {
            ContentUnavailableView.search(text: trimmedQuery)
        } else {
            recipeList(visibleRecipes, refreshable: false)
        }
    }

    private var searchPrepLabel: String {
        switch search.modelStatus {
        case .downloading: return "Downloading search model…"
        case .preparing:   return "Preparing search…"
        case .failed:      return "Search unavailable"
        default:           return "Preparing search…"
        }
    }

    @ViewBuilder
    private func recipeList(_ recipes: [RecipeListItem], refreshable: Bool) -> some View {
        let list = List {
            ForEach(recipes) { recipe in
                Button {
                    Task { await load(recipe.recipeId, userId: recipe.userId) }
                } label: {
                    RecipeRow(recipe: recipe, showOwner: selectedUserId == everyoneTag)
                }
                .swipeActions(edge: .trailing) {
                    Button("Delete", role: .destructive) {
                        Task { await delete(recipe.recipeId) }
                    }
                }
            }
        }
        if refreshable {
            list.refreshable { await fetch() }
        } else {
            list
        }
    }

    // These mutate @State that drives the List, so they must stay on the main actor: a
    // plain `async` method resumes on the cooperative pool after an `await`, and an off-main
    // mutation interleaving with an animated list update crashes UIKit's batch-update check
    // ("invalid number of items in section 0"). @MainActor pins the post-await mutations.
    @MainActor
    private func loadConfig() async {
        groupMembers = (try? await APIClient.shared.getConfig()) ?? []
    }

    @MainActor
    private func fetch() async {
        isLoading = true
        defer { isLoading = false }
        do {
            allRecipes = try await APIClient.shared.listRecipes(all: true)
            if selectedUserId.isEmpty {
                selectedUserId = myUserId.isEmpty ? everyoneTag : myUserId
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func load(_ id: String, userId: String? = nil) async {
        do {
            selected = try await APIClient.shared.getRecipe(id: id, userId: userId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ id: String) async {
        do {
            try await APIClient.shared.deleteRecipe(id: id)
            allRecipes.removeAll { $0.recipeId == id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct RecipeRow: View {
    let recipe: RecipeListItem
    var showOwner: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let imageUrl = recipe.imageUrl, let url = URL(string: imageUrl) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        } else {
                            placeholderIcon
                        }
                    }
                } else {
                    placeholderIcon
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(recipe.title)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    if showOwner, let name = recipe.ownerFirstName {
                        Text(name)
                            .font(.caption.bold())
                            .foregroundStyle(Color.accentColor)
                        Text("·")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    Text(domain(from: recipe.url))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("·")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Text(formattedDate(recipe.savedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var placeholderIcon: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.accentColor.opacity(0.12))
            .overlay { Image(systemName: "fork.knife").foregroundStyle(Color.accentColor) }
    }

    private func domain(from urlString: String) -> String {
        URL(string: urlString)?.host?
            .replacingOccurrences(of: "www.", with: "") ?? urlString
    }

    private func formattedDate(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return iso
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct RecipeDetailView: View {
    let recipe: RecipeDetail
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let imageUrl = recipe.imageUrl, let url = URL(string: imageUrl) {
                    Section {
                        AsyncImage(url: url) { phase in
                            if let image = phase.image {
                                image.resizable().aspectRatio(contentMode: .fill)
                            } else {
                                Color.secondary.opacity(0.1).overlay { ProgressView() }
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    }
                }

                Section {
                    Link(domain(from: recipe.url), destination: URL(string: recipe.url)!)
                        .font(.subheadline)
                        .foregroundStyle(Color.accentColor)
                }

                Section("Ingredients") {
                    ForEach(recipe.ingredients, id: \.self) { ingredient in
                        Label(ingredient, systemImage: "circle")
                            .labelStyle(.titleAndIcon)
                    }
                }

                Section("Method") {
                    ForEach(Array(recipe.method.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .top, spacing: 12) {
                            Text("\(i + 1)")
                                .font(.subheadline.bold())
                                .foregroundStyle(.white)
                                .frame(width: 24, height: 24)
                                .background(Color.accentColor)
                                .clipShape(Circle())
                            Text(step)
                                .font(.body)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .navigationTitle(recipe.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: recipe.markdown)
                }
            }
            // Keep the screen awake while a recipe is open (you're cooking from it,
            // hands busy) — but only here, not on the list. Reset on dismiss.
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        }
    }

    private func domain(from urlString: String) -> String {
        URL(string: urlString)?.host?
            .replacingOccurrences(of: "www.", with: "") ?? urlString
    }
}

extension String: @retroactive Identifiable {
    public var id: String { self }
}
