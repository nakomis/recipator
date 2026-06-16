import SwiftUI

/// Uploads the user's own avatar to the backend with retry (RECP-51). Picking a photo
/// saves it locally instantly (`ProfileStore`) and marks an upload pending; this then
/// pushes it to S3 via a presigned PUT. If the upload fails (offline etc.) the pending
/// marker is kept and retried on connectivity-regained and app foreground — the BG-task
/// retry path is added with the offline-first sync work (RECP-49).
@MainActor
final class AvatarSync: ObservableObject {
    static let shared = AvatarSync()

    @Published private(set) var isUploading = false

    /// Persist the newly-chosen photo locally, then attempt to upload it.
    func setAndUpload(_ data: Data) {
        ProfileStore.shared.setImage(data, pendingUpload: true)
        Task { await uploadPending() }
    }

    /// Attempt any outstanding upload. Safe to call repeatedly (no-op when nothing pending).
    func uploadPending() async {
        guard ProfileStore.shared.hasPendingUpload,
              let jpeg = ProfileStore.shared.imageData,
              !isUploading else { return }
        isUploading = true
        defer { isUploading = false }
        do {
            try await APIClient.shared.uploadAvatar(jpeg: jpeg)
            ProfileStore.shared.clearPendingUpload()
        } catch {
            // Keep the pending marker; retried on next foreground / reconnect.
        }
    }
}
