import SwiftUI

/// Shown while `AuthService.restore()` settles at launch (RECP-58).
///
/// Deliberately a still frame with no spinner and no text: restoring a valid session is usually
/// instantaneous, and a spinner that appears for one frame reads as jank. It mirrors the top half
/// of `SignInView` so that if the session *has* expired, the transition to the sign-in screen is
/// the buttons fading in rather than the whole screen changing.
struct LaunchPlaceholderView: View {
    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Image("RecipatorIcon")
                .resizable()
                .frame(width: 110, height: 110)
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .shadow(color: .black.opacity(0.2), radius: 12, y: 4)

            Text("Recipator")
                .font(.largeTitle.bold())

            Spacer()
        }
    }
}
