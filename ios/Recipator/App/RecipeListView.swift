import SwiftUI

struct RecipeListView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var recipes: [(filename: String, content: String)] = []
    @State private var selectedContent: String?

    var body: some View {
        NavigationStack {
            Group {
                if recipes.isEmpty {
                    ContentUnavailableView(
                        "No Recipes Yet",
                        systemImage: "fork.knife",
                        description: Text("Share a recipe URL from Safari or Chrome to save it here.")
                    )
                } else {
                    List(recipes, id: \.filename) { recipe in
                        Button {
                            selectedContent = recipe.content
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(displayTitle(from: recipe.filename))
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                Text(recipe.filename)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
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
            .sheet(item: $selectedContent) { content in
                RecipeDetailView(markdown: content)
            }
        }
        .task { loadRecipes() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            loadRecipes()
        }
    }

    private func loadRecipes() {
        recipes = RecipeStore.shared.loadAll()
    }

    private func displayTitle(from filename: String) -> String {
        filename
            .replacingOccurrences(of: ".md", with: "")
            .dropFirst(11) // strip YYYY-MM-DD-
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
    }
}

struct RecipeDetailView: View {
    let markdown: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(markdown)
                    .font(.body.monospaced())
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: markdown)
                }
            }
        }
    }
}

extension String: @retroactive Identifiable {
    public var id: String { self }
}
