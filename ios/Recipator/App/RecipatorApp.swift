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
            // Sandbox builds get a green accent throughout so the environment is
            // unmistakable; production keeps the default tint.
            .tint(AppConfig.isSandbox ? .green : nil)
            .task { await auth.restore() }
        }
    }
}
