import AuthenticationServices
import FavaEngine
import SwiftUI

/// Fava as an AutoFill provider: whether iOS has it switched on, how many
/// codes have a website to be suggested on, and what the app last registered,
/// with "Register again". iOS offers no way to list what is registered, so
/// the count is what the app sent, not what iOS holds.
struct AutoFillSettingsView: View {
    @Environment(VaultModel.self) private var model
    @State private var enabled: Bool?
    @State private var status = CredentialIdentities.status
    @State private var working = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Fava as AutoFill provider", value: enabled.map { $0 ? "On" : "Off" } ?? "…")
                if enabled == false {
                    Button("Open AutoFill settings") {
                        ASSettingsHelper.openCredentialProviderAppSettings { _ in }
                    }
                }
            } footer: {
                if enabled == false {
                    Text("Turn on Fava under Settings > General > AutoFill & Passwords.")
                }
            }
            // iOS has no way to list what a provider registered (asking it
            // returns nothing, although the suggestions show up), so this says
            // what the app sent.
            Section {
                LabeledContent("Codes with a website", value: "\(withWebsite) of \(model.entries.count)")
                LabeledContent("Last registered", value: statusText)
                Button("Register again") { Task { await register() } }
                    .disabled(working || model.state != .unlocked)
            } footer: {
                Text("An entry is suggested on the sites in its site matchers. On any other field, long-press it and choose AutoFill > Fava.")
            }
        }
        .navigationTitle("AutoFill")
        .task { await reload() }
    }

    private var withWebsite: Int {
        model.entries.filter { !SiteDomains.of($0).isEmpty }.count
    }

    private var statusText: String {
        switch status {
        case .unknown: "Not yet"
        case .disabled: "Skipped: Fava is off"
        case .registered(let count, let at): "\(count == 1 ? "1 site" : "\(count) sites"), \(at.formatted(date: .omitted, time: .shortened))"
        case .failed(let message, _): "Failed: \(message)"
        }
    }

    private func register() async {
        working = true
        CredentialIdentities.invalidate()
        await model.refresh()
        await reload()
        working = false
    }

    private func reload() async {
        enabled = await CredentialIdentities.isEnabled()
        status = CredentialIdentities.status
    }
}
