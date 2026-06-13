import AuthenticationServices
import UIKit

extension AuthService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            // Force dark mode so the Cognito One Dark branding always shows regardless of system preference.
            let anchor = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
            anchor.overrideUserInterfaceStyle = .dark
            return anchor
        }
    }
}
