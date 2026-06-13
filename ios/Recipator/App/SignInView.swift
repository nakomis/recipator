import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthService
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Image("AppIcon")
                .resizable()
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .shadow(radius: 8)

            VStack(spacing: 8) {
                Text("Recipator")
                    .font(.largeTitle.bold())
                Text("Save recipes from anywhere.")
                    .foregroundStyle(.secondary)
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
