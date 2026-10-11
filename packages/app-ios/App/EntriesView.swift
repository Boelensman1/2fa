import FavaEngine
import SwiftUI
import UIKit

struct EntriesView: View {
    @Environment(VaultModel.self) private var model
    @State private var adding = false
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(model.entries) { entry in
                    EntryRow(entry: entry)
                }
                .onDelete { offsets in
                    let doomed = offsets.map { model.entries[$0] }
                    Task {
                        for entry in doomed { try? await model.delete(entry) }
                    }
                }
            }
            .overlay {
                if model.entries.isEmpty {
                    ContentUnavailableView("No codes yet", systemImage: "key", description: Text("Add one with the + button."))
                }
            }
            .navigationTitle("Codes")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Settings", systemImage: "gear") { showingSettings = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add", systemImage: "plus") { adding = true }
                }
            }
            .sheet(isPresented: $adding) { AddEntryView() }
            .sheet(isPresented: $showingSettings) { SettingsView() }
            // Codes come with the period they are valid for; fetch new ones
            // when the first of them runs out.
            .task(id: model.entries.compactMap(\.token?.validTill).min()) {
                guard let next = model.entries.compactMap(\.token?.validTillDate).min() else { return }
                try? await Task.sleep(for: .seconds(max(next.timeIntervalSinceNow, 0.5)))
                await model.refresh()
            }
        }
    }
}

struct EntryRow: View {
    let entry: Entry

    var body: some View {
        Button {
            if let otp = entry.token?.otp { UIPasteboard.general.string = otp }
        } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(entry.issuer.isEmpty ? entry.name : entry.issuer).font(.headline)
                    if !entry.issuer.isEmpty {
                        Text(entry.name).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if let token = entry.token {
                    VStack(alignment: .trailing) {
                        Text(token.otp).font(.title2.monospacedDigit())
                        Text(timerInterval: Date.now...max(token.validTillDate, .now), countsDown: true)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .foregroundStyle(.primary)
        .accessibilityHint("Copies the code")
    }
}

struct AddEntryView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var uri = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("otpauth://totp/…", text: $uri, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Paste the otpauth:// link behind a setup QR code.")
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .navigationTitle("Add code")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            do {
                                try await model.importURI(uri)
                                dismiss()
                            } catch {
                                self.error = (error as? FavaEngineError)?.message ?? error.localizedDescription
                            }
                        }
                    }
                    .disabled(uri.isEmpty)
                }
            }
        }
    }
}

struct SettingsView: View {
    @Environment(VaultModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Unlock with Face ID", isOn: Binding(
                        get: { model.biometricUnlock },
                        set: { enabled in
                            Task {
                                do { try await model.setBiometricUnlock(enabled) } catch { self.error = error.localizedDescription }
                            }
                        }
                    ))
                } footer: {
                    Text("Also lets AutoFill fill in codes. After you lock the vault, the next unlock needs the password.")
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Section {
                    Button("Lock vault", role: .destructive) {
                        dismiss()
                        Task { await model.lock() }
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
