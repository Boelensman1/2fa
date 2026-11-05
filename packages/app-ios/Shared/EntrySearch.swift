import FavaEngine
import Foundation

extension Entry {
    /// Whether the search field's text finds this entry: by name or issuer,
    /// as favalib's `searchEntriesMetas` does, but ignoring diacritics too.
    /// Filtering here rather than through the engine keeps the codes already
    /// listed and costs no round trip per keystroke.
    func matches(search: String) -> Bool {
        let query = search.trimmingCharacters(in: .whitespaces)
        return query.isEmpty || name.localizedStandardContains(query) || issuer.localizedStandardContains(query)
    }
}
