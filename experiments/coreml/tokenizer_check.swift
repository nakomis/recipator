// Standalone mirror of ios/.../BertTokenizer.swift encode() for parity testing vs Python.
// Usage: swift tokenizer_check.swift <vocab.txt> "text one" "text two" ...
// Prints, per input: the token ids (no padding) as CSV.
import Foundation

let args = CommandLine.arguments
let vocabPath = args[1]
let texts = Array(args.dropFirst(2))

var vocab: [String: Int] = [:]
let vtext = try! String(contentsOfFile: vocabPath, encoding: .utf8)
var i = 0
for line in vtext.split(separator: "\n", omittingEmptySubsequences: false) { vocab[String(line)] = i; i += 1 }
let unk = "[UNK]"

func basicTokenize(_ text: String) -> [String] {
    let lowered = text.folding(options: .diacriticInsensitive, locale: .init(identifier: "en")).lowercased()
    var out: [String] = []
    for chunk in lowered.split(whereSeparator: { $0.isWhitespace }) {
        var current = ""
        for ch in chunk {
            if ch.isLetter || ch.isNumber { current.append(ch) }
            else { if !current.isEmpty { out.append(current); current = "" }; out.append(String(ch)) }
        }
        if !current.isEmpty { out.append(current) }
    }
    return out
}

func wordpiece(_ token: String) -> [String] {
    let chars = Array(token)
    if chars.count > 100 { return [unk] }
    var subTokens: [String] = []; var start = 0
    while start < chars.count {
        var end = chars.count; var match: String? = nil
        while start < end {
            var piece = String(chars[start..<end])
            if start > 0 { piece = "##" + piece }
            if vocab[piece] != nil { match = piece; break }
            end -= 1
        }
        guard let found = match else { return [unk] }
        subTokens.append(found); start = end
    }
    return subTokens
}

for text in texts {
    var pieces = ["[CLS]"]
    for token in basicTokenize(text) { pieces.append(contentsOf: wordpiece(token)) }
    pieces.append("[SEP]")
    let ids = pieces.compactMap { vocab[$0] ?? vocab[unk] }
    print(ids.map(String.init).joined(separator: ","))
}
