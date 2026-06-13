import SwiftUI

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

    private func firstName(from email: String) -> String {
        let local = email.components(separatedBy: "@").first ?? email
        let first = local.components(separatedBy: ".").first ?? local
        return first.prefix(1).uppercased() + first.dropFirst()
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && allRecipes.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if displayedRecipes.isEmpty {
                    ContentUnavailableView(
                        "No Recipes Yet",
                        systemImage: "fork.knife",
                        description: Text("Share a recipe URL from Safari or Chrome to save it here.")
                    )
                } else {
                    List {
                        ForEach(displayedRecipes) { recipe in
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
                    .refreshable { await fetch() }
                }
            }
            .navigationTitle("Recipator")
            .toolbar {
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
                ToolbarItem(placement: .bottomBar) {
                    Text("v\(Bundle.main.appVersion)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Text(auth.displayName ?? "Signed in")
                        Divider()
                        Button("Sign Out", role: .destructive) { auth.signOut() }
                    } label: {
                        Image(systemName: "person.circle")
                    }
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
            await fetch()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { await fetch() }
        }
    }

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

    private func load(_ id: String, userId: String? = nil) async {
        do {
            selected = try await APIClient.shared.getRecipe(id: id, userId: userId)
        } catch {
            self.error = error.localizedDescription
        }
    }

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
