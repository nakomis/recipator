import SwiftUI

@main
struct RecipatorApp: App {
    @StateObject private var auth = AuthService()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Force dark mode app-wide so the Cognito login page always uses the One Dark theme.
        UIWindow.appearance().overrideUserInterfaceStyle = .dark
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isSignedIn {
                    MainTabView()
                } else {
                    SignInView()
                }
            }
            .environmentObject(auth)
            .environmentObject(ProfileStore.shared)
            // Sandbox builds get a green accent throughout so the environment is
            // unmistakable; production keeps the default tint.
            .tint(AppConfig.isSandbox ? .green : nil)
            .task { await auth.restore() }
            // Retry pending avatar upload + refresh member avatars when connectivity
            // returns (RECP-51). Registered once for the app's lifetime.
            .task {
                Connectivity.shared.onBecameOnline {
                    Task { await AvatarSync.shared.uploadPending(); AvatarCache.shared.retry() }
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await AvatarSync.shared.uploadPending(); AvatarCache.shared.retry() }
        }
    }
}
