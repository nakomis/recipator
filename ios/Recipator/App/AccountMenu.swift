import SwiftUI

/// The person.circle account menu shared by the Recipes and Shopping tabs. Shows the
/// signed-in name, the app version (so it's reachable on every screen — the old bottom-bar
/// version label is hidden behind the tab bar inside a TabView), and Sign Out.
struct AccountMenu: View {
    @EnvironmentObject private var auth: AuthService

    var body: some View {
        Menu {
            Text(auth.displayName ?? "Signed in")
            Text(Bundle.main.versionLabel)
            Divider()
            Button("Sign Out", role: .destructive) { auth.signOut() }
        } label: {
            Image(systemName: "person.circle")
        }
    }
}
