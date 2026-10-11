#if canImport(JavaScriptCore)
import Foundation
import JavaScriptCore
import os
import Security

/// The native half of the engine: installs `globalThis.__favaHost`.
///
/// The contract is `packages/engine-jsc/src/host.mts`; keep the two in step.
/// Everything here runs on the JS thread: JS calls the functions on it, and
/// timer and socket events are delivered back to it before touching JS.
final class FavaHost {
    private let thread: JSThread
    private let onSave: (String) -> Void
    private let onEvent: (String, String) -> Void
    private let logger = Logger(subsystem: "favaenginejsc", category: "engine")

    // JS-thread state.
    private var timers: [Int: Timer] = [:]
    private var sockets: [Int: (bridge: WebSocketBridge, onEvent: JSValue)] = [:]
    private var nextId = 1

    init(
        thread: JSThread,
        onSave: @escaping (String) -> Void,
        onEvent: @escaping (String, String) -> Void
    ) {
        self.thread = thread
        self.onSave = onSave
        self.onEvent = onEvent
    }

    /// Installs the host into a context. Call on the JS thread, before
    /// evaluating the bundle.
    func install(in context: JSContext) {
        let host = JSValue(newObjectIn: context)!

        let randomBytes: @convention(block) (Int) -> String = { count in
            var bytes = [UInt8](repeating: 0, count: max(0, count))
            guard count >= 0,
                  SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess
            else {
                FavaHost.throwInJS("randomBytes: SecRandomCopyBytes failed")
                return ""
            }
            return Data(bytes).base64EncodedString()
        }

        let argon2id: @convention(block) (String, String, Int, Int, Int, Int) -> String = {
            password, salt, iterations, memoryKiB, parallelism, hashLength in
            guard let password = Data(base64Encoded: password),
                  let salt = Data(base64Encoded: salt),
                  iterations > 0, memoryKiB > 0, parallelism > 0, hashLength > 0
            else {
                FavaHost.throwInJS("argon2id: invalid arguments")
                return ""
            }
            do {
                let hash = try Argon2.id(
                    password: [UInt8](password), salt: [UInt8](salt),
                    iterations: UInt32(iterations), memoryKiB: UInt32(memoryKiB),
                    parallelism: UInt32(parallelism), length: hashLength
                )
                return Data(hash).base64EncodedString()
            } catch {
                FavaHost.throwInJS("argon2id: \(error)")
                return ""
            }
        }

        let setTimeout: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, ms in
            guard let self else { return 0 }
            let id = self.takeId()
            let timer = Timer(timeInterval: max(0, ms) / 1000, repeats: false) { [weak self] _ in
                guard let self, self.timers.removeValue(forKey: id) != nil else { return }
                callback.call(withArguments: [])
            }
            self.timers[id] = timer
            RunLoop.current.add(timer, forMode: .default)
            return id
        }

        let clearTimeout: @convention(block) (Int) -> Void = { [weak self] id in
            self?.timers.removeValue(forKey: id)?.invalidate()
        }

        let log: @convention(block) (String, String) -> Void = { [logger = self.logger] level, message in
            switch level {
            case "error": logger.error("\(message, privacy: .public)")
            case "warn": logger.warning("\(message, privacy: .public)")
            case "info": logger.info("\(message, privacy: .public)")
            default: logger.debug("\(message, privacy: .public)")
            }
        }

        let wsConnect: @convention(block) (String, JSValue) -> Int = { [weak self] url, onEvent in
            guard let self else { return 0 }
            guard let parsed = URL(string: url),
                  let scheme = parsed.scheme?.lowercased(), scheme == "ws" || scheme == "wss"
            else {
                FavaHost.throwInJS("wsConnect: invalid url \(url)")
                return 0
            }
            let id = self.takeId()
            let bridge = WebSocketBridge(url: parsed) { [weak self] type, a, b in
                self?.thread.perform { self?.deliverSocketEvent(id: id, type: type, a: a, b: b) }
            }
            self.sockets[id] = (bridge, onEvent)
            bridge.start()
            return id
        }

        let wsSend: @convention(block) (Int, String) -> Void = { [weak self] id, text in
            self?.sockets[id]?.bridge.send(text)
        }

        let wsClose: @convention(block) (Int, Int, String) -> Void = { [weak self] id, code, reason in
            self?.sockets[id]?.bridge.close(code: code, reason: reason)
        }

        let save: @convention(block) (String) -> Void = { [weak self] locked in
            self?.onSave(locked)
        }

        let emit: @convention(block) (String, String) -> Void = { [weak self] type, detail in
            self?.onEvent(type, detail)
        }

        // A closure reaches JS as a function only as an Objective-C block
        // object; boxed in `Any` it could arrive as an opaque wrapper.
        let functions: [String: AnyObject] = [
            "randomBytes": unsafeBitCast(randomBytes, to: AnyObject.self),
            "argon2id": unsafeBitCast(argon2id, to: AnyObject.self),
            "setTimeout": unsafeBitCast(setTimeout, to: AnyObject.self),
            "clearTimeout": unsafeBitCast(clearTimeout, to: AnyObject.self),
            "log": unsafeBitCast(log, to: AnyObject.self),
            "wsConnect": unsafeBitCast(wsConnect, to: AnyObject.self),
            "wsSend": unsafeBitCast(wsSend, to: AnyObject.self),
            "wsClose": unsafeBitCast(wsClose, to: AnyObject.self),
            "save": unsafeBitCast(save, to: AnyObject.self),
            "emit": unsafeBitCast(emit, to: AnyObject.self),
        ]
        for (name, function) in functions {
            host.setObject(function, forKeyedSubscript: name as NSString)
        }
        context.setObject(host, forKeyedSubscript: "__favaHost" as NSString)
    }

    /// Cancels every timer and socket. Call on the JS thread.
    func tearDown() {
        timers.values.forEach { $0.invalidate() }
        timers.removeAll()
        sockets.values.forEach { $0.bridge.cancel() }
        sockets.removeAll()
    }

    private func takeId() -> Int {
        defer { nextId += 1 }
        return nextId
    }

    private func deliverSocketEvent(id: Int, type: String, a: Any?, b: Any?) {
        guard let socket = sockets[id] else { return }
        if type == "close" {
            sockets.removeValue(forKey: id)
        }
        socket.onEvent.call(withArguments: [type, a ?? NSNull(), b ?? NSNull()])
    }

    private static func throwInJS(_ message: String) {
        guard let context = JSContext.current() else { return }
        context.exception = JSValue(newErrorFromMessage: message, in: context)
    }
}

/// One WebSocket over URLSessionWebSocketTask, reporting through `deliver`
/// with the host contract's event shapes. `deliver` is called on the
/// session's delegate queue; FavaHost hops to the JS thread.
final class WebSocketBridge: NSObject, URLSessionWebSocketDelegate {
    private let url: URL
    private let deliver: (_ type: String, _ a: Any?, _ b: Any?) -> Void
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "favaenginejsc.websocket"
        return queue
    }()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    // Delegate-queue state.
    private var finished = false
    private var requestedClose: (code: Int, reason: String)?

    init(url: URL, deliver: @escaping (_ type: String, _ a: Any?, _ b: Any?) -> Void) {
        self.url = url
        self.deliver = deliver
        super.init()
    }

    func start() {
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: queue)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task
        task.resume()
    }

    func send(_ text: String) {
        task?.send(.string(text)) { [weak self] error in
            if let error { self?.deliver("error", error.localizedDescription, nil) }
        }
    }

    func close(code: Int, reason: String) {
        queue.addOperation { [weak self] in
            guard let self else { return }
            self.requestedClose = (code, reason)
            self.task?.cancel(
                with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure,
                reason: reason.data(using: .utf8)
            )
        }
    }

    /// Drops the socket without reporting anything; for engine shutdown.
    func cancel() {
        queue.addOperation { [weak self] in
            self?.finished = true
            self?.task?.cancel()
            self?.session?.invalidateAndCancel()
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(.string(text)):
                self.deliver("message", text, nil)
                self.receive()
            case let .success(.data(data)):
                self.deliver("message", String(decoding: data, as: UTF8.self), nil)
                self.receive()
            case .success:
                self.receive()
            case .failure:
                break // didCompleteWithError reports it
            }
        }
    }

    private func finish(code: Int, reason: String) {
        guard !finished else { return }
        finished = true
        deliver("close", code, reason)
        session?.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        guard !finished else { return }
        deliver("open", nil, nil)
        receive()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        finish(code: closeCode.rawValue, reason: reason.map { String(decoding: $0, as: UTF8.self) } ?? "")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let requestedClose {
            finish(code: requestedClose.code, reason: requestedClose.reason)
            return
        }
        if let error, !finished {
            deliver("error", error.localizedDescription, nil)
        }
        finish(code: 1006, reason: "")
    }
}
#endif
