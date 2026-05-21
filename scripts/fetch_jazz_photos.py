#!/usr/bin/env python3
"""Fetch artist photos from Wikipedia for all jazz artists in jazz_shows.json.

- Reads public/data/jazz_shows.json
- For each unique artist, hits Wikipedia REST summary API; downloads `originalimage`
  or `thumbnail` URL into public/photos/jazz/<slug>.<ext>
- Idempotent: skips entries already in jazz_photo_manifest.json with an extant file
- Negative cache for artists with no usable Wikipedia entry
"""
import json, re, sys, time, urllib.parse, mimetypes
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
SHOWS_JSON = ROOT / "public" / "data" / "jazz_shows.json"
PHOTOS_DIR = ROOT / "public" / "photos" / "jazz"
MANIFEST = ROOT / "public" / "data" / "jazz_photo_manifest.json"

UA = "TonightNYC/0.1 (personal lineup viewer; jacobhl3ca@gmail.com)"
WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"


def slug(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s or "unknown"


DISAMBIG_SUFFIXES = ["(musician)", "(jazz_musician)", "(jazz_saxophonist)",
                     "(jazz_pianist)", "(jazz_drummer)", "(drummer)", "(saxophonist)",
                     "(bassist)", "(trumpeter)", "(guitarist)", "(pianist)"]


def _fetch_one(title: str) -> dict | None:
    url = WIKI_SUMMARY + urllib.parse.quote(title)
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=15)
    if r.status_code == 404 or not r.ok:
        return None
    try:
        return r.json()
    except Exception:
        return None


def fetch_summary(name: str) -> dict | None:
    base = name.replace(" ", "_")
    summary = _fetch_one(base)
    if summary and summary.get("type") == "disambiguation":
        for suf in DISAMBIG_SUFFIXES:
            time.sleep(0.3)
            alt = _fetch_one(f"{base}_{suf}")
            if alt and alt.get("type") == "standard":
                return alt
        return summary
    return summary


def is_disambig_or_wrong(name: str, summary: dict) -> bool:
    desc = (summary.get("description") or "").lower()
    extract = (summary.get("extract") or "").lower()
    if summary.get("type") == "disambiguation":
        return True
    bad_markers = ["village in", "town in", "city in", "footballer", "politician", "actor "]
    if any(b in desc or b in extract[:200] for b in bad_markers):
        return True
    return False


def download_image(url: str, dest_base: Path) -> Path | None:
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=20, stream=True)
        if not r.ok:
            return None
        ct = r.headers.get("Content-Type", "").split(";")[0]
        ext = mimetypes.guess_extension(ct) or ".jpg"
        if ext == ".jpe":
            ext = ".jpg"
        dest = dest_base.with_suffix(ext)
        with dest.open("wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
        return dest
    except Exception as e:
        print(f"  ! download failed: {e}", file=sys.stderr)
        return None


def main():
    if not SHOWS_JSON.exists():
        print(f"jazz_shows.json missing: {SHOWS_JSON} — run build_jazz_data.py first", file=sys.stderr)
        sys.exit(1)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    data = json.loads(SHOWS_JSON.read_text())
    names = sorted({a for s in data["shows"] for a in s.get("artists", []) if a})

    manifest: dict[str, str] = {}
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text())
        except Exception:
            manifest = {}

    new_count = 0
    for name in names:
        rel = manifest.get(name)
        if rel and (ROOT / "public" / rel.lstrip("/")).exists():
            continue
        print(f"→ {name}")
        summary = fetch_summary(name)
        time.sleep(0.4)
        if not summary or is_disambig_or_wrong(name, summary):
            print(f"  - no usable Wikipedia entry")
            manifest[name] = ""
            continue
        img = (summary.get("originalimage") or summary.get("thumbnail") or {}).get("source")
        if not img:
            print(f"  - no image on page")
            manifest[name] = ""
            continue
        dest_base = PHOTOS_DIR / slug(name)
        path = download_image(img, dest_base)
        if not path:
            manifest[name] = ""
            continue
        rel = "photos/jazz/" + path.name
        manifest[name] = rel
        new_count += 1
        print(f"  ✓ {rel}")
        time.sleep(0.2)

    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"\nDone. {new_count} new photos. Manifest: {len(manifest)} entries.")


if __name__ == "__main__":
    main()
