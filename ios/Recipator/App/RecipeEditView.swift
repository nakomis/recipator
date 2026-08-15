// RecipeEditView — hand-edit a saved recipe (RECP-59).
//
// Extraction gets a recipe roughly right; this is where you fix the bits it got wrong,
// drop the waffle, and add your own notes ("halve the chilli", "needs a deeper tin").
// Every save snapshots the previous version server-side, so an edit is never final.
import SwiftUI

struct RecipeEditView: View {
    let recipe: RecipeDetail
    /// Called with the saved recipe so the detail view and list can show it immediately.
    let onSaved: (RecipeDetail) -> Void

    @Environment(\.dismiss) private var dismiss

    /// A line of a list being edited. The stable id is what lets SwiftUI keep each
    /// TextField bound to its own line across insertion, deletion, and reordering —
    /// indices alone would shuffle the keyboard focus onto the wrong row.
    private struct Line: Identifiable, Equatable {
        let id = UUID()
        var text: String
    }

    @State private var title: String
    @State private var urlString: String
    @State private var ingredients: [Line]
    @State private var method: [Line]
    @State private var notes: String
    @State private var isSaving = false
    @State private var error: String?
    @FocusState private var focused: UUID?

    init(recipe: RecipeDetail, onSaved: @escaping (RecipeDetail) -> Void) {
        self.recipe = recipe
        self.onSaved = onSaved
        _title       = State(initialValue: recipe.title)
        _urlString   = State(initialValue: recipe.url)
        _ingredients = State(initialValue: recipe.ingredients.map { Line(text: $0) })
        _method      = State(initialValue: recipe.method.map { Line(text: $0) })
        _notes       = State(initialValue: recipe.notes ?? "")
    }

    /// Blank lines are dropped on save (the server does the same), so a half-typed row
    /// left behind never becomes an empty bullet.
    private var cleanedIngredients: [String] {
        ingredients.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    private var cleanedMethod: [String] {
        method.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool {
        !isSaving && !trimmedTitle.isEmpty && URL(string: urlString.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title", text: $title, axis: .vertical)
                }

                Section("Source") {
                    TextField("https://…", text: $urlString, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.callout)
                }

                editableList("Ingredients", lines: $ingredients,
                             placeholder: "Ingredient", addLabel: "Add ingredient")

                editableList("Method", lines: $method,
                             placeholder: "Step", addLabel: "Add step", numbered: true)

                Section {
                    TextField("Anything worth remembering next time", text: $notes, axis: .vertical)
                        .lineLimit(3...10)
                } header: {
                    Text("Notes")
                } footer: {
                    Text("Your own notes. Searchable, and never overwritten by the original page.")
                }
            }
            .navigationTitle("Edit Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .environment(\.editMode, .constant(.active))   // swipe-to-delete + drag handles
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }.disabled(!canSave)
                    }
                }
            }
            .alert("Couldn't save", isPresented: .constant(error != nil), actions: {
                Button("OK") { error = nil }
            }, message: { Text(error ?? "") })
            .interactiveDismissDisabled(isSaving)
        }
    }

    /// A reorderable, deletable list of free-text lines with an "add" row at the bottom.
    @ViewBuilder
    private func editableList(
        _ title: String, lines: Binding<[Line]>,
        placeholder: String, addLabel: String, numbered: Bool = false
    ) -> some View {
        Section(title) {
            ForEach(Array(lines.wrappedValue.enumerated()), id: \.element.id) { index, line in
                HStack(alignment: .top, spacing: 10) {
                    if numbered {
                        Text("\(index + 1).")
                            .font(.subheadline.bold())
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                    }
                    TextField(placeholder, text: binding(for: line, in: lines), axis: .vertical)
                        .focused($focused, equals: line.id)
                }
            }
            .onDelete { lines.wrappedValue.remove(atOffsets: $0) }
            .onMove   { lines.wrappedValue.move(fromOffsets: $0, toOffset: $1) }

            Button {
                let line = Line(text: "")
                lines.wrappedValue.append(line)
                focused = line.id          // straight into typing — no extra tap
            } label: {
                Label(addLabel, systemImage: "plus.circle.fill")
            }
        }
    }

    /// Binding to one line by identity, so a reorder mid-edit doesn't rebind the field
    /// to whatever line has taken that index.
    private func binding(for line: Line, in lines: Binding<[Line]>) -> Binding<String> {
        Binding(
            get: { lines.wrappedValue.first(where: { $0.id == line.id })?.text ?? "" },
            set: { new in
                guard let i = lines.wrappedValue.firstIndex(where: { $0.id == line.id }) else { return }
                lines.wrappedValue[i].text = new
            }
        )
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await APIClient.shared.updateRecipe(
                id: recipe.recipeId,
                userId: recipe.userId,
                title: trimmedTitle,
                url: urlString.trimmingCharacters(in: .whitespacesAndNewlines),
                ingredients: cleanedIngredients,
                method: cleanedMethod,
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onSaved(updated)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
