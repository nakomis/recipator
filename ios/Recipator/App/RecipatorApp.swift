import SwiftUI

@main
struct RecipatorApp: App {
    @StateObject private var auth = AuthService()

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isSignedIn {
                    RecipeListView()
                } else {
                    SignInView()
                }
            }
            .environmentObject(auth)
            .task { await auth.restore() }
        }
    }
}
