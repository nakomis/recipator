import Foundation
import WebKit

/// Fetches a page's rendered HTML on-device using a hidden `WKWebView`.
///
/// Because this runs in the real WebKit engine from the device's (residential /
/// mobile) IP, it gets past bot protection that blocks server-side/datacenter
/// fetches — notably Cloudflare bot management on People Inc. sites (allrecipes,
/// Serious Eats), which refuse our Lambda fetch with a 402. The resulting HTML is
/// then POSTed to `/extract`, which parses it exactly as it would a server fetch.
///
/// Used as a fallback: the share flow tries the fast server fetch first and only
/// falls back to this when the server reports the page couldn't be fetched.
@MainActor
final class PageFetcher: NSObject, WKNavigationDelegate {
    enum FetchError: LocalizedError {
        case timeout
        case navigationFailed(String)

        var errorDescription: String? {
            switch self {
            case .timeout:                  return "Timed out loading the page on-device."
            case .navigationFailed(let m):  return "Couldn't load the page on-device: \(m)."
            }
        }
    }

    private var webView: WKWebView?
    private var continuation: CheckedContinuation<String, Error>?
    private var pollTask: Task<Void, Never>?
    private var finished = false

    /// Load `url` and return its rendered outer HTML. Resolves as soon as recipe
    /// JSON-LD appears (so we don't wait longer than needed), otherwise returns the
    /// best HTML available when the page settles, or throws on timeout / hard failure.
    func html(from url: URL, timeout: TimeInterval = 25) async throws -> String {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            self.continuation = cont

            let config = WKWebViewConfiguration()
            config.defaultWebpagePreferences.allowsContentJavaScript = true
            // A realistic phone-sized frame so layout/JS (incl. bot-check scripts) behave
            // as on a real device. The view is never added to the hierarchy.
            let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
            wv.navigationDelegate = self
            self.webView = wv

            // Poll the DOM until recipe content appears (handles a Cloudflare interstitial
            // that runs JS then navigates to the real page), or until the deadline.
            self.pollTask = Task { [weak self] in
                let deadline = Date().addingTimeInterval(timeout)
                var lastHTML: String?
                while Date() < deadline {
                    try? await Task.sleep(for: .milliseconds(800))
                    guard let self, !self.finished else { return }
                    if let current = await self.currentHTML() {
                        lastHTML = current
                        if PageFetcher.looksReady(current) { self.finish(.success(current)); return }
                    }
                }
                guard let self, !self.finished else { return }
                // Deadline hit: return whatever real content we managed to load, else fail.
                if let html = lastHTML, html.count > 2000 {
                    self.finish(.success(html))
                } else {
                    self.finish(.failure(FetchError.timeout))
                }
            }

            wv.load(URLRequest(url: url))
        }
    }

    private func currentHTML() async -> String? {
        guard let wv = webView else { return nil }
        let result = try? await wv.evaluateJavaScript("document.documentElement.outerHTML")
        return result as? String
    }

    /// Heuristic: a page with Recipe JSON-LD is ready; a substantial page with any
    /// JSON-LD is good enough (Claude can parse it). Tiny pages are bot-check stubs.
    private static func looksReady(_ html: String) -> Bool {
        if html.range(of: #""@type"\s*:\s*"Recipe""#, options: .regularExpression) != nil { return true }
        if html.count > 20_000, html.contains("application/ld+json") { return true }
        return false
    }

    private func finish(_ result: Result<String, Error>) {
        guard !finished else { return }
        finished = true
        pollTask?.cancel()
        pollTask = nil
        webView?.navigationDelegate = nil
        webView?.stopLoading()
        webView = nil
        switch result {
        case .success(let html): continuation?.resume(returning: html)
        case .failure(let err):  continuation?.resume(throwing: err)
        }
        continuation = nil
    }

    // MARK: - WKNavigationDelegate

    // A failed *provisional* navigation (DNS, no connection, refused) is fatal — there's
    // nothing to poll. A later didFail (after content started) is left to the poll loop,
    // since bot-check redirects can surface transient errors mid-flow.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(.failure(FetchError.navigationFailed(error.localizedDescription)))
    }
}
