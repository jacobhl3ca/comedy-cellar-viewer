#!/usr/bin/env node
// Bulk download comedian photos from all sources
// Run: node scripts/download-photos.js

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PHOTOS_DIR = path.join(__dirname, '..', 'public', 'photos');
const DB_PATH = path.join(__dirname, '..', 'public', 'data', 'comedians.json');

// Ensure photos dir exists
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    if (!url || !url.startsWith('http')) return resolve(false);
    if (fs.existsSync(filepath)) return resolve(true); // Skip if already downloaded

    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      timeout: 10000
    }, (resp) => {
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        return downloadImage(resp.headers.location, filepath).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) return resolve(false);

      const contentType = resp.headers['content-type'] || '';
      if (!contentType.includes('image')) return resolve(false);

      const stream = fs.createWriteStream(filepath);
      resp.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(true); });
      stream.on('error', () => resolve(false));
    }).on('error', () => resolve(false));
  });
}

async function downloadFromDB() {
  console.log('Loading comedian database...');
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  console.log(`Found ${db.length} comedians in DB`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (const comedian of db) {
    const name = comedian.name;
    const photo = comedian.photo_stand || comedian.photo_nycc || comedian.photo_cellar;
    if (!photo) { skipped++; continue; }

    const ext = photo.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || 'jpg';
    const filename = `${sanitizeFilename(name)}.${ext}`;
    const filepath = path.join(PHOTOS_DIR, filename);

    const ok = await downloadImage(photo, filepath);
    if (ok) {
      downloaded++;
      if (downloaded % 20 === 0) console.log(`  Downloaded ${downloaded}...`);
    } else {
      failed++;
    }
  }

  console.log(`\nDB photos: ${downloaded} downloaded, ${skipped} no photo, ${failed} failed`);
}

async function downloadFromWikipedia() {
  console.log('\nFetching Wikipedia photos for top comedians...');
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const namesNeedingPhotos = db
    .filter(c => !c.photo_stand && !c.photo_nycc)
    .map(c => c.name)
    .slice(0, 100);

  let downloaded = 0;

  // Batch in groups of 20
  for (let i = 0; i < namesNeedingPhotos.length; i += 20) {
    const batch = namesNeedingPhotos.slice(i, i + 20);

    for (const name of batch) {
      try {
        const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`);
        if (data.thumbnail?.source) {
          const ext = data.thumbnail.source.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
          const filename = `${sanitizeFilename(name)}.${ext}`;
          const filepath = path.join(PHOTOS_DIR, filename);
          const ok = await downloadImage(data.thumbnail.source, filepath);
          if (ok) downloaded++;
        }
      } catch {}
    }
  }

  console.log(`Wikipedia photos: ${downloaded} downloaded`);
}

async function downloadFromSeatGeek() {
  console.log('\nFetching SeatGeek performer photos...');
  const CLIENT_ID = 'MTA3MDA0Nzh8MTc3NDMxMTgyMy45ODI2NDY3';
  let downloaded = 0;

  try {
    const data = await fetchJSON(`https://api.seatgeek.com/2/events?client_id=${CLIENT_ID}&venue.city=New+York&taxonomies.name=comedy&per_page=50`);
    const events = data.events || [];

    for (const evt of events) {
      for (const p of (evt.performers || [])) {
        if (p.image) {
          const filename = `${sanitizeFilename(p.name)}.jpg`;
          const filepath = path.join(PHOTOS_DIR, filename);
          const ok = await downloadImage(p.image, filepath);
          if (ok) downloaded++;
        }
      }
    }
  } catch (e) {
    console.error('SeatGeek fetch failed:', e.message);
  }

  console.log(`SeatGeek photos: ${downloaded} downloaded`);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'CellarTonight/1.0' }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Bulk Photo Downloader ===\n');
  await downloadFromDB();
  await downloadFromWikipedia();
  await downloadFromSeatGeek();

  // Count total files
  const files = fs.readdirSync(PHOTOS_DIR).filter(f => !f.startsWith('.'));
  console.log(`\n=== Total: ${files.length} photos in /public/photos/ ===`);
}

main().catch(console.error);
