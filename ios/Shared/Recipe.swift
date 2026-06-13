import Foundation

struct Recipe: Identifiable {
    let id: UUID
    let title: String
    let url: String
    let savedAt: Date
    let markdown: String

    init(title: String, url: String, savedAt: Date = Date(), markdown: String) {
        self.id = UUID()
        self.title = title
        self.url = url
        self.savedAt = savedAt
        self.markdown = markdown
    }

    var filename: String {
        let slug = title
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.union(.init(charactersIn: "-")).inverted)
            .joined(separator: "-")
            .components(separatedBy: "--").joined(separator: "-")
            .trimmingCharacters(in: .init(charactersIn: "-"))
            .prefix(60)
            .description
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return "\(formatter.string(from: savedAt))-\(slug).md"
    }
}

enum RecipeError: LocalizedError {
    case noSharedContainer
    case noURLFound
    case extractionFailed(String)

    var errorDescription: String? {
        switch self {
        case .noSharedContainer: return "Cannot access shared storage."
        case .noURLFound: return "No URL was found in the shared item."
        case .extractionFailed(let msg): return msg
        }
    }
}
