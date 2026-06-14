// nl_embed.swift — emit Apple NLEmbedding sentence vectors as JSON lines.
// Usage: echo '{"id":"x","text":"..."}' | swift nl_embed.swift [en|fr|...]
// Reads JSON objects (one per line) from stdin, writes {"id":..,"vector":[..]} per line.
import Foundation
import NaturalLanguage

let langArg = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "en"
let language = NLLanguage(rawValue: langArg)

guard let embedding = NLEmbedding.sentenceEmbedding(for: language) else {
    FileHandle.standardError.write("ERROR: no sentence embedding for \(langArg)\n".data(using: .utf8)!)
    exit(1)
}
FileHandle.standardError.write("NLEmbedding dim=\(embedding.dimension) lang=\(langArg)\n".data(using: .utf8)!)

while let line = readLine(strippingNewline: true) {
    if line.isEmpty { continue }
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = obj["id"] as? String,
          let text = obj["text"] as? String else {
        FileHandle.standardError.write("skip bad line\n".data(using: .utf8)!)
        continue
    }
    // NLEmbedding.vector(for:) returns nil for very long strings; truncate defensively.
    let trimmed = String(text.prefix(2000))
    let vec = embedding.vector(for: trimmed)
    var out: [String: Any] = ["id": id]
    if let vec = vec {
        out["vector"] = vec
    } else {
        out["vector"] = NSNull()
        FileHandle.standardError.write("nil vector for id=\(id)\n".data(using: .utf8)!)
    }
    let outData = try! JSONSerialization.data(withJSONObject: out)
    FileHandle.standardOutput.write(outData)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
