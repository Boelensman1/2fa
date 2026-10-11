#if canImport(JavaScriptCore)
import Foundation

/// The one thread the engine's JSContext lives on.
///
/// A JSContext is not thread-safe, and the engine also needs a run loop: host
/// timers are `Timer`s on it, and socket events are delivered to it. It cannot
/// be the main thread, because the host's argon2id is synchronous (openpgp
/// calls it synchronously) and blocks for the length of a derivation.
final class JSThread: Thread {
    private var cfRunLoop: CFRunLoop?
    private let started = DispatchSemaphore(value: 0)

    override init() {
        super.init()
        name = "favaenginejsc"
        qualityOfService = .userInitiated
    }

    /// Starts the thread and waits until its run loop accepts work.
    func startAndWait() {
        start()
        started.wait()
    }

    override func main() {
        cfRunLoop = CFRunLoopGetCurrent()
        // A run loop with no sources returns immediately; this port keeps it
        // alive between calls.
        RunLoop.current.add(Port(), forMode: .default)
        started.signal()
        while !isCancelled {
            _ = autoreleasepool {
                RunLoop.current.run(mode: .default, before: .distantFuture)
            }
        }
    }

    /// Runs `block` on this thread, after anything already queued.
    func perform(_ block: @escaping () -> Void) {
        guard let cfRunLoop else {
            preconditionFailure("JSThread.perform before startAndWait")
        }
        CFRunLoopPerformBlock(cfRunLoop, CFRunLoopMode.defaultMode.rawValue, block)
        CFRunLoopWakeUp(cfRunLoop)
    }

    /// Stops the run loop. Blocks queued before this still run.
    func stop() {
        perform { [weak self] in
            self?.cancel()
            CFRunLoopStop(CFRunLoopGetCurrent())
        }
    }

    var isCurrent: Bool { Thread.current === self }
}
#endif
