import AuthenticationServices
import FavaEngine
import SwiftUI

/// What iOS knows about Fava as an AutoFill provider: whether it is switched
/// on, and the sites it will suggest Fava on, read back from iOS's own store.
/// When a site's suggestion does not show up, this tells apart "not
/// registered" (fixed by registering again) from "iOS did not see a code
/// field" (use long-press > AutoFill > Fava instead).
struct AutoFillSettingsView: View {
    @Environment(VaultModel.self) private var model
    @State private var enabled: Bool?
    @State private var domains: [String] = []
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
            Section {
                ForEach(domains, id: \.self) { Text($0) }
                Button("Register again") { Task { await register() } }
                    .disabled(working || model.state != .unlocked)
            } header: {
                Text("Suggested on \(domains.count == 1 ? "1 site" : "\(domains.count) sites")")
            } footer: {
                Text(statusText + " An entry is suggested on the sites in its site matchers. On any other field, long-press it and choose AutoFill > Fava.")
            }
        }
        .navigationTitle("AutoFill")
        .task { await reload() }
    }

    private var statusText: String {
        switch status {
        case .unknown: ""
        case .disabled: "Not registered: Fava is off as an AutoFill provider."
        case .registered: ""
        case .failed(let message): "Registering failed: \(message)."
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
        domains = await CredentialIdentities.registeredDomains()
        status = CredentialIdentities.status
    }
}
