import BackgroundTasks
import SwiftUI

@main
struct RecipatorApp: App {
    /// Identifier for the periodic shopping-list sync (RECP-49 B3). Must match the entry in
    /// `BGTaskSchedulerPermittedIdentifiers` (Info.plist via project.yml).
    static let shoppingSyncTaskId = "com.nakomis.recipator.shopping-sync"

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
            // Retry pending avatar upload + refresh member avatars, and sync the shopping list,
            // when connectivity returns (RECP-51/49). Registered once for the app's lifetime.
            .task {
                Connectivity.shared.onBecameOnline {
                    Task {
                        await AvatarSync.shared.uploadPending()
                        AvatarCache.shared.retry()
                        await ShoppingSync.shared.sync()
                    }
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task {
                    await AvatarSync.shared.uploadPending()
                    AvatarCache.shared.retry()
                    await ShoppingSync.shared.sync()
                }
            case .background:
                scheduleShoppingSync()   // queue the next background refresh
            default:
                break
            }
        }
        // Periodic background sync of the shopping list (RECP-49 B3). iOS decides when to run it.
        .backgroundTask(.appRefresh(Self.shoppingSyncTaskId)) {
            await ShoppingSync.shared.sync()
            scheduleShoppingSync()
        }
    }

    /// Queue the next background app-refresh. iOS coalesces/leaves timing to itself; we just ask.
    private func scheduleShoppingSync() {
        let request = BGAppRefreshTaskRequest(identifier: Self.shoppingSyncTaskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
