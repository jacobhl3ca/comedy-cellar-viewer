import WidgetKit
import SwiftUI

// MARK: - Timeline

struct TonightEntry: TimelineEntry {
    let date: Date
    let shows: [ComedyShow]
    let ok: Bool
}

struct TonightProvider: TimelineProvider {
    func placeholder(in context: Context) -> TonightEntry {
        TonightEntry(date: Date(), shows: sample, ok: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (TonightEntry) -> Void) {
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TonightEntry>) -> Void) {
        Task {
            let entry = await load()
            // Lineup is per-day; refresh a few times through the evening.
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(4 * 3600))))
        }
    }

    private func load() async -> TonightEntry {
        guard let shows = await LineupService.fetch() else {
            return TonightEntry(date: Date(), shows: [], ok: false)
        }
        return TonightEntry(date: Date(), shows: shows, ok: true)
    }

    private var sample: [ComedyShow] {
        [
            ComedyShow(id: 0, time: "6:00 pm", title: "The Kickback! With Chris Redd", headliner: "Chris Redd"),
            ComedyShow(id: 1, time: "8:00 pm", title: "SiriusXM Presents", headliner: "Jeff Arcuri"),
            ComedyShow(id: 2, time: "10:00 pm", title: "Village Underground", headliner: "Ian Lara"),
        ]
    }
}

// MARK: - Views

private let cellarRed = Color(red: 0.78, green: 0.09, blue: 0.09)

struct TonightWidgetView: View {
    var entry: TonightEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content.widgetBackground()
    }

    @ViewBuilder private var content: some View {
        if !entry.ok {
            unavailable
        } else if entry.shows.isEmpty {
            empty
        } else {
            switch family {
            case .accessoryInline:      inline
            case .accessoryCircular:    circular
            case .accessoryRectangular: rectangular
            case .systemLarge:          list(limit: 8)
            case .systemMedium:         list(limit: 4)
            default:                    list(limit: 3)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 5) {
            Image(systemName: "mic.fill").foregroundColor(cellarRed).font(.system(size: 12))
            Text("Comedy Cellar").font(.system(size: 13, weight: .heavy))
            Spacer()
            Text("Tonight").font(.system(size: 11, weight: .semibold)).foregroundColor(.secondary)
        }
    }

    private func showRow(_ show: ComedyShow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text(show.time.replacingOccurrences(of: " pm", with: "").replacingOccurrences(of: " am", with: ""))
                .font(.system(size: 12, weight: .bold))
                .monospacedDigit()
                .foregroundColor(cellarRed)
                .frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                Text(show.headliner ?? show.title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                if let headliner = show.headliner, headliner != show.title {
                    Text(show.title).font(.system(size: 10)).foregroundColor(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func list(limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            ForEach(entry.shows.prefix(limit)) { showRow($0) }
            Spacer(minLength: 0)
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Comedy Cellar", systemImage: "mic.fill").font(.system(size: 12, weight: .bold))
            ForEach(entry.shows.prefix(2)) { show in
                Text("\(show.time.replacingOccurrences(of: " pm", with: "")) \(show.headliner ?? show.title)")
                    .font(.system(size: 12)).lineLimit(1)
            }
        }
    }

    private var inline: some View {
        if let first = entry.shows.first {
            return Text("\(Image(systemName: "mic.fill")) \(first.time.replacingOccurrences(of: " pm", with: "")) \(first.headliner ?? first.title)")
        } else {
            return Text("\(Image(systemName: "mic.fill")) Comedy Cellar")
        }
    }

    private var circular: some View {
        VStack(spacing: 1) {
            Image(systemName: "mic.fill").font(.system(size: 12))
            Text("\(entry.shows.count)").font(.system(size: 13, weight: .bold))
            Text("shows").font(.system(size: 8))
        }
    }

    private var empty: some View {
        VStack(spacing: 4) {
            Image(systemName: "mic.fill").foregroundColor(.secondary)
            Text("No shows listed tonight").font(.system(size: 12)).foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var unavailable: some View {
        VStack(spacing: 4) {
            Image(systemName: "mic.fill").foregroundColor(.secondary)
            Text("Lineup unavailable").font(.system(size: 12)).foregroundColor(.secondary)
        }
    }
}

private extension View {
    @ViewBuilder func widgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(.fill.tertiary, for: .widget)
        } else {
            self.padding()
        }
    }
}

// MARK: - Widget

struct TonightWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ComedyCellarTonightWidget", provider: TonightProvider()) { entry in
            TonightWidgetView(entry: entry)
        }
        .configurationDisplayName("Comedy Cellar Tonight")
        .description("Tonight's Comedy Cellar lineup.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryRectangular, .accessoryInline, .accessoryCircular,
        ])
    }
}
