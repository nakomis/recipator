import SwiftUI

@main
struct RecipatorApp: App {
    @StateObject private var auth = AuthService()

    init() {
        // Force dark mode app-wide so the Cognito login page always uses the One Dark theme.
        UIWindow.appearance().overrideUserInterfaceStyle = .dark
    }

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
