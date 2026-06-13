import SwiftUI
import UniformTypeIdentifiers

struct ShareView: View {
    let extensionContext: NSExtensionContext?
    let onDismiss: () -> Void

    @State private var phase: Phase = .checkingAuth

    enum Phase {
        case checkingAuth
        case notSignedIn
        case extracting
        case preview(ExtractedRecipe)
        case saved
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Recipator")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: onDismiss)
                    }
                }
        }
        .task { await run() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .checkingAuth:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .notSignedIn:
            VStack(spacing: 16) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)
                Text("Not signed in")
                    .font(.title3.bold())
                Text("Open the Recipator app and sign in first.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .extracting:
            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)
                Text("Extracting recipe…")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .preview(let recipe):
            RecipePreviewView(recipe: recipe) {
                save(recipe)
            }

        case .saved:
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.green)
                Text("Recipe saved!")
                    .font(.title2.bold())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .task {
                try? await Task.sleep(for: .seconds(1))
                onDismiss()
            }

        case .failed(let message):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)
                Text("Extraction failed")
                    .font(.title3.bold())
                Text(message)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func run() async {
        // Check for a valid Cognito token in the shared Keychain.
        // The extension can't run the OAuth flow itself, so we just gate here.
        guard let tokens = try? TokenStore.load(), tokens.expiresAt > Date() else {
            phase = .notSignedIn
            return
        }

        guard let url = await resolveURL() else {
            phase = .failed(RecipeError.noURLFound.localizedDescription)
            return
        }

        // Spike: still does local extraction. RECP-11 will replace this with
        // a POST /extract call using tokens.accessToken as the Bearer header.
        let extractor = RecipeExtractor(apiKey: Secrets.anthropicAPIKey)
        do {
            let recipe = try await extractor.extract(from: url)
            phase = .preview(recipe)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func resolveURL() async -> URL? {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return nil }
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    return url
                }
                // Chrome on iOS sometimes sends the URL as plain text
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let str = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
                   let url = URL(string: str), url.scheme?.hasPrefix("http") == true {
                    return url
                }
            }
        }
        return nil
    }

    private func save(_ recipe: ExtractedRecipe) {
        let saved = Recipe(title: recipe.title, url: recipe.sourceURL, savedAt: Date(), markdown: recipe.markdown)
        do {
            try RecipeStore.shared.save(saved)
            phase = .saved
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

struct RecipePreviewView: View {
    let recipe: ExtractedRecipe
    let onSave: () -> Void

    var body: some View {
        List {
            Section {
                Text(recipe.title)
                    .font(.headline)
                Text(recipe.sourceURL)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Ingredients") {
                ForEach(recipe.ingredients, id: \.self) { Text($0) }
            }

            Section("Method") {
                ForEach(Array(recipe.method.enumerated()), id: \.offset) { i, step in
                    Label {
                        Text(step)
                    } icon: {
                        Text("\(i + 1).")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onSave) {
                Label("Save Recipe", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding()
            .background(.background)
        }
    }
}
