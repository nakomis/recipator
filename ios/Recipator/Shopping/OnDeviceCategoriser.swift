import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device shopping-item categorisation using Apple Foundation Models (RECP-35).
///
/// The fast path: when the device supports it (iOS 26+, Apple Intelligence enabled on
/// eligible hardware) we classify the item locally — instant, offline, zero AWS cost —
/// and pass the chosen aisle to the server, which then skips its Bedrock call. When the
/// device can't (older hardware/OS, model not downloaded) or the result isn't a known
/// aisle, `aisle(for:)` returns nil and the caller falls back to the server categoriser.
///
/// The aisle is validated against the canonical `Aisle` taxonomy; an unknown value is
/// treated as "no confident answer" and yields nil so the server decides instead.
enum OnDeviceCategoriser {
    /// Whether on-device categorisation can run right now.
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability { return true }
        }
        #endif
        return false
    }

    /// A canonical aisle id classified on-device, or nil to fall back to the server.
    static func aisle(for text: String) async -> String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return await classify(text)
        }
        #endif
        return nil
    }

    #if canImport(FoundationModels)
    /// Guided-generation result: a single aisle id. Using a structured type forces the
    /// model to return exactly this shape rather than free prose.
    @available(iOS 26.0, *)
    @Generable
    struct Classification {
        @Guide(description: "The single best-matching supermarket aisle id for the item.")
        var aisle: String
    }

    @available(iOS 26.0, *)
    private static func classify(_ text: String) async -> String? {
        guard case .available = SystemLanguageModel.default.availability else { return nil }

        let ids = Aisle.allCases.map(\.rawValue).joined(separator: ", ")
        let meanings = Aisle.allCases.map { "\($0.rawValue) (\($0.label))" }.joined(separator: ", ")
        let prompt = """
        You sort UK supermarket shopping-list items into aisles. The aisle MUST be exactly \
        one of these ids: \(ids). Aisle meanings: \(meanings). If unsure, use "other".

        Item: \(text)
        """

        do {
            let session = LanguageModelSession()
            let response = try await session.respond(to: prompt, generating: Classification.self)
            let id = response.content.aisle.trimmingCharacters(in: .whitespacesAndNewlines)
            // Trust only a known aisle; anything else → fall back to the server.
            return Aisle(rawValue: id) != nil ? id : nil
        } catch {
            return nil
        }
    }
    #endif
}
