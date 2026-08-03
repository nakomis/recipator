import XCTest
@testable import Recipator

/// RECP-21 — rank capture. Every search runs both strategies, so a tap is scored against the
/// keyword-only, semantic-only and merged rankings at once. These assert the ranks are 1-based,
/// measured against the owner-filtered projection the user actually saw, and nil when a
/// strategy did not return the tapped recipe at all.
final class SearchScoringTests: XCTestCase {

    private func outcome(
        ranked: [String], keyword: [String], semantic: [String], semanticAvailable: Bool = true
    ) -> SearchOutcome {
        SearchOutcome(
            searchId: "test-search", ranked: ranked,
            keywordRanked: keyword, semanticRanked: semantic,
            semanticAvailable: semanticAvailable,
            latencyMs: 10, keywordMs: 2, semanticMs: 8,
        )
    }

    func testRanksAreOneBased() {
        let o = outcome(ranked: ["a", "b", "c"], keyword: ["a", "b"], semantic: ["c", "b", "a"])
        let r = o.ranks(of: "b", visible: ["a", "b", "c"])
        XCTAssertEqual(r.hybrid, 2)
        XCTAssertEqual(r.keyword, 2)
        XCTAssertEqual(r.semantic, 2)
    }

    func testFirstResultIsRankOne() {
        let o = outcome(ranked: ["a", "b"], keyword: ["a"], semantic: ["b", "a"])
        let r = o.ranks(of: "a", visible: ["a", "b"])
        XCTAssertEqual(r.hybrid, 1)
        XCTAssertEqual(r.keyword, 1)
        XCTAssertEqual(r.semantic, 2)
    }

    func testNilWhenStrategyDidNotReturnTheRecipe() {
        // Keyword missed "c" entirely; semantic ranked it first.
        let o = outcome(ranked: ["a", "b", "c"], keyword: ["a", "b"], semantic: ["c"])
        let r = o.ranks(of: "c", visible: ["a", "b", "c"])
        XCTAssertEqual(r.hybrid, 3)
        XCTAssertNil(r.keyword)
        XCTAssertEqual(r.semantic, 1)
    }

    func testSemanticRanksAreNilWhenModelNotReady() {
        // Before the embedding model lands the semantic list is empty by construction.
        let o = outcome(ranked: ["a", "b"], keyword: ["a", "b"], semantic: [], semanticAvailable: false)
        let r = o.ranks(of: "a", visible: ["a", "b"])
        XCTAssertEqual(r.keyword, 1)
        XCTAssertNil(r.semantic)
        XCTAssertFalse(o.semanticAvailable)
    }

    /// The owner filter ("Everyone" vs one person) is applied after ranking, so a strategy's
    /// raw list can contain recipes that were never displayed. Ranks must be measured against
    /// the projection, or the hybrid rank won't match the row the user tapped.
    func testRanksAreMeasuredAgainstTheVisibleProjection() {
        // "x" and "y" belong to another household member and are filtered out of the view.
        let o = outcome(
            ranked: ["x", "a", "y", "b"],
            keyword: ["x", "a", "b"],
            semantic: ["y", "b", "a"],
        )
        let visible = ["a", "b"]
        let r = o.ranks(of: "b", visible: visible)
        XCTAssertEqual(r.hybrid, 2)     // second of the two shown, not fourth overall
        XCTAssertEqual(r.keyword, 2)    // "x" dropped
        XCTAssertEqual(r.semantic, 1)   // "y" dropped, so "b" leads
    }

    func testUnknownRecipeYieldsNilEverywhere() {
        let o = outcome(ranked: ["a"], keyword: ["a"], semantic: ["a"])
        let r = o.ranks(of: "missing", visible: ["a"])
        XCTAssertNil(r.hybrid)
        XCTAssertNil(r.keyword)
        XCTAssertNil(r.semantic)
    }

    func testEmptyOutcomeIsFlagged() {
        XCTAssertTrue(SearchOutcome.empty.isEmpty)
        XCTAssertFalse(outcome(ranked: ["a"], keyword: ["a"], semantic: []).isEmpty)
    }
}
