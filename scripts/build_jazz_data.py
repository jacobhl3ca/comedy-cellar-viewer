#!/usr/bin/env python3
"""Convert ~/.jazz_alerts/all_shows.json into public/data/jazz_shows.json.

Source format (per-source dict of show entries):
    {"artist:Ron Carter": [{artist, date_text, tristate_match, city_line, venue, id}, ...], ...}

Output format (flat sorted list):
    {
      "generated_at": "...",
      "today": "YYYY-MM-DD",
      "shows": [
        {"id": "...",
         "artists": ["Buster Williams", "Jeremy Pelt", "Lenny White"],
         "date": "2026-05-09",
         "venue_label": "Smoke Jazz",
         "title": "Jeremy Pelt Quartet feat. Buster Williams and Lenny White",
         "city": "Smoke Jazz",
         "ticket_url": "https://smokejazz.com/calendar/",
         "source": "venue|artist"},
        ...
      ]
    }
"""
import json, re, sys
from datetime import date, datetime
from pathlib import Path

SRC = Path.home() / ".jazz_alerts" / "all_shows.json"
DST = Path(__file__).resolve().parents[1] / "public" / "data" / "jazz_shows.json"

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

CURRENT_YEAR = date.today().year
TODAY_ISO = date.today().isoformat()

VENUE_TICKET_URL = {
    "Blue Note NYC":          "https://www.bluenotejazz.com/nyc/shows.html",
    "Village Vanguard":       "https://villagevanguard.com/",
    "Smoke Jazz":             "https://smokejazz.com/calendar/",
    "Birdland":               "https://www.birdlandjazz.com/calendar/",
    "Jazz at Lincoln Center": "https://www.jazz.org/whats-on/calendar/",
    "Smalls":                 "https://www.smallslive.com/events/",
    "Mezzrow":                "https://mezzrow.com/events/",
    "Jazzcultural":           "https://jazzculturaltheatre.com/",
    "Emelin Theatre":         "https://www.emelin.org/",
    "Hochstein Hall":         "https://www.hochstein.org/Concerts",
    "Daryl's House":          "https://darylshouseclub.com/calendar/",
    "Roulette":               "https://roulette.org/calendar/",
    "Town Hall":              "https://thetownhall.org/events",
    "Ridgefield Playhouse":   "https://ridgefieldplayhouse.org/events/",
    "Warsaw":                 "https://warsawconcerts.com/",
}


def parse_date(date_text: str) -> str | None:
    if not date_text:
        return None
    s = date_text.strip()
    m = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            return None
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", s)
    if m:
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})", s, re.IGNORECASE)
    if m:
        mo = MONTHS.get(m.group(1).lower())
        d = int(m.group(2))
        if mo:
            year = CURRENT_YEAR
            try:
                iso = date(year, mo, d).isoformat()
                if iso < TODAY_ISO and (datetime.strptime(TODAY_ISO, "%Y-%m-%d") - datetime.strptime(iso, "%Y-%m-%d")).days > 60:
                    iso = date(year + 1, mo, d).isoformat()
                return iso
            except ValueError:
                return None
    return None


VENUE_PATTERNS = [
    (r"blue\s*note", "Blue Note NYC"),
    (r"village\s*vanguard", "Village Vanguard"),
    (r"smoke\s*jazz", "Smoke Jazz"),
    (r"birdland", "Birdland"),
    (r"jazz\s*at\s*lincoln\s*center|dizzy'?s?\s*club", "Jazz at Lincoln Center"),
    (r"\bsmalls\b", "Smalls"),
    (r"mezzrow", "Mezzrow"),
    (r"jazzcultural", "Jazzcultural"),
    (r"emelin", "Emelin Theatre"),
    (r"hochstein", "Hochstein Hall"),
    (r"daryl'?s? house", "Daryl's House"),
    (r"roulette", "Roulette"),
    (r"jersey city jazz", "Jersey City Jazz Festival"),
    (r"rochester jazz", "Rochester Jazz Festival"),
    (r"warsaw", "Warsaw"),
    (r"town hall", "Town Hall"),
    (r"ridgefield", "Ridgefield Playhouse"),
]


def match_venue(text: str) -> str | None:
    if not text:
        return None
    low = text.lower()
    for pat, label in VENUE_PATTERNS:
        if re.search(pat, low):
            return label
    return None


def looks_like_time_string(s: str) -> bool:
    if not s:
        return True
    low = s.strip().lower()
    if re.match(r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d", low):
        return True
    if re.match(r"^\d{1,2}/\d{1,2}", low):
        return True
    if re.match(r"^\d{1,2}:\d{2}", low):
        return True
    return False


def title_from_descr(city_line: str) -> str:
    if not city_line:
        return ""
    parts = re.split(r"\s+at\s+", city_line, maxsplit=1, flags=re.IGNORECASE)
    return parts[0].strip(" ,")


def derive_venue_and_title(entry: dict) -> tuple[str, str]:
    artist = (entry.get("artist") or "").strip()
    venue_field = (entry.get("venue") or "").strip()
    city_line = (entry.get("city_line") or "").strip()

    v = match_venue(venue_field)
    if v:
        return v, artist
    v = match_venue(city_line)
    if v:
        if not looks_like_time_string(venue_field):
            return v, venue_field
        descr_title = title_from_descr(city_line)
        if descr_title and not match_venue(descr_title):
            return v, descr_title
        return v, artist
    if not looks_like_time_string(venue_field):
        return "Other", venue_field
    return "Other", artist


def title_key(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").lower()).strip()


NAME_NOISE = {
    "quartet", "quintet", "trio", "sextet", "octet", "big", "band", "orchestra",
    "ensemble", "group", "featuring", "feat", "feat.", "ft", "ft.", "with", "the",
    "celebrating", "celebrates", "celebration", "tribute", "residency", "live",
    "concert", "birthday", "night", "tour", "jazz", "guest", "plus", "new", "debut",
    "presents", "project", "juneteenth", "memorial", "anniversary", "centennial",
    "tonight", "show", "set",
}


def normalize_artist_case(name: str) -> str:
    if not name:
        return name
    if name.isupper() or name.islower():
        return " ".join(w.capitalize() for w in name.split())
    return name


def extract_lineup_from_title(title: str) -> list[str]:
    if not title:
        return []
    s = re.sub(r"\([^)]*\)", "", title)
    marker = re.search(r"\bfeat\.?\b|\bfeaturing\b|\bwith the\b|\bwith\b", s, re.IGNORECASE)
    if not marker:
        return []
    s = s[marker.end():]
    parts = re.split(r"\s*(?:,| and | & |\+)\s*", s)
    names: list[str] = []
    for p in parts:
        p = p.strip(" .,—-")
        if not p or "'" in p:
            continue
        words = p.split()
        if not (2 <= len(words) <= 4):
            continue
        if not all(w[:1].isupper() and (len(w) == 1 or not w.isupper()) for w in words):
            continue
        if any(w.lower().strip(".,") in NAME_NOISE for w in words):
            continue
        names.append(" ".join(words))
    return names


def main():
    if not SRC.exists():
        print(f"Source missing: {SRC} — jazz_alerts cron has not run yet", file=sys.stderr)
        # Don't fail the build — emit an empty payload so the frontend doesn't break.
        DST.parent.mkdir(parents=True, exist_ok=True)
        DST.write_text(json.dumps({
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "today": TODAY_ISO,
            "shows": [],
        }, indent=2))
        return
    raw = json.loads(SRC.read_text())

    groups: dict[tuple, dict] = {}
    for source_key, entries in raw.items():
        source_kind = "artist" if source_key.startswith("artist:") else "venue"
        for entry in entries:
            iso_date = parse_date(entry.get("date_text", ""))
            if not iso_date or iso_date < TODAY_ISO:
                continue
            venue_label, title = derive_venue_and_title(entry)
            artist = normalize_artist_case((entry.get("artist") or "").strip())
            city_line = (entry.get("city_line") or "").strip()

            key = (iso_date, venue_label, title_key(title))
            if key not in groups:
                groups[key] = {
                    "id": entry.get("id"),
                    "date": iso_date,
                    "venue_label": venue_label,
                    "title": title,
                    "artists_seen": [],
                    "city": city_line,
                    "source": source_kind,
                }
            g = groups[key]
            if artist and artist.lower() not in {a.lower() for a in g["artists_seen"]}:
                g["artists_seen"].append(artist)
            if len(city_line) > len(g["city"]):
                g["city"] = city_line

    shows = []
    for g in groups.values():
        title_lineup = extract_lineup_from_title(g["title"])
        existing_lower = {a.lower() for a in g["artists_seen"]}
        for name in title_lineup:
            if name.lower() not in existing_lower:
                g["artists_seen"].append(name)
                existing_lower.add(name.lower())
        artists_sorted = sorted(g["artists_seen"])
        ticket_url = VENUE_TICKET_URL.get(g["venue_label"])
        shows.append({
            "id": g["id"],
            "artists": artists_sorted,
            "date": g["date"],
            "venue_label": g["venue_label"],
            "title": g["title"],
            "city": g["city"][:140],
            "source": g["source"],
            "ticket_url": ticket_url,
        })
    shows.sort(key=lambda s: (s["date"], s["venue_label"], (s["artists"] or [""])[0]))

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "today": TODAY_ISO,
        "shows": shows,
    }
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {len(shows)} jazz shows to {DST}")


if __name__ == "__main__":
    main()
