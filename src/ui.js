    .join('') || '<span style="color:var(--text-dim);font-size:13px;">None yet — tap names below</span>';
  document.getElementById('fav-count').textContent = `(${prefs.faves.length})`;

  // Skips section
  const skipList = document.getElementById('skip-list');
  skipList.innerHTML = prefs.skips
    .filter(n => n.toLowerCase().includes(filterLower))
    .map(n => `<span class="chip skip-state" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`)
    .join('') || '<span style="color:var(--text-dim);font-size:13px;">None yet</span>';
  document.getElementById('skip-count').textContent = `(${prefs.skips.length})`;

  // Alerts section
  const alerts = loadAlerts();
  const alertList = document.getElementById('alert-list');
  if (alertList) {
    alertList.innerHTML = alerts.comedians
      .filter(n => n.toLowerCase().includes(filterLower))
      .map(n => `<span class="chip alert-state" onclick="removeAlert('${n.replace(/'/g, "\\'")}')">${n} ${ICON.x}</span>`)
      .join('') || '<span style="color:var(--text-dim);font-size:13px;">No alerts set</span>';
    document.getElementById('alert-count').textContent = `(${alerts.comedians.length})`;
    const emailInput = document.getElementById('alert-email');
    if (emailInput && !emailInput.value) emailInput.value = alerts.email || '';
  }

  // Build per-venue comedian lists
  const allList = document.getElementById('all-list');

  const cellarComedians = new Set();
  Object.values(allData).flat().filter(Boolean).forEach(show => {
    show.comedians.forEach(n => cellarComedians.add(n));
  });

  const standComedians = new Set();
  standShows.forEach(show => show.comedians.forEach(n => standComedians.add(n)));

  const otherComedians = new Set();
  bigShows.forEach(evt => {
    if (evt.performers) evt.performers.split(/,\s*/).forEach(n => { if (n.trim()) otherComedians.add(n.trim()); });
  });
  gothamShows.forEach(show => {
    if (show.title) otherComedians.add(show.title.trim());
  });
  // Remove names already in Cellar/Stand from Others (avoid duplicates)
  cellarComedians.forEach(n => otherComedians.delete(n));
  standComedians.forEach(n => otherComedians.delete(n));

  function chipHtml(n) {
    let cls = 'chip';
    if (prefs.faves.includes(n)) cls += ' fav-state';
    else if (prefs.likes.includes(n)) cls += ' like-state';
    else if (prefs.skips.includes(n)) cls += ' skip-state';
    return `<span class="${cls}" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`;
  }

  const cellarSorted = [...cellarComedians].sort().filter(n => n.toLowerCase().includes(filterLower));
  const standSorted = [...standComedians].sort().filter(n => n.toLowerCase().includes(filterLower));
  const otherSorted = [...otherComedians].sort().filter(n => n.toLowerCase().includes(filterLower));

  let html = '';
  if (cellarSorted.length > 0) {
    html += `<h3 class="modal-section-title">Comedy Cellar</h3>`;
    html += `<div class="chip-list">${cellarSorted.map(chipHtml).join('')}</div>`;
  }
  if (standSorted.length > 0) {
    html += `<h3 class="modal-section-title" style="margin-top:16px;">The Stand</h3>`;
    html += `<div class="chip-list">${standSorted.map(chipHtml).join('')}</div>`;
  }
  if (otherSorted.length > 0) {
    html += `<h3 class="modal-section-title" style="margin-top:16px;">Big Shows</h3>`;
    html += `<div class="chip-list">${otherSorted.map(chipHtml).join('')}</div>`;
  }
  allList.innerHTML = html;
}

function modalCycle(name) {
  cycleComedian(name);
  const search = document.getElementById('comedian-search').value;
  renderModal(search);
}

// ---- Reset filters visibility ----
function updateResetBtn() {
  const btn = document.getElementById('reset-filters');
  const row = document.getElementById('reset-row');
  if (!btn || !row) return;
  const sortVal = document.getElementById('sort-select')?.value;
  const prefs = loadPrefs();
  const hasRatedComedians = prefs.faves.length > 0 || prefs.skips.length > 0 || prefs.likes.length > 0;
  const anyActive =
    document.getElementById('quick-mode')?.checked ||
    !document.getElementById('picture-mode')?.checked ||
    (sortVal !== 'none' && hasRatedComedians) ||
    document.getElementById('expand-bios')?.checked ||
    document.getElementById('expand-long-bios')?.checked ||
    (document.getElementById('time-filter')?.value !== 'any') ||
    !!window._timeFilterMin ||
    document.getElementById('hide-sold-out')?.checked ||
    (typeof activeNeighborhood !== 'undefined' && activeNeighborhood !== 'all') ||
    !!activeComedianFilter;
  btn.style.visibility = anyActive ? 'visible' : 'hidden';
  // Show row if reset button is visible OR filters panel is open
  const filtersOpen = document.getElementById('filters-inline')?.style.display !== 'none';
  row.classList.toggle('visible', anyActive || filtersOpen);
}

// ---- Theme toggle ----
// ---- Venue-specific footer info ----
function updateFooterInfo() {
  const el = document.getElementById('footer-venue-info');
  if (!el) return;
  if (activeSource === 'cellar') {
    el.innerHTML = `
      <p class="footer-venue-detail">Nearby parking: Minetta / W 3rd St — between 6th Ave &amp; MacDougal</p>
      <p class="footer-venue-detail">Cover: $0 (2-drink minimum, ~$12-15/drink). Cash &amp; card accepted.</p>
      <p class="footer-venue-detail">Shows are about 1 hour 15 min (5-7 comics). Arrive 15 min early — seats are first-come in your reservation group.</p>
      <p class="footer-venue-detail">3 rooms: MacDougal St (original), Village Underground (bigger stage), Fat Black Pussycat (intimate)</p>
    `;
  } else if (activeSource === 'the-stand') {
    el.innerHTML = `
      <p class="footer-venue-detail">The Stand NYC — 239 Third Ave (between 19th &amp; 20th St), Gramercy</p>
      <p class="footer-venue-detail">Tickets: $20-25 + 2-drink minimum. Full food menu available.</p>
      <p class="footer-venue-detail">Shows run ~90 min. Reserved seating — book early for front rows.</p>
    `;
  } else {
    el.innerHTML = '';
  }
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  function updateTitle() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }
  updateTitle();
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cellar-theme', next);
    updateTitle();
  });
}

function initSettingsJingle() {
  if (localStorage.getItem('settings-jingle-shown')) return;
  localStorage.setItem('settings-jingle-shown', '1');
  const btn = document.getElementById('open-settings');
  if (!btn) return;
  btn.classList.add('jingle-intro');
  btn.addEventListener('animationend', () => {
    btn.classList.remove('jingle-intro');
  }, { once: true });
}

// ---- Tagline helpers ----
const comedianTaglines = {};       // Cellar API taglines (live)
const comedianWikiBios = {};       // Wikipedia bios (last resort)

// Venue-aware bio lookup: venue-specific → NYCC DB → Cellar tagline → DB fallbacks → Wikipedia → ''
function getBioForVenue(name, venueSource) {
  const dbEntry = comedianDB.find(c => c.name === name);
  // 1. If Cellar show, prefer Cellar live tagline
  if (venueSource === 'cellar') {
    const cellarTag = comedianTaglines[name];
    if (cellarTag && !isGenericBio(cellarTag)) return cellarTag;
    // Fallback to prebaked Cellar tagline from DB
    if (dbEntry?.tagline_cellar && !isGenericBio(dbEntry.tagline_cellar)) return dbEntry.tagline_cellar;
  }
  // 2. If Stand show, prefer Stand bio from DB
  if (venueSource === 'stand') {
    if (dbEntry?.bio_stand && !isGenericBio(dbEntry.bio_stand)) return dbEntry.bio_stand;
  }
  // 3. NYCC bio from DB (works for any venue as fallback)
  if (dbEntry?.bio && !isGenericBio(dbEntry.bio)) return dbEntry.bio;
  // 4. Cellar tagline as fallback for non-Cellar shows too
  const cellarTag = comedianTaglines[name];
  if (cellarTag && !isGenericBio(cellarTag)) return cellarTag;
  // 5. Prebaked Cellar tagline from DB
  if (dbEntry?.tagline_cellar && !isGenericBio(dbEntry.tagline_cellar)) return dbEntry.tagline_cellar;
  // 6. Wikipedia — live map first, then prebaked DB
  const wiki = comedianWikiBios[name];
  if (wiki && !isGenericBio(wiki)) return wiki;
  if (dbEntry?.bio_wiki && !isGenericBio(dbEntry.bio_wiki)) return dbEntry.bio_wiki;
  return '';
}

function isGenericBio(bio) {
  if (!bio) return true;
  const lower = bio.toLowerCase();
  // Filler patterns (no real content) — block regardless of opener
  if (/performs regularly|regular at the|clubs across the city|comedy circuit|nyc comedy scene|performing on the/.test(lower) && bio.length < 200) return true;
  const startsGeneric = /^[a-z\s.'-]+ is a (stand-up )?comedian/.test(lower);
  if (startsGeneric) {
    // If it has real credits, keep it despite generic opener
    if (/appeared on|starred in|featured on|netflix|hbo|comedy central|conan|tonight show|letterman|fallon|colbert|snl|saturday night live|published|author|podcast|youtube|special|award|emmy|grammy/.test(lower)) return false;
    // Block all generic filler patterns
    if (/performs (regularly )?on the/.test(lower) || /performing (in|on)/.test(lower) ||
        /performs at clubs/.test(lower) || /regular at/.test(lower) ||
        /known for (his|her|their) (unique|sharp|fresh|energetic)/.test(lower) ||
        /across the city/.test(lower) || /comedy scene/.test(lower)) return true;
    // Short generic bios with no substance
    if (bio.length < 120) return true;
  }
  return false;
}

function toProperCase(str) {
  // Convert ALL CAPS taglines to proper case
  if (str !== str.toUpperCase()) return str; // already mixed case
  return str.toLowerCase().replace(/(?:^|\s|["'(])\w/g, c => c.toUpperCase())
    .replace(/\bNbc\b/g, 'NBC').replace(/\bHbo\b/g, 'HBO').replace(/\bSnl\b/g, 'SNL')
    .replace(/\bBet\b/g, 'BET').replace(/\bFox\b/g, 'FOX').replace(/\bMtv\b/g, 'MTV')
    .replace(/\bIfc\b/g, 'IFC').replace(/\bTbs\b/g, 'TBS').replace(/\bWb\b/g, 'WB')
    .replace(/\bNyc\b/g, 'NYC').replace(/\bNycf\b/g, 'NYCF').replace(/\bUsa\b/g, 'USA')
    .replace(/\bTv\b/gi, 'TV').replace(/\bLgbtq\b/g, 'LGBTQ');
}

// ---- Reserve button click tracking ----
function trackReserve(el) {
  // Increment localStorage counter
  const count = parseInt(localStorage.getItem('cellar-reserve-clicks') || '0') + 1;
  localStorage.setItem('cellar-reserve-clicks', count.toString());
  // Log for Vercel Analytics custom event (if available)
  if (window.va) window.va('event', { name: 'reserve_click', data: { url: el?.href || '', count } });
}

// ---- Close info popups on click outside ----
document.addEventListener('click', (e) => {
  if (!e.target.closest('.info-icon')) {
    document.querySelectorAll('.info-popup.visible').forEach(p => p.classList.remove('visible'));
  }
});

// ---- Init ----
async function init() {
  // Mode toggle (comedy / jazz). When jazz, the rest of the comedy pipeline is skipped.
  if (typeof setupModeSelect === 'function') setupModeSelect();
  if (typeof getMode === 'function' && getMode() === 'jazz') {
    await initJazzMode();
    return;
  }

  // Import prefs from URL hash (shared link) before anything renders
  await loadPrefsFromHash();

  dates = getDateRange();
  activeDate = 'all';

  // Fetch all sources in parallel — prebaked static JSON first, live API fallback for any gap.
  const [batchData] = await Promise.all([
    fetchWithTimeout(STATIC_CELLAR, {}, 5000).then(r => r.json())
      .catch(() => fetchWithTimeout(`${API_BATCH_URL}?days=${dates.length}`, {}, 15000).then(r => r.json()))
      .catch(() => null)
      .then(async (d) => {
        // If static cache covers fewer dates than `dates`, fetch the rest from the live API and merge.
        if (!d || !d.results) return d;
        const haveDates = new Set(Object.keys(d.results));
        const missing = dates.map(formatDateParam).filter(s => !haveDates.has(s));
        if (missing.length === 0) return d;
        try {
          const live = await fetchWithTimeout(`${API_BATCH_URL}?days=${dates.length}`, {}, 15000).then(r => r.json());
          if (live?.results) Object.assign(d.results, live.results);
        } catch {}
        return d;
      }),
    fetchTheStand(),
    fetchBigShows(),
    fetchNYCC(),
    loadComedianDB(),
    fetchGotham(),
    fetchAvailability()
  ]);

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const dayData = batchData?.results?.[dateStr];
    const html = dayData?.show?.html || '';
    if (html) {
      allData[dateStr] = parseShows(html, dateStr);
      allData[dateStr].forEach(show => {
