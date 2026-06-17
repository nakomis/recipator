import SwiftUI

/// Signed-in root: Recipes and Shopping tabs (RECP-38).
struct MainTabView: View {
    /// Restore the last tab the user had open across launches and sign-ins (RECP-56).
    @AppStorage("selectedTab") private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            RecipeListView()
                .tabItem { Label("Recipes", systemImage: "fork.knife") }
                .tag(0)
            ShoppingListView()
                .tabItem { Label("Shopping", systemImage: "cart") }
                .tag(1)
        }
    }
}
