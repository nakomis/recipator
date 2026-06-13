import SwiftUI

enum RecipeScope: String, CaseIterable {
    case everyone = "Everyone"
    case mine     = "Mine"
}

struct RecipeListView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var recipes: [RecipeListItem] = []
    @State private var selected: RecipeDetail?
    @State private var isLoading = false
    @State private var error: String?
    @State private var scope: RecipeScope = .everyone

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && recipes.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if recipes.isEmpty {
                    ContentUnavailableView(
                        "No Recipes Yet",
                        systemImage: "fork.knife",
                        description: Text("Share a recipe URL from Safari or Chrome to save it here.")
                    )
                } else {
                    List {
                        ForEach(recipes) { recipe in
                            Button {
                                Task { await load(recipe.recipeId) }
                            } label: {
                                RecipeRow(recipe: recipe, showOwner: scope == .everyone)
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
                    Picker("", selection: $scope) {
                        ForEach(RecipeScope.allCases, id: \.self) {
                            Text($0.rawValue).tag($0)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 160)
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
        .task { await fetch() }
        .onChange(of: scope) { Task { await fetch() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { await fetch() }
        }
    }

    private func fetch() async {
        isLoading = true
        defer { isLoading = false }
        do {
            recipes = try await APIClient.shared.listRecipes(all: scope == .everyone)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func load(_ id: String) async {
        do {
            selected = try await APIClient.shared.getRecipe(id: id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete(_ id: String) async {
        do {
            try await APIClient.shared.deleteRecipe(id: id)
            recipes.removeAll { $0.recipeId == id }
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
            // Source favicon placeholder
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.accentColor.opacity(0.12))
                .frame(width: 44, height: 44)
                .overlay {
                    Image(systemName: "fork.knife")
                        .foregroundStyle(Color.accentColor)
                }

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
