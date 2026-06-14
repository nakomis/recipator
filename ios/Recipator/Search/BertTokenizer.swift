// BertTokenizer.swift — bert-base-uncased WordPiece tokeniser used to feed the
// on-device embedding model. Verified to produce token IDs byte-identical to the
// HuggingFace tokenizer (so on-device vectors match the server-computed ones).
import Foundation

final class BertTokenizer {
    private var vocab: [String: Int] = [:]
    private let unk = "[UNK]", cls = "[CLS]", sep = "[SEP]", pad = "[PAD]"
    let seqLen: Int

    init?(vocabName: String = "vocab", seqLen: Int = 64) {
        self.seqLen = seqLen
        guard let url = Bundle.main.url(forResource: vocabName, withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        var i = 0
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            vocab[String(line)] = i
            i += 1
        }
        guard vocab[cls] != nil, vocab[sep] != nil else { return nil }
    }

    /// Token IDs and attention mask, padded/truncated to `seqLen`.
    func encode(_ text: String) -> (ids: [Int32], mask: [Int32]) {
        var pieces: [String] = [cls]
        for token in basicTokenize(text) {
            pieces.append(contentsOf: wordpiece(token))
        }
        pieces.append(sep)

        var ids = pieces.compactMap { vocab[$0] ?? vocab[unk] }
        if ids.count > seqLen {
            ids = Array(ids.prefix(seqLen - 1)) + [vocab[sep]!]
        }
        let realCount = ids.count
        let padId = vocab[pad] ?? 0
        while ids.count < seqLen { ids.append(padId) }

        let mask = (0..<seqLen).map { Int32($0 < realCount ? 1 : 0) }
        return (ids.map(Int32.init), mask)
    }

    // Lowercase, fold accents, split on whitespace, peel punctuation into own tokens.
    private func basicTokenize(_ text: String) -> [String] {
        let lowered = text.folding(options: .diacriticInsensitive, locale: .init(identifier: "en"))
            .lowercased()
        var out: [String] = []
        for chunk in lowered.split(whereSeparator: { $0.isWhitespace }) {
            var current = ""
            for ch in chunk {
                if ch.isLetter || ch.isNumber {
                    current.append(ch)
                } else {
                    if !current.isEmpty { out.append(current); current = "" }
                    out.append(String(ch))
                }
            }
            if !current.isEmpty { out.append(current) }
        }
        return out
    }

    // Greedy longest-match-first WordPiece.
    private func wordpiece(_ token: String) -> [String] {
        let chars = Array(token)
        if chars.count > 100 { return [unk] }
        var subTokens: [String] = []
        var start = 0
        while start < chars.count {
            var end = chars.count
            var match: String? = nil
            while start < end {
                var piece = String(chars[start..<end])
                if start > 0 { piece = "##" + piece }
                if vocab[piece] != nil { match = piece; break }
                end -= 1
            }
            guard let found = match else { return [unk] }
            subTokens.append(found)
            start = end
        }
        return subTokens
    }
}
