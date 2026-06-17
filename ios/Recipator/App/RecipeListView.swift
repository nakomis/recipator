import SwiftUI
import UIKit

private let everyoneTag = "__everyone__"

struct RecipeListView: View {
    @EnvironmentObject private var auth: AuthService
    @Environment(\.horizontalSizeClass) private var hSizeClass
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
    // Re-open the recipe the user last had open, across launches and sign-ins (RECP-56). Cleared
    // when they close it; a deleted/unreachable recipe is silently skipped on restore.
    @AppStorage("lastOpenRecipeId") private var lastOpenRecipeId = ""
    @AppStorage("lastOpenRecipeUserId") private var lastOpenRecipeUserId = ""

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

    // Owner filter — a segmented-style control showing each member's avatar (RECP-51) and first
    // name, plus an "Everyone" option. Custom (not a `.segmented` Picker) because that style
    // can't render the member avatars.
    private var ownerPicker: some View {
        HStack(spacing: 2) {
            ForEach(owners, id: \.userId) { owner in
                ownerSegment(title: owner.firstName, userId: owner.userId, tag: owner.userId)
            }
            ownerSegment(title: "Everyone", userId: nil, tag: everyoneTag)
        }
        .padding(2)
        .background(Color(.tertiarySystemFill), in: Capsule())
        // Size to content so names never truncate; the toolbar (iPad) gives it room, and on
        // iPhone it sits on its own row that scrolls if it can't fit (RECP-51).
        .fixedSize(horizontal: true, vertical: false)
    }

    /// True on iPhone-width layouts, where the picker doesn't fit in the toolbar alongside the
    /// refresh / sandbox / profile items, so it gets its own row below the search bar.
    private var ownerPickerNeedsOwnRow: Bool { hSizeClass == .compact }

    @ViewBuilder
    private func ownerSegment(title: String, userId: String?, tag: String) -> some View {
        let selected = selectedUserId == tag
        Button {
            selectedUserId = tag
        } label: {
            HStack(spacing: 5) {
                if let userId {
                    MemberAvatarView(userId: userId, size: 22)
                }
                Text(title)
                    .font(.subheadline.weight(selected ? .semibold : .regular))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(selected ? Color(.systemBackground) : .clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(selected ? Color.primary : .secondary)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
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
            VStack(spacing: 0) {
                // On iPhone the picker gets its own full-width row (it won't fit in the toolbar);
                // on iPad it lives in the toolbar's principal slot — see below.
                if isInGroup && ownerPickerNeedsOwnRow {
                    ScrollView(.horizontal, showsIndicators: false) {
                        ownerPicker.padding(.horizontal)
                    }
                    .padding(.bottom, 6)
                }
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
            }
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search recipes")
            .navigationTitle("Recipator")
            .toolbar {
                if isInGroup && !ownerPickerNeedsOwnRow {
                    ToolbarItem(placement: .principal) {
                        ownerPicker
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
                    ProfileButton()
                }
            }
            .alert("Error", isPresented: .constant(error != nil), actions: {
                Button("OK") { error = nil }
            }, message: { Text(error ?? "") })
            .fullScreenCover(item: $selected, onDismiss: {
                lastOpenRecipeId = ""
                lastOpenRecipeUserId = ""
            }) { detail in
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
            await restoreLastOpenRecipe()
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
        AvatarCache.shared.update(from: groupMembers)
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
            // Remember it so a relaunch or re-login lands the user back on this recipe (RECP-56).
            lastOpenRecipeId = id
            lastOpenRecipeUserId = userId ?? ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Re-open the last viewed recipe on launch/login (RECP-56). Best-effort: a recipe that's
    /// since been deleted or is unreachable is silently forgotten rather than raising an error.
    @MainActor
    private func restoreLastOpenRecipe() async {
        guard selected == nil, !lastOpenRecipeId.isEmpty else { return }
        let userId = lastOpenRecipeUserId.isEmpty ? nil : lastOpenRecipeUserId
        if let recipe = try? await APIClient.shared.getRecipe(id: lastOpenRecipeId, userId: userId) {
            selected = recipe
        } else {
            lastOpenRecipeId = ""
            lastOpenRecipeUserId = ""
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
                        if let uid = recipe.userId {
                            MemberAvatarView(userId: uid, size: 16)
                        }
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
    @EnvironmentObject private var auth: AuthService
    /// Ingredients ticked off while cooking, by index (so duplicate lines tick independently).
    /// Ephemeral per open — the heartbeat below keeps the session alive so a long cook won't
    /// drop you to the sign-in screen and lose them (RECP-56).
    @State private var checkedIngredients: Set<Int> = []

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

                Section {
                    ForEach(Array(recipe.ingredients.enumerated()), id: \.offset) { i, ingredient in
                        let isChecked = checkedIngredients.contains(i)
                        Button {
                            if isChecked { checkedIngredients.remove(i) } else { checkedIngredients.insert(i) }
                        } label: {
                            Label {
                                Text(ingredient)
                                    .strikethrough(isChecked)
                                    .foregroundStyle(isChecked ? .secondary : .primary)
                            } icon: {
                                Image(systemName: isChecked ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(isChecked ? Color.accentColor : .secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    HStack {
                        Text("Ingredients")
                        Spacer()
                        if !checkedIngredients.isEmpty {
                            Button {
                                checkedIngredients.removeAll()
                            } label: {
                                Text("Clear all")
                                    .font(.caption2.bold())
                                    .textCase(nil)
                                    .foregroundStyle(Color.accentColor)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Color.accentColor.opacity(0.15), in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Clear all ticked ingredients")
                        }
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
            // Heartbeat: while a recipe is open (screen kept awake for a long cook) the app makes
            // no API calls, so the access token could lapse and the next action would bounce to
            // sign-in. Ping accessToken() every few minutes — a no-op until the token nears expiry,
            // when it refreshes — so the session stays warm for the duration of the cook (RECP-56).
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(180))
                    if Task.isCancelled { break }
                    _ = await auth.accessToken()
                }
            }
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
