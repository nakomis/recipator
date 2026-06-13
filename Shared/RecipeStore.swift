import Foundation

final class RecipeStore {
    static let shared = RecipeStore()

    private let containerURL: URL? = FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: "group.com.nakomis.recipator")?
        .appendingPathComponent("Recipes")

    func save(_ recipe: Recipe) throws {
        guard let dir = containerURL else { throw RecipeError.noSharedContainer }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent(recipe.filename)
        try recipe.markdown.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    func loadAll() -> [(filename: String, content: String)] {
        guard let dir = containerURL,
              FileManager.default.fileExists(atPath: dir.path),
              let files = try? FileManager.default.contentsOfDirectory(atPath: dir.path)
        else { return [] }

        return files
            .filter { $0.hasSuffix(".md") }
            .sorted(by: >)
            .compactMap { filename in
                let fileURL = dir.appendingPathComponent(filename)
                guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { return nil }
                return (filename: filename, content: content)
            }
    }
}
