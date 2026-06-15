import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Image("RecipatorIcon")
                .resizable()
                .frame(width: 110, height: 110)
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .shadow(color: .black.opacity(0.2), radius: 12, y: 4)

            VStack(spacing: 4) {
                Text("Recipator")
                    .font(.largeTitle.bold())
                Text(Bundle.main.versionLabel)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Text("Save recipes from anywhere.")
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }

            Spacer()

            if let error = auth.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Button {
                signingIn = true
                Task {
                    await auth.signIn()
                    signingIn = false
                }
            } label: {
                Group {
                    if signingIn {
                        ProgressView()
                    } else {
                        Text("Sign In")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(signingIn)
            .padding(.horizontal)
            .padding(.bottom, 32)
        }
    }
}
