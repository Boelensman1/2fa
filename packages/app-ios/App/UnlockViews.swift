import FavaEngine
import SwiftUI

struct CreateVaultView: View {
    @Environment(VaultModel.self) private var model
    @State private var password = ""
    @State private var confirmation = ""
    @State private var error: String?
    @State private var working = false
    /// Joining another device's vault: this device still gets a password of
    /// its own, since the vault is encrypted per device.
    @State private var joining = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Password", text: $password)
                        .textContentType(.newPassword)
                    SecureField("Repeat password", text: $confirmation)
                        .textContentType(.newPassword)
                } footer: {
                    if joining {
                        Text("Choose a password for this device. It does not have to match your other devices'. It cannot be recovered if you forget it.")
                    } else {
                        Text("The password encrypts your vault. It cannot be recovered if you forget it.")
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Button(joining ? "Continue" : "Create vault") { Task { await create() } }
                    .disabled(password.isEmpty || password != confirmation || working)
                Section {
                    Button(joining ? "Create a new vault instead" : "Join a vault from another device") {
                        joining.toggle()
                    }
                }
            }
            .navigationTitle(joining ? "Join a vault" : "New vault")
        }
    }

    private func create() async {
        working = true
        defer { working = false }
        do {
            let strength = try await model.passwordStrength(password)
            guard strength.isAcceptable else {
                error = strength.feedback.warning ?? strength.feedback.suggestions.first ?? "That password is too easy to guess."
                return
            }
            try await model.create(password: password, joining: joining)
        } catch {
            self.error = (error as? FavaEngineError)?.message ?? error.localizedDescription
        }
    }
}

struct UnlockView: View {
    @Environment(VaultModel.self) private var model
    @State private var password = ""
    @State private var error: String?
    @State private var working = false
    @State private var triedBiometrics = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .onSubmit { Task { await unlock() } }
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Button("Unlock") { Task { await unlock() } }
                    .disabled(password.isEmpty || working)
                if model.biometricUnlock {
                    Button("Unlock with Face ID") { Task { await model.unlockWithBiometrics() } }
                }
            }
            .navigationTitle("Fava")
            .task {
                guard !triedBiometrics else { return }
                triedBiometrics = true
                _ = await model.unlockWithBiometrics()
            }
        }
    }

    private func unlock() async {
        working = true
        defer { working = false }
        do {
            try await model.unlock(password: password)
            password = ""
        } catch let failure as FavaEngineError where failure.kind == "authentication" {
            error = "Wrong password."
        } catch {
            self.error = error.localizedDescription
        }
    }
}
