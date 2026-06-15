import Foundation

extension Bundle {
    var appVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }

    var buildNumber: String {
        infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

    /// User-facing version label, e.g. "v1.0 (114)". The build number aids debugging
    /// (it pins which TestFlight/local build is running).
    var versionLabel: String {
        "v\(appVersion) (\(buildNumber))"
    }
}
