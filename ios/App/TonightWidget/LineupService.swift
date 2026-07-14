import Foundation

// Tonight's Comedy Cellar lineup, from the same endpoint the app uses:
// tonightnyc.com/api/lineup?date=YYYY-MM-DD. The endpoint returns the lineup as an
// HTML fragment (the app injects it directly), so we parse show time / title /
// headliner out of it here. Structure per show:
//   <div class="set-header"> … <span class="bold">6:00 pm…</span> …
//        <span class="title">The Kickback! With Chris Redd</span> </div>
//   <div class="lineup"> … <span class="name">Chris Redd</span> … </div>

struct ComedyShow: Identifiable {
    let id: Int
    let time: String
    let title: String
    let headliner: String?
}

enum LineupService {
    static var nyc: TimeZone { TimeZone(identifier: "America/New_York") ?? .current }

    static func todayString() -> String {
        let formatter = DateFormatter()
        formatter.timeZone = nyc
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    static func fetch() async -> [ComedyShow]? {
        guard
            let url = URL(string: "https://tonightnyc.com/api/lineup?date=\(todayString())"),
            let (data, response) = try? await URLSession.shared.data(from: url),
            (response as? HTTPURLResponse)?.statusCode == 200,
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let show = object["show"] as? [String: Any],
            let html = show["html"] as? String
        else { return nil }
        return parse(html)
    }

    static func parse(_ html: String) -> [ComedyShow] {
        // Each show block begins at a "set-header"; the first chunk is preamble.
        let blocks = html.components(separatedBy: "set-header").dropFirst()
        var shows: [ComedyShow] = []
        for (index, block) in blocks.enumerated() {
            guard let time = firstMatch(#"class="bold">([^<]+)"#, in: block) else { continue }
            let title = firstMatch(#"class="title">([^<]+)"#, in: block) ?? ""
            let headliner = firstMatch(#"class="name">([^<]+)"#, in: block)
            shows.append(ComedyShow(
                id: index,
                time: clean(time),
                title: clean(title),
                headliner: headliner.map(clean)
            ))
        }
        return shows
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard
            let regex = try? NSRegularExpression(pattern: pattern),
            let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
            let range = Range(match.range(at: 1), in: text)
        else { return nil }
        return String(text[range])
    }

    private static func clean(_ raw: String) -> String {
        raw.replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&#039;", with: "'")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
