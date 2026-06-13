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
        case preview(RecipeDetail)
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
                Text("Saving recipe…")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .preview(let recipe):
            // Server already saved it — this is just a confirmation preview.
            RecipePreviewView(recipe: recipe, onDismiss: onDismiss)

        case .failed(let message):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)
                Text("Couldn't save recipe")
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
        guard let stored = try? TokenStore.load(), stored.expiresAt > Date() else {
            phase = .notSignedIn
            return
        }

        guard let url = await resolveURL() else {
            phase = .failed(APIError.noURLFound.errorDescription)
            return
        }

        phase = .extracting
        do {
            let recipe = try await APIClient.shared.extract(url: url)
            phase = .preview(recipe)
        } catch {
            // Report the failure to the backend so it can be triaged (RECP-26)
            try? await APIClient.shared.reportFailure(url: url.absoluteString, errorType: "parse_error")
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
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let str = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
                   let url = URL(string: str), url.scheme?.hasPrefix("http") == true {
                    return url
                }
            }
        }
        return nil
    }
}

struct RecipePreviewView: View {
    let recipe: RecipeDetail
    let onDismiss: () -> Void

    @State private var selectedImageUrl: String?
    @State private var isSavingImage = false

    private var candidates: [String] { recipe.imageCandidates ?? [] }

    var body: some View {
        List {
            Section {
                Text(recipe.title).font(.headline)
                Text(recipe.url).font(.caption).foregroundStyle(.secondary)
            }

            if !candidates.isEmpty {
                Section("Choose a photo") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(candidates, id: \.self) { urlString in
                                thumbnailView(for: urlString)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            Section("Ingredients") {
                ForEach(recipe.ingredients, id: \.self) { Text($0) }
            }
            Section("Method") {
                ForEach(Array(recipe.method.enumerated()), id: \.offset) { i, step in
                    Label {
                        Text(step)
                    } icon: {
                        Text("\(i + 1).").monospacedDigit().foregroundStyle(.secondary)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                Task {
                    if let imageUrl = selectedImageUrl {
                        isSavingImage = true
                        try? await APIClient.shared.updateRecipeImage(id: recipe.recipeId, imageUrl: imageUrl)
                        isSavingImage = false
                    }
                    onDismiss()
                }
            } label: {
                Group {
                    if isSavingImage {
                        ProgressView()
                    } else {
                        Label("Done — Recipe Saved", systemImage: "checkmark.circle.fill")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.green)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(isSavingImage)
            .padding()
            .background(.background)
        }
    }

    @ViewBuilder
    private func thumbnailView(for urlString: String) -> some View {
        let isSelected = selectedImageUrl == urlString
        Button {
            selectedImageUrl = isSelected ? nil : urlString
        } label: {
            Group {
                if let url = URL(string: urlString) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        } else {
                            Color.secondary.opacity(0.15)
                                .overlay { ProgressView() }
                        }
                    }
                } else {
                    Color.secondary.opacity(0.15)
                }
            }
            .frame(width: 100, height: 100)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 3)
            }
        }
        .buttonStyle(.plain)
    }
}
