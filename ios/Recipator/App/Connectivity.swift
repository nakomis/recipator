import Foundation
import Network

/// App-wide network reachability (RECP-51). A thin wrapper over `NWPathMonitor` that
/// publishes online/WiFi state and fires callbacks when connectivity is regained — used
/// to retry avatar uploads/downloads, and (later) to drive the offline-first shopping
/// sync and gate the cloud categoriser on WiFi (RECP-49).
@MainActor
final class Connectivity: ObservableObject {
    static let shared = Connectivity()

    @Published private(set) var isOnline = true
    @Published private(set) var isWiFi = true

    private let monitor = NWPathMonitor()
    private var onReconnect: [() -> Void] = []

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.apply(path) }
        }
        monitor.start(queue: DispatchQueue(label: "com.nakomis.recipator.connectivity"))
    }

    /// Register a callback fired each time the device transitions offline -> online.
    func onBecameOnline(_ callback: @escaping () -> Void) {
        onReconnect.append(callback)
    }

    private func apply(_ path: NWPath) {
        let wasOnline = isOnline
        isOnline = path.status == .satisfied
        isWiFi = path.usesInterfaceType(.wifi)
        if !wasOnline && isOnline {
            onReconnect.forEach { $0() }
        }
    }
}
