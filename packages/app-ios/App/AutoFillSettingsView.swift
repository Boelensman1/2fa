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
            // Three numbers that should agree; where they stop agreeing is
            // where suggestions get lost.
            Section {
                LabeledContent("Codes with a website", value: "\(withWebsite) of \(model.entries.count)")
                LabeledContent("Last registered", value: statusText)
                LabeledContent("Sites iOS reports", value: "\(domains.count)")
                Button("Register again") { Task { await register() } }
                    .disabled(working || model.state != .unlocked)
            } footer: {
                Text("An entry is suggested on the sites in its site matchers. On any other field, long-press it and choose AutoFill > Fava.")
            }
            if !domains.isEmpty {
                Section("Suggested on") {
                    ForEach(domains, id: \.self) { Text($0) }
                }
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
        domains = await CredentialIdentities.registeredDomains()
        status = CredentialIdentities.status
    }
}
