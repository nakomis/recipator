import SwiftUI

struct RecipeListView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var recipes: [RecipeListItem] = []
    @State private var selected: RecipeDetail?
    @State private var isLoading = false
    @State private var error: String?

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
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(recipe.title)
                                        .font(.body)
                                        .foregroundStyle(.primary)
                                    Text(recipe.url)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Delete", role: .destructive) {
                                    Task { await delete(recipe.recipeId) }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Recipator")
            .toolbar {
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
            .sheet(item: $selected) { detail in
                RecipeDetailView(recipe: detail)
            }
        }
        .task { await fetch() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            Task { await fetch() }
        }
    }

    private func fetch() async {
        isLoading = true
        defer { isLoading = false }
        do {
            recipes = try await APIClient.shared.listRecipes()
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

struct RecipeDetailView: View {
    let recipe: RecipeDetail
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Link(recipe.url, destination: URL(string: recipe.url)!)
                        .font(.caption)
                }

                Section("Ingredients") {
                    ForEach(recipe.ingredients, id: \.self) { Text($0) }
                }

                Section("Method") {
                    ForEach(Array(recipe.method.enumerated()), id: \.offset) { i, step in
                        Label {
                            Text(step)
                        } icon: {
                            Text("\(i + 1).")
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
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
}

extension String: @retroactive Identifiable {
    public var id: String { self }
}
