import SwiftUI

/// Signed-in root: Recipes and Shopping tabs (RECP-38).
struct MainTabView: View {
    var body: some View {
        TabView {
            RecipeListView()
                .tabItem { Label("Recipes", systemImage: "fork.knife") }
            ShoppingListView()
                .tabItem { Label("Shopping", systemImage: "cart") }
        }
    }
}
