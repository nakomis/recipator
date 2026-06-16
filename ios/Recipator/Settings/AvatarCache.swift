import SwiftUI
import UIKit

/// On-device cache of other members' avatars (RECP-51). Avatar URLs arrive from
/// `GET /config` (presigned, short-lived); the images themselves are cached to disk keyed
/// by userId so they render offline. A failed download leaves any previously-cached image
/// in place and is simply retried on the next sync / foreground / connectivity-regained.
@MainActor
final class AvatarCache: ObservableObject {
    static let shared = AvatarCache()

    /// userId -> avatar image, for views to read. Published so avatars appear as they load.
    @Published private(set) var images: [String: UIImage] = [:]

    /// userId -> latest presigned URL from /config.
    private var urls: [String: String] = [:]
    private let dir: URL

    init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        dir = caches.appendingPathComponent("member-avatars", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        loadFromDisk()
    }

    func image(for userId: String) -> UIImage? { images[userId] }

    /// Record the latest avatar URLs from /config and (re)download what we can.
    func update(from members: [GroupMember]) {
        for m in members where m.avatarUrl != nil {
            urls[m.userId] = m.avatarUrl
        }
        Task { await fetchAll() }
    }

    /// Retry outstanding downloads — call on connectivity regained / app foreground.
    func retry() { Task { await fetchAll() } }

    private func fileURL(_ userId: String) -> URL { dir.appendingPathComponent("\(userId).jpg") }

    private func loadFromDisk() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        else { return }
        for file in files where file.pathExtension == "jpg" {
            let userId = file.deletingPathExtension().lastPathComponent
            if let data = try? Data(contentsOf: file), let img = UIImage(data: data) {
                images[userId] = img
            }
        }
    }

    private func fetchAll() async {
        for (userId, urlStr) in urls {
            guard let url = URL(string: urlStr) else { continue }
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), let img = UIImage(data: data) else { continue }
                images[userId] = img
                try? data.write(to: fileURL(userId), options: .atomic)
            } catch {
                // Offline / expired URL — keep any cached image; retried later.
            }
        }
    }
}

/// A circular avatar for another group member, backed by `AvatarCache`. Falls back to a
/// placeholder (never an error) until the image is cached.
struct MemberAvatarView: View {
    let userId: String
    var size: CGFloat = 18
    @ObservedObject private var cache = AvatarCache.shared

    var body: some View {
        if let img = cache.image(for: userId) {
            Image(uiImage: img)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            Image(systemName: "person.circle.fill")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .foregroundStyle(.tertiary)
        }
    }
}
