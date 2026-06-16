import PhotosUI
import SwiftUI

/// UserDefaults keys for the user-facing settings (RECP-35). Shared between the settings
/// screen and the views that read them (e.g. the shopping list badge + add flow).
enum SettingsKeys {
    static let showBadges = "settings.showCategoryBadges"
    static let offlineOnly = "settings.offlineOnly"
    /// Allow the cloud categoriser over mobile data (RECP-49). On by default; when off the
    /// cloud LLM is only consulted on WiFi. No effect in offline-only mode.
    static let cloudOnCellular = "settings.cloudOnCellular"
}

/// Profile & Settings screen — replaces the old account dropdown. Lets the user set a
/// profile picture from their Photos and tune categorisation behaviour. The two settings
/// use segmented selectors (tinted blue) rather than checkboxes.
struct SettingsView: View {
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var profile: ProfileStore
    @Environment(\.dismiss) private var dismiss

    @AppStorage(SettingsKeys.showBadges) private var showBadges = AppConfig.isSandbox
    @AppStorage(SettingsKeys.offlineOnly) private var offlineOnly = false
    @AppStorage(SettingsKeys.cloudOnCellular) private var cloudOnCellular = true

    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        MeAvatarView(localData: profile.imageData, userId: auth.userId, size: 96)
                        PhotosPicker(
                            profile.imageData == nil ? "Add photo" : "Change photo",
                            selection: $photoItem,
                            matching: .images
                        )
                        .font(.callout)
                        if profile.imageData != nil {
                            Button("Remove photo", role: .destructive) { profile.clear() }
                                .font(.caption)
                        }
                        if let name = auth.displayName {
                            Text(name).font(.headline)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                Section("Categorisation") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Show categorisation badges")
                        Picker("", selection: $showBadges) {
                            Text("Hidden").tag(false)
                            Text("Shown").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .tint(.blue)
                        Text("Tags each item with how it was sorted (rules, on-device, Lambda).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Categorisation source")
                        Picker("", selection: $offlineOnly) {
                            Text("On-device + Cloud").tag(false)
                            Text("On-device only").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .tint(.blue)
                        Text(offlineOnly
                            ? "Items are sorted on this device only; anything it can’t place goes in Other (no cloud LLM)."
                            : "Falls back to the cloud categoriser when on-device can’t place an item.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)

                    if !offlineOnly {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Cloud sorting on mobile data")
                            Picker("", selection: $cloudOnCellular) {
                                Text("On").tag(true)
                                Text("WiFi only").tag(false)
                            }
                            .pickerStyle(.segmented)
                            .tint(.blue)
                            Text(cloudOnCellular
                                ? "Uses the cloud categoriser on WiFi and mobile data."
                                : "Only uses the cloud categoriser on WiFi; on mobile data, anything on-device can’t place goes in Other.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section {
                    Text(Bundle.main.versionLabel)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("Sign Out", role: .destructive) { auth.signOut() }
                }
            }
            .navigationTitle("Profile & Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        // Saves locally instantly, then uploads to the backend with retry (RECP-51).
                        AvatarSync.shared.setAndUpload(data)
                    }
                }
            }
        }
    }
}

/// Toolbar entry point: the avatar button that presents the settings sheet. Replaces the
/// old person.circle dropdown menu.
struct ProfileButton: View {
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var auth: AuthService
    @State private var showing = false

    var body: some View {
        Button { showing = true } label: {
            MeAvatarView(localData: profile.imageData, userId: auth.userId, size: 28)
        }
        .accessibilityLabel("Profile and settings")
        .sheet(isPresented: $showing) { SettingsView() }
    }
}
