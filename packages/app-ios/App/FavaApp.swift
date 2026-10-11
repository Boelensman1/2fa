import SwiftUI

@main
struct FavaApp: App {
    @State private var model = VaultModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: model.close()
            case .active: Task { await model.start() }
            default: break
            }
        }
    }
}

struct RootView: View {
    @Environment(VaultModel.self) private var model

    var body: some View {
        switch model.state {
        case .starting:
            ProgressView()
        case .noVault:
            CreateVaultView()
        case .locked:
            UnlockView()
        case .unlocked:
            if model.isJoining {
                JoinVaultView()
            } else {
                EntriesView()
            }
        case .failed(let message):
            ContentUnavailableView("Fava could not start", systemImage: "exclamationmark.triangle", description: Text(message))
        }
    }
}
