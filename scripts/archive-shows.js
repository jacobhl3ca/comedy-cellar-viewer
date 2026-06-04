#!/usr/bin/env node
// Past-shows archive — append-only, dated store.
//
// The nightly prebake rewrites public/data/*-cache.json with only today..+window
// shows, so past lineups are dropped. This captures every show while it is still
// in the cache window and merges it into per-month files under public/data/archive/,
// so a date stays in the archive forever once seen (even after it leaves the caches).
//
// Layout mirrors the live caches so the app can render an archived day with the
// same renderers:
//   public/data/archive/YYYY-MM.json -> { month, updated, days: { "YYYY-MM-DD": {
//       cellar: <results[date] object>, stand: [...], gotham: [...], nycc: [...], big: [...] } } }
//   public/data/archive/index.json   -> { months, firstDate, lastDate, totalDays, updated }
//
// Run standalone (`node scripts/archive-shows.js`) or via prebake (require + run()).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return null; }
}
function readArchive(fullPath) {
  try { return JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
  catch { return null; }
}

// Pull the current caches into a flat date -> { cellar, stand[], gotham[], nycc[], big[] } map.
function extractCurrent() {
  const byDate = {};
  const ensure = d => (byDate[d] = byDate[d] || {});

  const cellar = readJSON('cellar-cache.json');
  if (cellar && cellar.results) {
    for (const [d, val] of Object.entries(cellar.results)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && val) ensure(d).cellar = val;
    }
  }

  const fromArray = (file, key, listKey) => {
    const j = readJSON(file);
    const list = (j && j[listKey]) || [];
    for (const s of list) {
      if (!s || !s.date || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) continue;
      const b = ensure(s.date);
      (b[key] = b[key] || []).push(s);
    }
  };
  fromArray('stand-cache.json', 'stand', 'shows');
  fromArray('gotham-cache.json', 'gotham', 'shows');
  fromArray('nycc-cache.json', 'nycc', 'shows');
  fromArray('big-shows-cache.json', 'big', 'events');

  return byDate;
}

// Stable identity for an array-style show within a single date+venue bucket.
function showKey(s) {
  return [s.venue || '', s.room || '', s.time || '', (s.title || '').trim()]
    .join('||').toLowerCase();
}

// Union by key — never drop a previously-seen show; refresh fields from the latest run.
function mergeArr(oldArr = [], newArr = []) {
  const map = new Map();
  for (const s of oldArr) map.set(showKey(s), s);
  for (const s of newArr) {
    const k = showKey(s);
    map.set(k, { ...(map.get(k) || {}), ...s });
  }
  return [...map.values()];
}

function mergeDay(existing = {}, incoming = {}) {
  const out = { ...existing };
  if (incoming.cellar) out.cellar = incoming.cellar; // HTML fills in over time -> keep latest
  for (const key of ['stand', 'gotham', 'nycc', 'big']) {
    if (incoming[key] && incoming[key].length) out[key] = mergeArr(existing[key], incoming[key]);
  }
  return out;
}

function countShows(day) {
  let n = day.cellar ? 1 : 0;
  for (const k of ['stand', 'gotham', 'nycc', 'big']) n += (day[k] || []).length;
  return n;
}

function run() {
  const current = extractCurrent();
  const dates = Object.keys(current).sort();
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const now = new Date().toISOString();

  // Group incoming dates by month and merge into that month's file.
  const byMonth = {};
  for (const d of dates) (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push(d);

  let touched = 0;
  for (const [month, mdates] of Object.entries(byMonth)) {
    const file = path.join(ARCHIVE_DIR, month + '.json');
    const existing = readArchive(file) || { month, days: {} };
    const existingDays = existing.days || {};
    const merged = { ...existingDays }; // append-only: dates not in this run stay untouched
    for (const d of mdates) merged[d] = mergeDay(existingDays[d], current[d]);
    const days = {};
    for (const d of Object.keys(merged).sort()) days[d] = merged[d];
    // Only rewrite when the show data actually changed — keeps `updated` (and git) quiet on no-op runs.
    if (JSON.stringify(days) === JSON.stringify(existingDays)) continue;
    fs.writeFileSync(file, JSON.stringify({ month, updated: now, days }) + '\n');
    touched++;
  }

  // Rebuild the index across every archived month (including frozen past months).
  const months = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort();
  let firstDate = null, lastDate = null, totalDays = 0;
  for (const m of months) {
    const j = readArchive(path.join(ARCHIVE_DIR, m + '.json')) || { days: {} };
    const ds = Object.keys(j.days || {}).sort();
    if (ds.length) {
      if (!firstDate || ds[0] < firstDate) firstDate = ds[0];
      if (!lastDate || ds[ds.length - 1] > lastDate) lastDate = ds[ds.length - 1];
    }
    totalDays += ds.length;
  }
  const idxFile = path.join(ARCHIVE_DIR, 'index.json');
  const core = { months, firstDate, lastDate, totalDays };
  const oldIdx = readArchive(idxFile) || {};
  const oldCore = { months: oldIdx.months, firstDate: oldIdx.firstDate, lastDate: oldIdx.lastDate, totalDays: oldIdx.totalDays };
  if (JSON.stringify(core) !== JSON.stringify(oldCore)) {
    fs.writeFileSync(idxFile, JSON.stringify({ ...core, updated: now }) + '\n');
  }

  const totalShows = dates.reduce((n, d) => n + countShows(current[d]), 0);
  console.log(`[archive] merged ${dates.length} dated buckets (${totalShows} shows) into ${touched} month file(s); archive now spans ${firstDate || '—'}..${lastDate || '—'} across ${totalDays} day(s).`);
  return { months, daysIngested: dates.length, firstDate, lastDate, totalDays };
}

module.exports = { run, extractCurrent };

if (require.main === module) run();
