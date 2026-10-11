import CoreImage.CIFilterBuiltins
import FavaEngine
import SwiftUI
import UIKit

extension Error {
    /// favalib writes its messages for the person holding the device; show
    /// them as they are.
    var displayMessage: String { (self as? FavaEngineError)?.message ?? localizedDescription }
}

/// The sync server and its shared secret, which are one setting: the server
/// refuses a connection that cannot prove the secret. The secret is stored in
/// the vault and never sent; the server only sees an HMAC over its nonce.
struct SyncServerForm: View {
    @Environment(VaultModel.self) private var model
    var onDone: () -> Void = {}
    @State private var url = ""
    @State private var secret = ""
    @State private var error: String?
    @State private var working = false

    var body: some View {
        Section {
            TextField("wss://sync.example.com", text: $url)
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Server secret", text: $secret)
                .textContentType(.oneTimeCode) // keeps it out of password AutoFill
            Button(working ? "Connecting…" : "Connect") { Task { await connect() } }
                .disabled(url.isEmpty || secret.isEmpty || working)
        } header: {
            Text("Sync server")
        } footer: {
            if let error {
                Text(error).foregroundStyle(.red)
            } else {
                Text("The address of your sync server and the secret it is configured with.")
            }
        }
    }

    private func connect() async {
        working = true
        defer { working = false }
        error = nil
        do {
            try await model.setSyncServer(url: url, secret: secret)
            secret = ""
            onDone()
        } catch {
            self.error = error.displayMessage
        }
    }
}

/// Shown instead of the codes while this device's placeholder vault waits to
/// be replaced by another device's: first the server, then the pairing code.
struct JoinVaultView: View {
    @Environment(VaultModel.self) private var model
    @State private var code = ""
    @State private var deviceName = ""
    @State private var error: String?
    @State private var working = false
    @State private var confirmingStartOver = false

    var body: some View {
        NavigationStack {
            Form {
                if model.syncStatus?.syncConfigured != true {
                    Section {
                        Text("Joining goes through the sync server your other device uses. Connect to it first.")
                    }
                    SyncServerForm()
                } else if model.joinInProgress {
                    Section {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Receiving the vault…")
                        }
                        Button("Cancel", role: .cancel) { Task { await model.cancelJoin() } }
                    } footer: {
                        Text("Keep Fava open until it finishes.")
                    }
                } else {
                    Section {
                        TextField("Pairing code", text: $code, axis: .vertical)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                        PasteButton(payloadType: String.self) { strings in
                            if let first = strings.first { code = first }
                        }
                    } footer: {
                        Text("On your other device, choose Add a device and copy the code it shows.")
                    }
                    Section {
                        TextField("Device name (optional)", text: $deviceName)
                    } footer: {
                        Text("How your other devices will list this one.")
                    }
                    if let error {
                        Text(error).foregroundStyle(.red)
                    }
                    Button("Join vault") { Task { await join() } }
                        .disabled(code.isEmpty || working)
                }
            }
            .navigationTitle("Join a vault")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Start over") { confirmingStartOver = true }
                }
            }
            .confirmationDialog("Start over?", isPresented: $confirmingStartOver, titleVisibility: .visible) {
                Button("Start over", role: .destructive) { Task { await model.reset() } }
            } message: {
                Text("Removes this empty vault, so you can create a new one or join again.")
            }
        }
    }

    private func join() async {
        working = true
        defer { working = false }
        error = nil
        do {
            try await model.join(code: code, deviceName: deviceName)
            code = ""
        } catch {
            self.error = error.displayMessage
        }
    }
}

/// The sync settings: the server, pairing a new device, the paired devices.
struct SyncSettingsView: View {
    @Environment(VaultModel.self) private var model
    @State private var changingServer = false
    @State private var error: String?

    var body: some View {
        Form {
            if let status = model.syncStatus, status.syncConfigured, !changingServer {
                Section {
                    LabeledContent("Server", value: status.syncConnected ? "Connected" : "Not connected")
                    Button("Change server") { changingServer = true }
                }
                Section {
                    NavigationLink("Add a device") { AddDeviceView() }
                }
                Section {
                    if model.syncDevices.isEmpty {
                        Text("No other devices yet.").foregroundStyle(.secondary)
                    }
                    ForEach(model.syncDevices) { device in
                        DeviceRow(device: device)
                    }
                    .onDelete { offsets in
                        let doomed = offsets.map { model.syncDevices[$0] }
                        Task {
                            for device in doomed {
                                do { try await model.removeDevice(device) } catch { self.error = error.displayMessage }
                            }
                        }
                    }
                } header: {
                    Text("Devices")
                } footer: {
                    if let error {
                        Text(error).foregroundStyle(.red)
                    } else {
                        Text("Swipe to remove a device. It stops receiving changes.")
                    }
                }
            } else {
                SyncServerForm { changingServer = false }
                if changingServer {
                    Button("Cancel") { changingServer = false }
                }
            }
        }
        .navigationTitle("Sync")
        .task { await model.refreshSync() }
        .onDisappear {
            if model.syncDevices.contains(where: { !$0.acknowledged }) {
                Task { await model.acknowledgeDevices() }
            }
        }
    }
}

private struct DeviceRow: View {
    let device: SyncDevice

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(device.deviceFriendlyName ?? device.deviceType ?? "Unnamed device")
                if !device.acknowledged {
                    Text("New").font(.caption.bold()).foregroundStyle(.orange)
                }
            }
            if !device.acknowledged {
                Text("Added by another of your devices.").font(.caption).foregroundStyle(.secondary)
            }
            Text(device.fingerprint).font(.caption.monospaced()).foregroundStyle(.secondary)
        }
    }
}

/// Starts pairing as the device that has the vault and shows the code, as
/// text and as the QR code other fava clients scan.
struct AddDeviceView: View {
    @Environment(VaultModel.self) private var model
    @State private var code: PairingCode?
    @State private var error: String?

    var body: some View {
        Form {
            if let result = model.addDeviceResult, code != nil {
                Section {
                    if result.completed {
                        Label("Device added", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    } else {
                        Text(result.reason ?? "Pairing failed.").foregroundStyle(.red)
                    }
                }
            } else if let code {
                Section {
                    if let image = qrImage(code.qrPayload) {
                        Image(uiImage: image)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 260)
                            .frame(maxWidth: .infinity)
                    }
                    Text(code.text).font(.footnote.monospaced()).textSelection(.enabled)
                    Button("Copy code", systemImage: "doc.on.doc") { UIPasteboard.general.string = code.text }
                } footer: {
                    Text("On the new device, choose to join an existing vault and scan or paste this code. Keep this screen open until it finishes.")
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Add a device")
        .task {
            do { code = try await model.addDevice() } catch { self.error = error.displayMessage }
        }
        .onDisappear { Task { await model.cancelAddDevice() } }
    }

    private func qrImage(_ payload: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let cgImage = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
