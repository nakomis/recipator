import SwiftUI
import UIKit

/// Stores the user's chosen profile picture on-device (RECP-35 settings). Persisted as a
/// JPEG in the app's Documents directory; published so the toolbar avatar and the settings
/// screen update live.
final class ProfileStore: ObservableObject {
    static let shared = ProfileStore()

    @Published private(set) var imageData: Data?

    private let fileURL: URL

    init() {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = dir.appendingPathComponent("profile.jpg")
        imageData = try? Data(contentsOf: fileURL)
    }

    func setImage(_ data: Data) {
        imageData = data
        try? data.write(to: fileURL, options: .atomic)
    }

    func clear() {
        imageData = nil
        try? FileManager.default.removeItem(at: fileURL)
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
