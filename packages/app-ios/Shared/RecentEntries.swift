import FavaEngine
import Foundation

/// The entries whose codes AutoFill filled last, newest first, so the list
/// can put them on top. It matters most where iOS names no site (pangolin's
/// split code input, long-press > AutoFill): there is nothing else to go by.
///
/// Only entry ids, in the app group's defaults: outside the vault's
/// encryption, like the identities registered with iOS, which already pair
/// those ids with the sites and labels.
enum RecentEntries {
    private static let key = "recentAutoFillEntries"
    private static let limit = 20
    private static var defaults: UserDefaults? { UserDefaults(suiteName: SharedStorage.appGroup) }

    static func record(_ entryId: String) {
        var ids = defaults?.stringArray(forKey: key) ?? []
        ids.removeAll { $0 == entryId }
        ids.insert(entryId, at: 0)
        defaults?.set(Array(ids.prefix(limit)), forKey: key)
    }

    /// The entries, most recently filled first; the rest keep their order.
    static func sorted(_ entries: [Entry]) -> [Entry] {
        let ids = defaults?.stringArray(forKey: key) ?? []
        let rank = Dictionary(ids.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        return entries.enumerated()
            .sorted { (rank[$0.element.id] ?? Int.max, $0.offset) < (rank[$1.element.id] ?? Int.max, $1.offset) }
            .map(\.element)
    }

    static func removeAll() {
        defaults?.removeObject(forKey: key)
    }
}
