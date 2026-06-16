import SwiftUI
import UIKit

/// Stores the user's chosen profile picture on-device (RECP-35 settings). Persisted as a
/// JPEG in the app's Documents directory; published so the toolbar avatar and the settings
/// screen update live.
final class ProfileStore: ObservableObject {
    static let shared = ProfileStore()

    @Published private(set) var imageData: Data?

    private let fileURL: URL
    private let pendingKey = "avatar.pendingUpload"

    init() {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = dir.appendingPathComponent("profile.jpg")
        imageData = try? Data(contentsOf: fileURL)
    }

    /// Store the chosen photo as a normalised JPEG. Pass `pendingUpload: true` to flag it
    /// for upload to the backend (RECP-51) — the marker survives relaunch until a confirmed
    /// upload clears it.
    func setImage(_ data: Data, pendingUpload: Bool = false) {
        let jpeg = ProfileStore.normalisedJPEG(data)
        imageData = jpeg
        try? jpeg.write(to: fileURL, options: .atomic)
        if pendingUpload { UserDefaults.standard.set(true, forKey: pendingKey) }
    }

    func clear() {
        imageData = nil
        try? FileManager.default.removeItem(at: fileURL)
        clearPendingUpload()
    }

    var hasPendingUpload: Bool { UserDefaults.standard.bool(forKey: pendingKey) }
    func clearPendingUpload() { UserDefaults.standard.removeObject(forKey: pendingKey) }

    /// Downscale (max 512px) and re-encode as JPEG so the stored/uploaded avatar is small
    /// and a predictable content type (the upload is presigned for image/jpeg).
    private static func normalisedJPEG(_ data: Data) -> Data {
        guard let image = UIImage(data: data) else { return data }
        let maxDim: CGFloat = 512
        let scale = min(1, maxDim / max(image.size.width, image.size.height))
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: target).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: 0.85) ?? data
    }
}

/// Circular avatar — the chosen photo, or a person.circle placeholder.
struct AvatarView: View {
    let data: Data?
    var size: CGFloat = 30

    var body: some View {
        if let data, let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            Image(systemName: "person.circle.fill")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .foregroundStyle(.secondary)
        }
    }
}
