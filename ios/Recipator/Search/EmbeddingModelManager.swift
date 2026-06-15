// EmbeddingModelManager.swift — owns the on-device embedding model lifecycle.
//
// On first run it downloads the model (presigned S3 URL from GET /model), verifies
// its sha256, unzips, compiles it (MLModel.compileModel) and runs a warm-up embed
// so the several-second ANE specialisation happens HERE, in the background — not on
// the user's first search. Search is disabled until `status == .ready`.
import Foundation
import Combine
import CoreML
import CryptoKit
import ZIPFoundation

@MainActor
final class EmbeddingModelManager: ObservableObject {
    enum Status: Equatable {
        case idle
        case downloading           // fetching the model (one-time, ~640MB)
        case preparing             // unzip + compile + warm-up
        case ready
        case failed(String)
    }

    @Published private(set) var status: Status = .idle

    private(set) var embedder: CoreMLEmbedder?
    private(set) var queryPrefix: String = ""
    /// The active model version (e.g. "bge-base-v1"), set once the model is loaded.
    /// Matches the `embeddingModel` tag stored with each server-computed vector, so
    /// search only compares vectors from the SAME model — see RecipeStore.embeddings.
    private(set) var version: String?
    var isReady: Bool { if case .ready = status { return true }; return false }

    private let tokenizer = BertTokenizer()
    private let defaults = UserDefaults.standard
    private let fm = FileManager.default

    private var modelsDir: URL {
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Models", isDirectory: true)
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }
    private func compiledURL(_ version: String) -> URL {
        modelsDir.appendingPathComponent("\(version).mlmodelc", isDirectory: true)
    }

    /// Idempotent: safe to call on every launch. Loads cache if current, else fetches.
    func prepare() async {
        if isReady { return }
        guard let tokenizer else { status = .failed("tokenizer/vocab missing"); return }

        // Try to load whatever is cached first (works offline).
        let cachedVersion = defaults.string(forKey: "modelVersion")
        if let v = cachedVersion, fm.fileExists(atPath: compiledURL(v).path) {
            queryPrefix = defaults.string(forKey: "modelQueryPrefix") ?? ""
            if await load(version: v, tokenizer: tokenizer) {
                // Loaded from cache. Check for a newer version in the background; ignore failures.
                Task { await self.refreshIfNewer(current: v, tokenizer: tokenizer) }
                return
            }
        }

        // No usable cache — must fetch.
        do {
            let info = try await APIClient.shared.getModelInfo()
            try await downloadCompileActivate(info: info, tokenizer: tokenizer)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    private func refreshIfNewer(current: String, tokenizer: BertTokenizer) async {
        guard let info = try? await APIClient.shared.getModelInfo(), info.version != current else { return }
        try? await downloadCompileActivate(info: info, tokenizer: tokenizer)
    }

    private func downloadCompileActivate(info: ModelInfo, tokenizer: BertTokenizer) async throws {
        let compiled = compiledURL(info.version)
        if !fm.fileExists(atPath: compiled.path) {
            status = .downloading
            let zipURL = try await download(from: info.url, expectedSHA: info.sha256)
            defer { try? fm.removeItem(at: zipURL) }

            status = .preparing
            let unzipped = modelsDir.appendingPathComponent("unzip-\(UUID().uuidString)", isDirectory: true)
            try fm.createDirectory(at: unzipped, withIntermediateDirectories: true)
            defer { try? fm.removeItem(at: unzipped) }
            try fm.unzipItem(at: zipURL, to: unzipped)

            guard let pkg = locatePackage(in: unzipped) else { throw ModelError.noPackage }
            let tmpCompiled = try await Task.detached { try MLModel.compileModel(at: pkg) }.value
            if fm.fileExists(atPath: compiled.path) { try fm.removeItem(at: compiled) }
            try fm.moveItem(at: tmpCompiled, to: compiled)
        } else {
            status = .preparing
        }

        defaults.set(info.version, forKey: "modelVersion")
        defaults.set(info.queryPrefix, forKey: "modelQueryPrefix")
        queryPrefix = info.queryPrefix
        guard await load(version: info.version, tokenizer: tokenizer) else { throw ModelError.loadFailed }
    }

    /// Loads the compiled model and warms it up so the ANE stall happens now.
    private func load(version: String, tokenizer: BertTokenizer) async -> Bool {
        let url = compiledURL(version)
        // Build the embedder OFF the main actor. `MLModel(contentsOf:)` with `.all`
        // compute units does heavy load + ANE specialisation eagerly, and this manager
        // is @MainActor — constructing it here directly blocked the UI for ~20s on every
        // cold launch (the compiled model is loaded from cache each time, not just first run).
        let embedder = await Task.detached(priority: .userInitiated) {
            CoreMLEmbedder(compiledModelURL: url, tokenizer: tokenizer)
        }.value
        guard let embedder else { return false }
        // Warm-up on a background thread: triggers any remaining ANE specialisation off-main.
        let warmed = await Task.detached(priority: .userInitiated) { embedder.embed("warm up") != nil }.value
        guard warmed else { return false }
        self.embedder = embedder
        self.version = version
        status = .ready
        // Reclaim space: drop any previous model's compiled artefact + stray temp files.
        // After a model switch the old (e.g. 640 MB mxbai) .mlmodelc would otherwise linger.
        pruneOldModels(keeping: version)
        return true
    }

    /// Delete compiled models other than `version`, plus any leftover download/unzip temps.
    private func pruneOldModels(keeping version: String) {
        let keep = "\(version).mlmodelc"
        guard let items = try? fm.contentsOfDirectory(at: modelsDir, includingPropertiesForKeys: nil) else { return }
        for item in items where item.lastPathComponent != keep {
            let name = item.lastPathComponent
            if item.pathExtension == "mlmodelc" || name.hasPrefix("download-") || name.hasPrefix("unzip-") {
                try? fm.removeItem(at: item)
            }
        }
    }

    private func locatePackage(in dir: URL) -> URL? {
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return nil }
        return items.first { $0.pathExtension == "mlpackage" }
            ?? items.first { $0.pathExtension == "mlmodelc" }
    }

    // MARK: - Download with progress + sha256 verification

    private func download(from urlString: String, expectedSHA: String) async throws -> URL {
        guard let url = URL(string: urlString) else { throw ModelError.badURL }
        // Stream to a temp file (URLSession handles the 640MB efficiently).
        let (tmp, _) = try await URLSession.shared.download(from: url)
        let dest = modelsDir.appendingPathComponent("download-\(UUID().uuidString).zip")
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
        try fm.moveItem(at: tmp, to: dest)

        // Verify sha256 by streaming the file in chunks (don't load 640MB into RAM).
        guard let handle = try? FileHandle(forReadingFrom: dest) else { throw ModelError.loadFailed }
        defer { try? handle.close() }
        var hasher = SHA256()
        while case let chunk = handle.readData(ofLength: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        guard digest.caseInsensitiveCompare(expectedSHA) == .orderedSame else {
            try? fm.removeItem(at: dest)
            throw ModelError.shaMismatch
        }
        return dest
    }

    enum ModelError: LocalizedError {
        case badURL, noPackage, loadFailed, shaMismatch
        var errorDescription: String? {
            switch self {
            case .badURL:      return "Bad model URL"
            case .noPackage:   return "Downloaded archive had no model package"
            case .loadFailed:  return "Failed to load the embedding model"
            case .shaMismatch: return "Model download failed verification"
            }
        }
    }
}
