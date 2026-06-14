// CoreMLEmbedder.swift — runs the downloaded mxbai CoreML model to embed text.
import Foundation
import CoreML

final class CoreMLEmbedder {
    private let model: MLModel
    private let tokenizer: BertTokenizer
    private let inputIdsName: String
    private let maskName: String
    private let outputName: String
    let dimension: Int

    /// `compiledModelURL` is an `.mlmodelc` produced by `MLModel.compileModel`.
    init?(compiledModelURL: URL, tokenizer: BertTokenizer, computeUnits: MLComputeUnits = .all) {
        let config = MLModelConfiguration()
        config.computeUnits = computeUnits
        guard let m = try? MLModel(contentsOf: compiledModelURL, configuration: config) else { return nil }
        self.model = m
        self.tokenizer = tokenizer

        let inputs = m.modelDescription.inputDescriptionsByName
        self.inputIdsName = inputs.keys.first { $0.contains("input") } ?? "input_ids"
        self.maskName = inputs.keys.first { $0.contains("mask") } ?? "attention_mask"
        self.outputName = m.modelDescription.outputDescriptionsByName.keys.first ?? "embedding"
        let outShape = m.modelDescription.outputDescriptionsByName[outputName]?
            .multiArrayConstraint?.shape ?? []
        self.dimension = outShape.last?.intValue ?? 0
    }

    /// L2-normalised embedding (the model normalises internally).
    func embed(_ text: String) -> [Float]? {
        let (ids, mask) = tokenizer.encode(text)
        let n = ids.count
        guard let idsArr = try? MLMultiArray(shape: [1, NSNumber(value: n)], dataType: .int32),
              let maskArr = try? MLMultiArray(shape: [1, NSNumber(value: n)], dataType: .int32) else {
            return nil
        }
        for i in 0..<n {
            idsArr[i] = NSNumber(value: ids[i])
            maskArr[i] = NSNumber(value: mask[i])
        }
        guard let provider = try? MLDictionaryFeatureProvider(dictionary: [
            inputIdsName: MLFeatureValue(multiArray: idsArr),
            maskName: MLFeatureValue(multiArray: maskArr),
        ]),
        let out = try? model.prediction(from: provider),
        let vec = out.featureValue(for: outputName)?.multiArrayValue else {
            return nil
        }
        var result = [Float](repeating: 0, count: vec.count)
        for i in 0..<vec.count { result[i] = vec[i].floatValue }
        return result
    }
}

enum Cosine {
    /// Both vectors are L2-normalised, so cosine similarity == dot product.
    static func similarity(_ a: [Float], _ b: [Float]) -> Float {
        let n = min(a.count, b.count)
        var dot: Float = 0
        var i = 0
        while i < n { dot += a[i] * b[i]; i += 1 }
        return dot
    }
}
