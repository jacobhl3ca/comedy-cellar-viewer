#!/usr/bin/env node
// Enrich Stand Up NY shows with names that live ONLY on the poster image (the
// house/showcase bills VenuePilot doesn't expose in the title or description),
// plus a headshot for every extracted name so the tiles aren't blank.
//
// OCR uses macOS Vision (via a tiny Swift shim) — far better than tesseract on
// stylized posters — so this MUST run on a Mac. GitHub Actions prebake can't OCR,
// so we persist the result to data/standupny-enrichment.json (keyed by VenuePilot
// event id); prebake + the frontend merge it in. A launchd job re-runs this and
// commits the refreshed file (see com.jacob.tonightnyc-standupny-ocr).
//
// Usage: node scripts/enrich-standupny.mjs [--commit]

import { createRequire } from 'module';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scrapeStandupNY } = require(path.join(ROOT, 'lib', 'club-scrapers.js'));

const OUT = path.join(ROOT, 'data', 'standupny-enrichment.json');
const SWIFT = `import Foundation
import Vision
import AppKit
let p = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: p), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let req = VNRecognizeTextRequest { r, _ in
  for o in (r.results as? [VNRecognizedTextObservation]) ?? [] {
    if let t = o.topCandidates(1).first { print(t.string) }
  }
}
req.recognitionLevel = .accurate
req.usesLanguageCorrection = true
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])`;

// ---- comedian DB (validates OCR names -> high confidence) ----
let dbNames = new Set();
try {
  const db = JSON.parse(readFileSync(path.join(ROOT, 'data', 'comedians.json'), 'utf8'));
  dbNames = new Set(db.map(c => (c.name || '').toLowerCase()));
} catch {}

const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
// Any line containing one of these is a venue / place / publication / show-phrase
// / OCR-garble, not a performer. (OCR mangles "Stand Up NY" into Stand Upy/Dory,
// so any "stand*" word is blocked too.) DB-matched names bypass this list.
const BLOCK = new Set(('theatre theater hotel studio club hall lounge room bar cafe house stage ' +
  'center centre edison shubert bond post times huffington international netflix hulu hbo mtv ' +
  'city york square aspiring comics comic crisis day happy stand upy upry dory upn mental presents ' +
  'guest guests mic tickets ticket live nyc tour comedy magazine news radio tonight festival ' +
  'special anniversary minimum food beverage doors show shows enjoy featuring hosted presented ' +
  'saturday friday sunday monday tuesday wednesday thursday network podcast season').split(' '));
const looksName = s => {
  const w = s.split(' ').filter(Boolean);
  if (w.length !== 2) return false;
  if (w.some(x => BLOCK.has(x.toLowerCase()))) return false;
  return w.every(x => { const a = x.replace(/[^A-Za-z]/g, ''); return a.length >= 3 && a.length <= 15; });
};

function cleanOCRNames(lines) {
  const out = [];
  for (const raw of lines) {
    let s = raw.replace(/[•·|*&]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (!s || /\d|\$|@|#|\//.test(s)) continue;
    if (!/^[A-Za-z][A-Za-z'’\- ]+$/.test(s)) continue;
    const words = s.split(' ').filter(Boolean);
    if (words.some(w => BLOCK.has(w.toLowerCase()))) continue;
    const inDB = dbNames.has(s.toLowerCase());
    // Keep known comedians (any shape), else require a clean 2-word "First Last".
    if (!inDB && !looksName(s)) continue;
    out.push(titleCase(s));
  }
  return [...new Set(out)];
}

function ocrPoster(url) {
  const dir = mkdtempSync(path.join(tmpdir(), 'suny-ocr-'));
  try {
    const img = path.join(dir, 'p.png');
    execFileSync('curl', ['-s', '-A', 'Mozilla/5.0', url, '-o', img], { timeout: 20000 });
    const swiftFile = path.join(dir, 'ocr.swift');
    writeFileSync(swiftFile, SWIFT);
    const out = execFileSync('swift', [swiftFile, img], { timeout: 60000 }).toString();
    return out.split('\n').map(l => l.trim()).filter(Boolean);
  } catch { return []; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

async function resolvePhoto(name) {
  // Wikipedia headshot, but ONLY when the page is clearly a comedian/performer —
  // otherwise a same-named company/place/athlete would give a wrong face (worse
  // than a blank tile). Then the app's own venue photo-lookup as a safe fallback.
  const PERSON = /\b(comedian|comic|stand-?up|actor|actress|writer|host|podcast|performer|entertainer|television|film)\b/i;
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, { headers: { 'User-Agent': 'tonightnyc-enrich/1.0' } });
    if (r.ok) {
      const j = await r.json();
      const u = j?.thumbnail?.source;
      const desc = `${j?.description || ''} ${j?.extract || ''}`;
      if (u && j?.type === 'standard' && PERSON.test(desc)) return u;
    }
  } catch {}
  try {
    const r = await fetch(`https://tonightnyc.com/api/photo-lookup?name=${encodeURIComponent(name)}`);
    if (r.ok) { const j = await r.json(); if (j?.url && (j.source === 'stand' || j.source === 'nycc' || j.source === 'cellar')) return j.url; }
  } catch {}
  return '';
}

const eventId = url => (String(url).match(/events\/(\d+)/) || [])[1] || '';

const main = async () => {
  const shows = await scrapeStandupNY();
  const enrichment = {};
  for (const show of shows) {
    const id = eventId(show.url);
    if (!id) continue;
    const base = Array.isArray(show.comedians) ? show.comedians.slice() : [];
    const ocrNames = show.image ? cleanOCRNames(ocrPoster(show.image)) : [];
    const names = [...new Map([...base, ...ocrNames].map(n => [n.toLowerCase(), n])).values()];
    if (!names.length) continue;
    const photos = {};
    for (const n of names) { const p = await resolvePhoto(n); if (p) photos[n] = p; }
    enrichment[id] = { comedians: names, photos };
    console.log(`  ${show.date} ${show.title.slice(0, 40)} -> [${names.join(', ')}] (${Object.keys(photos).length} photos)`);
  }
  writeFileSync(OUT, JSON.stringify(enrichment, null, 2) + '\n');
  console.log(`Wrote ${OUT} (${Object.keys(enrichment).length} shows)`);
  if (process.argv.includes('--commit')) {
    try {
      execFileSync('git', ['-C', ROOT, 'add', 'data/standupny-enrichment.json']);
      const diff = execFileSync('git', ['-C', ROOT, 'diff', '--cached', '--stat']).toString().trim();
      if (diff) {
        execFileSync('git', ['-C', ROOT, 'commit', '-m', 'Refresh Stand Up NY poster-OCR names/photos']);
        execFileSync('git', ['-C', ROOT, 'push', 'origin', 'main']);
        console.log('Committed + pushed.');
      } else console.log('No change.');
    } catch (e) { console.error('git step failed:', e.message); }
  }
};
main().catch(e => { console.error(e); process.exit(1); });
