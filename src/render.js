    // The Stand has its own date grouping
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `
        <span class="tab-day">${getDayName(d)}</span>
        <span class="tab-date">${getDateLabel(d)}</span>
      `;
      tab.addEventListener('click', () => {
        activeDate = activeDate === dateStr ? 'all' : dateStr;
        renderTabs();
        renderShows();
      });
      nav.appendChild(tab);
    });
    return;
  }

  if (activeSource === 'big-shows') {
    const bigDates = [...new Set(bigShows.map(e => e.date))].sort();
    bigDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>`;
      tab.addEventListener('click', () => { activeDate = activeDate === dateStr ? 'all' : dateStr; renderTabs(); renderShows(); });
      nav.appendChild(tab);
    });
    return;
  }

  if (activeSource === 'gotham') {
    const gothamDates = [...new Set(gothamShows.map(s => s.date))].sort();
    gothamDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>`;
      tab.addEventListener('click', () => { activeDate = activeDate === dateStr ? 'all' : dateStr; renderTabs(); renderShows(); });
      nav.appendChild(tab);
    });
    return;
  }

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const tab = document.createElement('button');
    const shows = allData[dateStr];
    const hasCellar = shows && shows.length > 0;
    let noLineup;
    if (activeSource === 'all') {
      // All Venues: check all sources
      noLineup = !hasCellar && !standShows.some(s => s.date === dateStr) && !nyccShows.some(s => s.date === dateStr) && !gothamShows.some(s => s.date === dateStr) && !bigShows.some(e => e.date === dateStr);
    } else {
      // Cellar tab (default): only check Cellar data
      noLineup = !hasCellar;
    }
    tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '') + (noLineup ? ' no-lineup' : '');
    const maxScore = shows ? Math.max(0, ...shows.map(s => { const sc = scoreShow(s); return sc.faves + sc.likes; })) : 0;
    const maxFavs = shows ? Math.max(0, ...shows.map(s => scoreShow(s).faves)) : 0;

    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
      ${maxFavs >= 2 ? `<span class="tab-badge">${maxFavs} faves</span>` : (maxScore >= 2 ? `<span class="tab-badge">${maxScore} picks</span>` : '')}
    `;

    tab.addEventListener('click', () => {
      activeDate = activeDate === dateStr ? 'all' : dateStr;
      renderTabs();
      renderShows();
    });
    nav.appendChild(tab);
  });

  // "More days" tab — loads days 8-14 on demand
  if (!moreDaysLoaded) {
    const moreTab = document.createElement('button');
    moreTab.className = 'day-tab more-days-tab';
    moreTab.innerHTML = `<span class="tab-day">More</span><span class="tab-date">days →</span>`;
    moreTab.addEventListener('click', async () => {
      moreTab.innerHTML = `<span class="tab-day">Loading</span><span class="tab-date">...</span>`;
      await loadMoreDays();
    });
    nav.appendChild(moreTab);
  }
}

let moreDaysLoaded = false;
async function loadMoreDays() {
  const now = new Date();
  const extraDates = [];
  for (let i = 7; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    extraDates.push(d);
  }
  try {
    const resp = await fetchWithTimeout(`${API_BATCH_URL}?days=14&skip=7`, {}, 15000);
    const batchData = await resp.json();
    extraDates.forEach(d => {
      const dateStr = formatDateParam(d);
      const dayData = batchData?.results?.[dateStr];
      const html = dayData?.show?.html || '';
      if (html) {
        allData[dateStr] = parseShows(html, dateStr);
        allData[dateStr].forEach(show => {
          show.comedians.forEach(name => allComediansSeen.add(name));
        });
      } else {
        allData[dateStr] = null;
      }
    });
    dates.push(...extraDates);
    moreDaysLoaded = true;
    renderTabs();
    renderShows();
  } catch (e) {
    console.error('Failed to load more days:', e);
  }
}

// ---- Calendar Picker ----
let calendarOpen = false;
let calendarSelectedDates = new Set();

function initCalendar() {
  const btn = document.getElementById('calendar-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    calendarOpen = !calendarOpen;
    btn.classList.toggle('active', calendarOpen);
    renderCalendar();
  });
}

function renderCalendar() {
  const picker = document.getElementById('calendar-picker');
  if (!picker) return;
  if (!calendarOpen) { picker.style.display = 'none'; return; }
  picker.style.display = 'block';

  const today = new Date();
  today.setHours(0,0,0,0);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 13); // 14 days default

  // Extend calendar range for sources with events beyond 14 days
  if (activeSource === 'big-shows' && bigShows.length > 0) {
    const latestBigShow = bigShows.reduce((max, e) => e.date > max ? e.date : max, '');
    if (latestBigShow) {
      const latestDate = new Date(latestBigShow + 'T12:00:00');
      if (latestDate > maxDate) maxDate.setTime(latestDate.getTime());
    }
  } else if (activeSource === 'the-stand' && standShows.length > 0) {
    const latestStand = standShows.reduce((max, s) => s.date > max ? s.date : max, '');
    if (latestStand) {
      const latestDate = new Date(latestStand + 'T12:00:00');
      if (latestDate > maxDate) maxDate.setTime(latestDate.getTime());
    }
  } else if (activeSource === 'all') {
    const allDates = [...bigShows.map(e => e.date), ...standShows.map(s => s.date)];
    const latest = allDates.reduce((max, d) => d > max ? d : max, '');
    if (latest) {
      const latestDate = new Date(latest + 'T12:00:00');
      if (latestDate > maxDate) maxDate.setTime(latestDate.getTime());
    }
  }

  // Find the Monday of the week containing today
  const startOfWeek = new Date(today);
  const dow = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - ((dow + 6) % 7)); // Monday

  // End on Sunday of the week containing maxDate
  const endOfWeek = new Date(maxDate);
  const edow = endOfWeek.getDay();
  if (edow !== 0) endOfWeek.setDate(endOfWeek.getDate() + (7 - edow));

  let html = '<div class="calendar-grid">';

  let lastMonth = -1;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Add initial month + day headers
  const cursor = new Date(startOfWeek);
  lastMonth = cursor.getMonth();
  html += `<div class="cal-month-label">${monthNames[lastMonth]}</div>`;
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => {
    html += `<div class="cal-header">${d}</div>`;
  });

  // Build set of dates that have shows across all sources
  const datesWithShows = new Set();
  // Cellar shows
  Object.keys(allData).forEach(d => { if (allData[d] && allData[d].length > 0) datesWithShows.add(d); });
  // The Stand shows
  standShows.forEach(s => { if (s.date) datesWithShows.add(s.date); });
  // Big Shows
  bigShows.forEach(e => { if (e.date) datesWithShows.add(e.date); });
  // NYCC shows
  if (typeof nyccShows !== 'undefined') nyccShows.forEach(s => { if (s.date) datesWithShows.add(s.date); });
  // Gotham shows
  if (typeof gothamShows !== 'undefined') gothamShows.forEach(s => { if (s.date) datesWithShows.add(s.date); });

  while (cursor <= endOfWeek) {
    // Month separator row when month changes (at start of a week / Monday)
    if (cursor.getMonth() !== lastMonth && cursor.getDay() === 1) {
      lastMonth = cursor.getMonth();
      html += `<div class="cal-month-label">${monthNames[lastMonth]}</div>`;
    }
    const dateStr = cursor.toISOString().split('T')[0];
    const isToday = cursor.getTime() === today.getTime();
    const inRange = cursor >= today && cursor <= maxDate;
    const isSelected = calendarSelectedDates.has(dateStr);
    const hasNoShows = inRange && !datesWithShows.has(dateStr);
    const classes = ['cal-day'];
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');
    if (!inRange) classes.push('disabled');
    if (hasNoShows) classes.push('no-shows');
    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${cursor.getDate()}</div>`;
    cursor.setDate(cursor.getDate() + 1);
  }
  html += '</div>';
  html += '<div class="calendar-actions">';
  html += '<button onclick="calendarClear()">Clear</button>';
  html += '<button class="primary" onclick="calendarApply()">Show selected</button>';
  html += '</div>';

  picker.innerHTML = html;

  // Click handlers for day cells
  picker.querySelectorAll('.cal-day:not(.disabled)').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = cell.dataset.date;
      if (calendarSelectedDates.has(d)) calendarSelectedDates.delete(d);
      else calendarSelectedDates.add(d);
      cell.classList.toggle('selected');
    });
  });
}

function calendarClear() {
  calendarSelectedDates.clear();
  // Reset to default view
  activeDate = 'all';
  renderCalendar();
  renderTabs();
  renderShows();
}

async function calendarApply() {
  if (calendarSelectedDates.size === 0) return calendarClear();

  // Ensure all selected dates have data loaded
  const needed = [...calendarSelectedDates].filter(d => !(d in allData));
  if (needed.length > 0) {
    // Fetch missing days via batch
    try {
      const resp = await fetchWithTimeout(
        `${API_BATCH_URL}?days=14`, {}, 15000
      );
      const batchData = await resp.json();
      for (const dateStr of needed) {
        const dayData = batchData?.results?.[dateStr];
        const html = dayData?.show?.html || '';
        if (html) {
          allData[dateStr] = parseShows(html, dateStr);
          allData[dateStr].forEach(show => {
            show.comedians.forEach(name => allComediansSeen.add(name));
          });
        } else {
          allData[dateStr] = null;
        }
        // Add to dates array if not present
        const d = new Date(dateStr + 'T12:00:00');
        if (!dates.find(dd => formatDateParam(dd) === dateStr)) {
          dates.push(d);
          dates.sort((a, b) => a - b);
        }
      }
      moreDaysLoaded = true;
    } catch (e) {
      console.error('Failed to fetch calendar dates:', e);
    }
  }

  // If exactly 1 date selected, go to that day tab
  if (calendarSelectedDates.size === 1) {
    activeDate = [...calendarSelectedDates][0];
  } else {
    // Multi-select: set to 'all' and filter in render
    activeDate = 'calendar';
  }

  calendarOpen = false;
  document.getElementById('calendar-btn')?.classList.remove('active');
  renderCalendar();
  renderTabs();
  renderShows();
}

// ---- Venue Source Tab Rendering ----
function renderSourceTabs() {
  const container = document.getElementById('venue-source-tabs');
  container.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === activeSource);
  });

  // Update counts
  const cellarCount = Object.values(allData).flat().filter(Boolean).length;
  const standCount = standShows.length;
  const bigCount = bigShows.length;

  container.querySelectorAll('.venue-source-tab').forEach(btn => {
    const src = btn.dataset.source;
    let count = 0;
    if (src === 'cellar') count = cellarCount;
    else if (src === 'the-stand') count = standCount;
    else if (src === 'big-shows') count = bigCount;
    else if (src === 'gotham') count = gothamShows.length;
    const existing = btn.querySelector('.source-count');
    if (existing) existing.remove();
    if (count > 0) {
      btn.insertAdjacentHTML('beforeend', `<span class="source-count">(${count})</span>`);
    }
  });
}

// Insert filter banner at top of container AFTER content has been rendered
function _insertFilterBanner(container) {
  const old = document.getElementById('comedian-filter-banner');
  if (old) old.remove();
  if (!activeComedianFilter) return;
  const banner = document.createElement('div');
  banner.id = 'comedian-filter-banner';
  banner.className = 'comedian-filter-banner';
  banner.innerHTML = `Showing shows with <strong>${activeComedianFilter}</strong> <button onclick="filterByComedian('${activeComedianFilter.replace(/'/g, "\\'")}')">${ICON.x} Clear</button>`;
  container.prepend(banner);
}

function renderShows() {
  const container = document.getElementById('shows-container');

  // Toggle directory-mode body class for CSS-based hiding of irrelevant filters
  document.body.classList.toggle('dir-mode', activeSource === 'comedians');

  // Route to correct renderer based on active source
  if (activeSource === 'the-stand') {
    renderTheStandShows(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }
  if (activeSource === 'big-shows') {
    renderBigShows(container);
    _insertFilterBanner(container);
    return;
  }
  if (activeSource === 'comedians') {
    renderComedianDirectory(container);
    return;
  }
  if (activeSource === 'all') {
    renderAllVenues(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }
  if (activeSource === 'nycc') {
    renderNYCCShows(container);
    return;
  }
  if (activeSource === 'gotham') {
    renderGothamShows(container);
    return;
  }

  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves').checked;
  const pictureMode = document.getElementById('picture-mode')?.checked;

  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  // Always render venue filters
  const allShowsFlat = Object.values(allData).flat().filter(Boolean);
  renderVenueFilters(allShowsFlat);

  // Sort dropdown — if sorting, always use per-showtime view (across all days)
  const sortVal = document.getElementById('sort-select')?.value || 'none';
  if (sortVal === 'faves') {
    renderSortedByFaves(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }


  // "All" or "calendar" schedule view — show all/selected days
  if (activeDate === 'all' || activeDate === 'calendar') {
    renderAllDaysSchedule(container);
    renderBottomTabs();
    _insertFilterBanner(container);
    return;
  }

  const shows = allData[activeDate];

  if (shows === null) {
    container.innerHTML = '<div class="no-shows">Could not load lineup. Try refreshing.</div>';
    return;
  }

  if (!shows || shows.length === 0) {
    // Figure out which day this is to give a helpful message
    const d = new Date(activeDate + 'T12:00:00');
    const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    let hint = '';
    if (dow >= 1 && dow <= 4) {
      // Mon-Thu: weekday lineups post day-of or day-before
      hint = 'Check back — weekday lineups usually drop the day before.';
    } else {
      // Fri-Sun: weekend lineups post Thursday
      hint = 'Check back Thursday — that\'s when weekend lineups are posted.';
    }
    container.innerHTML = `<div class="no-shows">No lineup posted yet for this day.<br><span style="font-size:13px;color:var(--text-dim);margin-top:6px;display:inline-block;">${hint}</span></div>`;
    return;
  }

  const prefs = loadPrefs();
  const hasAnyPrefs = prefs.faves.length > 0 || prefs.skips.length > 0 || prefs.likes.length > 0;

  let sorted = shows;

  let html = '';

  // Onboarding banner — commented out for now (revisit later)
  // if (!hasAnyPrefs && !localStorage.getItem('onboard-dismissed')) {
  //   html += `
  //     <div class="onboard-banner" id="onboard-banner">
  //       <p><strong>New here?</strong> Turn on "Ratings mode" to tap comedian names and mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
  //       <button class="onboard-btn" onclick="openModal()">Set Up</button>
  //       <button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button>
  //     </div>
  //   `;
  // }

  html += sorted.map(show => renderShowCard(show, hideSkips, onlyFavs, activeDate)).join('');

  container.innerHTML = html;

  // Render bottom nav tabs
  renderBottomTabs();
  _insertFilterBanner(container);
}

function showTitlePopup(el) {
  if (el.scrollWidth <= el.clientWidth) return; // not truncated, no popup needed
  const popup = document.createElement('div');
  popup.className = 'big-show-title-popup';
  popup.textContent = el.title || el.textContent;
  document.body.appendChild(popup);
  const dismiss = () => { popup.remove(); document.removeEventListener('click', dismiss); };
  requestAnimationFrame(() => document.addEventListener('click', dismiss));
}

function hideSoldOutToggle(soldOut) {
  if (!soldOut) return '';
  const checked = document.getElementById('hide-sold-out')?.checked ? ' checked' : '';
  return `<label class="toggle hide-sold-out-inline"><input type="checkbox"${checked} onchange="toggleHideSoldOut()"><span>Hide Sold Out</span></label>`;
}

function toggleHideSoldOut() {
  const cb = document.getElementById('hide-sold-out');
  if (!cb) return;
  // Poof animation on all sold-out cards
  const cards = document.querySelectorAll('.show-card.sold-out, .big-show-card.sold-out');
  cards.forEach(c => c.classList.add('poof'));
  // Highlight the toolbar toggle
  const toolbarLabel = cb.closest('label');
  if (toolbarLabel) toolbarLabel.classList.add('toggle-highlight');
  setTimeout(() => {
    cb.checked = true;
    updateResetBtn();
    renderShows();
    if (toolbarLabel) setTimeout(() => toolbarLabel.classList.remove('toggle-highlight'), 1200);
  }, 500);
}

// ---- Shared show card renderer ----
function renderShowCard(show, hideSkips, onlyFavs, dateStr) {
  try {
  // Comedian filter
  if (activeComedianFilter && !show.comedians.some(c => c.toLowerCase() === activeComedianFilter.toLowerCase())) return '';

  // Hide past shows (2+ hours ago)
  const showDateStr = dateStr || activeDate;
  if (showDateStr && showDateStr !== 'all' && showDateStr !== 'calendar' && isShowPast(showDateStr, show.time)) return '';

  // Venue filter (compare against normalized venue name)
  if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return '';

  // Time filter (range)
  const timeFilter = document.getElementById('time-filter')?.value;
  const timeFilterMin = window._timeFilterMin;
  const showTime24_tf = to24h(show.time);
  if (timeFilter && timeFilter !== 'any' && showTime24_tf && showTime24_tf > timeFilter) return '';
  if (timeFilterMin && showTime24_tf && showTime24_tf < timeFilterMin) return '';

  const stats = scoreShow(show);
  const hasFavOrLike = stats.faves > 0 || stats.likes > 0;

  if (onlyFavs && !hasFavOrLike) return '';

  // Hide entire show if any comedian is a skip
  if (hideSkips && stats.skips > 0) return '';

  const comediansHtml = renderComedianChips(show.comedians, hideSkips, 'cellar');

  let badge = '';
  const totalScore = stats.faves + stats.likes;
  if (stats.faves >= 3) {
    badge = `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
  } else if (stats.faves >= 2) {
    badge = `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;
  }

  const soldOut = dateStr ? isShowSoldOut(dateStr, show.time) : false;
  if (soldOut && document.getElementById('hide-sold-out')?.checked) return '';
  const cardClass = (stats.faves >= 3 ? 'show-card must-go' : 'show-card') + (soldOut ? ' sold-out' : '');

  // Detect named/special shows vs plain venue variants
  const normalizedVenue = normalizeVenue(show.venue);
  const venueStart = show.venue.toLowerCase();
  const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');

  return `
    <div class="${cardClass}" data-venue-source="cellar">
      <div class="show-header">
        <div>
          <span class="show-time">${formatTime(show.time)}</span>
          ${badge}
        </div>
        ${!isPlainVenue ? (getCellarPoster(show.venue) ? `<span class="show-name poster-wrap">Comedy Cellar: ${show.venue}<img class="poster-preview" src="${getCellarPoster(show.venue)}" alt="${show.venue}"></span>` : `<span class="show-name">Comedy Cellar: ${show.venue}</span>`) : '<span class="show-name">Comedy Cellar</span>'}
        <span class="show-venue">${normalizedVenue}</span>
      </div>
      <div class="show-lineup">${comediansHtml}</div>
      <div class="show-footer">
        ${show.reserveUrl
          ? `<span class="reserve-group"><a href="${show.reserveUrl}" target="_blank" class="reserve-btn${soldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${soldOut ? 'Sold Out' : 'Reserve'}</a>${soldOut ? '<span class="standby-note">Standby list opens 1 hr before</span>' : ''}</span>`
          : '<span></span>'}
        ${soldOut ? hideSoldOutToggle(soldOut) : `<span class="fav-count">${stats.faves > 0 ? `${ICON.starFilled} ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''}</span>`}
      </div>
    </div>
  `;
  } catch (e) { console.error('renderShowCard error:', e, show); return ''; }
}

// ---- Shared comedian chip renderer ----
// venueSource: 'cellar', 'stand', 'gotham', 'nycc', 'big' — used for bio priority
function renderComedianChips(comedians, hideSkips, venueSource) {
  const showPhotos = document.getElementById('show-photos')?.checked ?? true;
  const expandBios = document.getElementById('expand-bios')?.checked;
  const expandLongBios = document.getElementById('expand-long-bios')?.checked;
  const noPhotoFilter = document.getElementById('no-photo-filter')?.checked;

  return comedians.map(name => {
    const favd = isFav(name);
    const skipped = isSkip(name);
    const liked = isLike(name);
    let cls = 'comedian';
    if (activeComedianFilter && name.toLowerCase() === activeComedianFilter.toLowerCase()) cls += ' filter-highlight';
    let prefix = '';

    if (favd) {
      cls += ' fav';
      prefix = `<span class="star">${ICON.starFilled}</span>`;
    } else if (liked) {
      // Legacy likes treated as faves
      cls += ' fav';
      prefix = `<span class="star">${ICON.starFilled}</span>`;
    } else if (skipped) {
      cls += ' skip';
      if (hideSkips) cls += ' hidden-skip';
    } else {
      cls += ' new-face';
    }

    const photoUrl = getPhotoForVenue(name, venueSource || 'cellar');
    const hasPhoto = !!photoUrl;
    // No-photo filter: hide comedians that have photos, highlight those without
    if (noPhotoFilter && hasPhoto) return '';
    if (noPhotoFilter && !hasPhoto) cls += ' no-photo-highlight';
    const photoHtml = (showPhotos && photoUrl)
      ? `<img class="comedian-photo" src="${photoUrl}" alt="" loading="lazy">`
      : '';
    // Get venue-aware bio
    const tagline = getBioForVenue(name, venueSource || 'cellar');
    const titleAttr = tagline ? ` title="${tagline.replace(/"/g, '&quot;')}"` : '';

    // Long bios: show full bio panel inline for every comedian
    if (expandLongBios && !window.V2_MODE && !window.V3_MODE) {
      if (!tagline) {
        return `<div class="comedian-long-wrap" onclick="handleComedianClick(this)" data-name="${name.replace(/"/g, '&quot;')}">
          <span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}">${photoHtml}${name}${prefix}</span>
        </div>`;
      }
      return `<div class="comedian-long-wrap" onclick="handleComedianClick(this)" data-name="${name.replace(/"/g, '&quot;')}">
        <span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}">${photoHtml}${name}${prefix}</span>
        <div class="comedian-long-bio">${tagline}</div>
      </div>`;
    }

    // Short bios: show tagline below name
    if (expandBios && !window.V2_MODE && !window.V3_MODE) {
      const taglineHtml = tagline ? `<span class="comedian-tagline-inline">${tagline}</span>` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}<span class="comedian-name-wrap">${name}${prefix}${taglineHtml}</span></span>`;
    }

    // v2 card mode: show tagline text below name
    if (window.V2_MODE) {
      const taglineHtml = tagline ? `<span class="comedian-tagline">${tagline}</span>` : '';
      return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}" onclick="handleComedianClick(this)">${photoHtml}<span class="comedian-name">${name}</span>${prefix}${taglineHtml}</span>`;
    }

    return `<span class="${cls}" data-name="${name.replace(/"/g, '&quot;')}"${titleAttr} onclick="handleComedianClick(this)">${photoHtml}${name}${prefix}</span>`;
  }).join('');
}

function renderSortedByFaves(container) {
  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves')?.checked;

  // Collect all shows from all days with their date
  let allShows = [];
  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    if (!shows) return;
    shows.forEach(show => {
      if (isShowPast(dateStr, show.time)) return;
      if (activeVenue !== 'all' && normalizeVenue(show.venue) !== activeVenue) return;
      const stats = scoreShow(show);
      if (onlyFavs && stats.faves === 0 && stats.likes === 0) return;
      // Hide entire show if any comedian is a skip
      if (hideSkips && stats.skips > 0) return;
      const timeFilter = document.getElementById('time-filter')?.value;
      const timeFilterMin2 = window._timeFilterMin;
      const showTime24_sf = to24h(show.time);
      if (timeFilter && timeFilter !== 'any' && showTime24_sf && showTime24_sf > timeFilter) return;
      if (timeFilterMin2 && showTime24_sf && showTime24_sf < timeFilterMin2) return;
      const soldOut = isShowSoldOut(dateStr, show.time);
      if (soldOut && document.getElementById('hide-sold-out')?.checked) return;
      allShows.push({ ...show, dateStr, dateObj: d, faves: stats.faves, score: stats.score, stats, soldOut });
    });
  });

  // Sort by weighted score (faves*2 - skips), then by fave count, then chronologically
  allShows.sort((a, b) => b.score - a.score || b.faves - a.faves || a.dateStr.localeCompare(b.dateStr) || (a.time || '').localeCompare(b.time || ''));

  if (allShows.length === 0) {
    container.innerHTML = '<div class="no-shows">No shows match your filters.</div>';
    renderBottomTabs();
    return;
  }

  let lastDateStr = '';
  let html = '<div class="schedule-view">';

  allShows.forEach(show => {
    try {
    const stats = show.stats;
    const dayLabel = show.dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (show.dateStr !== lastDateStr) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      lastDateStr = show.dateStr;
    }

    const soldOut = show.soldOut;
    const cardClass = (stats.faves >= 3 ? 'show-card must-go' : 'show-card') + (soldOut ? ' sold-out' : '');
    let badge = '';
    if (stats.faves >= 3) badge += `<span class="show-badge badge-must-go">${stats.faves} FAVES</span>`;
    else if (stats.faves >= 2) badge += `<span class="show-badge badge-faves">${stats.faves} FAVES</span>`;
    if (stats.likes > 0) badge += ` <span class="show-badge badge-likes">${stats.likes} LIKE${stats.likes > 1 ? 'S' : ''}</span>`;

    const normalizedVenue = normalizeVenue(show.venue);
    const venueStart = show.venue.toLowerCase();
    const isPlainVenue = venueStart.startsWith('macdougal') || venueStart.startsWith('fat black') || venueStart.startsWith('village');
    const chips = renderComedianChips(show.comedians, hideSkips, 'cellar');

    html += `
      <div class="${cardClass}" data-venue-source="cellar">
        <div class="show-header">
          <div><span class="show-time">${formatTime(show.time)}</span>${badge}</div>
          ${!isPlainVenue ? (getCellarPoster(show.venue) ? `<span class="show-name poster-wrap">Comedy Cellar: ${show.venue}<img class="poster-preview" src="${getCellarPoster(show.venue)}" alt="${show.venue}"></span>` : `<span class="show-name">Comedy Cellar: ${show.venue}</span>`) : '<span class="show-name">Comedy Cellar</span>'}
          <span class="show-venue">${normalizedVenue}</span>
        </div>
        <div class="show-lineup">${chips}</div>
        <div class="show-footer">
          ${show.reserveUrl ? `<span class="reserve-group"><a href="${show.reserveUrl}" target="_blank" class="reserve-btn${soldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${soldOut ? 'Sold Out' : 'Reserve'}</a>${soldOut ? '<span class="standby-note">Standby list opens 1 hr before</span>' : ''}</span>` : '<span></span>'}
          ${soldOut ? hideSoldOutToggle(soldOut) : `<span class="fav-count">${stats.faves > 0 ? `${ICON.starFilled} ${stats.faves} fave${stats.faves > 1 ? 's' : ''}` : ''} ${stats.likes > 0 ? `${ICON.thumbsUp} ${stats.likes}` : ''}</span>`}
        </div>
      </div>`;
    } catch (e) { console.error('renderSortedByFaves card error:', e, show); }
  });

  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();
}


function renderAllDaysSchedule(container) {
  const hideSkips = document.getElementById('hide-skips').checked;
  const onlyFavs = document.getElementById('only-faves')?.checked;
  const sortVal2 = document.getElementById('sort-select')?.value || 'none';
  const shouldSort = sortVal2 === 'faves';
  // Show onboarding if no prefs
  const prefs2 = loadPrefs();
  const hasAnyPrefs2 = prefs2.faves.length > 0 || prefs2.skips.length > 0 || prefs2.likes.length > 0;
  let html = '';
  // Onboarding banner — commented out for now (revisit later)
  // if (!hasAnyPrefs2 && !localStorage.getItem('onboard-dismissed')) {
  //   html += `
  //     <div class="onboard-banner" id="onboard-banner">
  //       <p><strong>New here?</strong> Turn on "Ratings mode" to tap comedian names and mark favorites or skips. Or use "My Comedians" to set them all at once.</p>
  //       <button class="onboard-btn" onclick="openModal()">Set Up</button>
  //       <button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button>
  //     </div>
  //   `;
  // }
  html += '<div class="schedule-view">';

  // For The Stand, iterate over stand show dates
  if (activeSource === 'the-stand') {
    const timeFilterStand = document.getElementById('time-filter')?.value;
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      let dayShows = standShows.filter(s => s.date === dateStr && !isShowPast(dateStr, s.time));
      if (activeStandRoom !== 'all') {
        dayShows = dayShows.filter(s => {
          return cleanStandRoom(s.room) === activeStandRoom;
        });
      }
      if (timeFilterStand && timeFilterStand !== 'any') {
        dayShows = dayShows.filter(s => {
          const t24 = to24h(s.time);
          return !t24 || t24 <= timeFilterStand;
        });
      }
      const tfMinStand = window._timeFilterMin;
      if (tfMinStand) {
        dayShows = dayShows.filter(s => { const t24 = to24h(s.time); return !t24 || t24 >= tfMinStand; });
      }
      // Filter sold-out shows if hidden
      const hideSoldOutStand = document.getElementById('hide-sold-out')?.checked;
      if (hideSoldOutStand) {
        dayShows = dayShows.filter(s => !isShowSoldOut(s.date, s.time));
      }
      if (dayShows.length === 0) return;
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      dayShows.forEach(show => {
        try { html += renderStandShowCard(show); } catch (e) { console.error('renderAllDaysSchedule Stand card error:', e, show); }
      });
    });
    html += '</div>';
    container.innerHTML = html;
    return;
  }

  const timeFilterCellar = document.getElementById('time-filter')?.value;

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    // Calendar multi-select: skip days not in selection
    if (activeDate === 'calendar' && !calendarSelectedDates.has(dateStr)) return;
    const shows = allData[dateStr];
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    if (!shows || shows.length === 0) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      const dow = d.getDay();
      let hint = '';
      if (dow >= 1 && dow <= 4) hint = 'Weekday lineups usually drop the day before.';
      else hint = 'Weekend lineups usually post Thursday.';
      html += `<div class="no-shows" style="padding:16px 0;">No lineup posted.${hint ? `<br><span style="font-size:12px;color:var(--text-dim)">${hint}</span>` : ''}</div>`;
      return;
    }

    let sorted = shows;
    if (shouldSort) sorted = [...shows].sort((a, b) => scoreShow(b).score - scoreShow(a).score || scoreShow(b).faves - scoreShow(a).faves);

    let dayHtml = '';
    sorted.forEach(show => {
      try {
        const card = renderShowCard(show, document.getElementById('hide-skips').checked, onlyFavs, dateStr);
        if (card) dayHtml += card;
      } catch (e) { console.error('renderAllDaysSchedule Cellar card error:', e, show); }
    });
    // Only render day header if there are visible shows
    if (dayHtml) {
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      html += dayHtml;
    }
  });

  html += '</div>';
  container.innerHTML = html;
}

// ---- Stand room helpers ----
function cleanStandRoom(room) {
  if (!room) return 'Main room';
  let r = room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '').trim();
  // Discard street addresses (e.g. "407 W 15th St") — these are venue addresses, not rooms
  if (/^\d+\s/.test(r)) return 'Main room';
  return r || 'Main room';
}

// ---- Stand room filter ----
function renderStandRoomFilters() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'the-stand') return;

  // Get unique rooms from Stand shows
  const rooms = [...new Set(standShows.map(s => cleanStandRoom(s.room)))].sort();

  const allRooms = ['all', ...rooms];
  container.innerHTML = allRooms.map(r => {
    const label = r === 'all' ? 'All Rooms' : r;
    const cls = r === activeStandRoom ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setStandRoom('${r.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function setStandRoom(r) {
  activeStandRoom = r;
  updateResetBtn();
  renderShows();
}

// ---- The Stand Renderer ----
function renderTheStandShows(container) {
  const pictureMode = document.getElementById('picture-mode')?.checked;
  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  // Show Stand room filters
  renderStandRoomFilters();

  if (activeDate === 'all') {
    renderAllDaysSchedule(container);
    return;
  }

  let dayShows = standShows.filter(s => s.date === activeDate);
  if (activeStandRoom !== 'all') {
    dayShows = dayShows.filter(s => {
      const r = s.room ? s.room.replace('&nbsp;', ' ').replace(/^The Stand\s*[-–—]\s*/i, '').trim() : 'Main';
      return r === activeStandRoom;
    });
  }
  if (dayShows.length === 0) {
    container.innerHTML = '<div class="no-shows">No shows for this day.</div>';
    return;
  }

  container.innerHTML = dayShows.map(show => renderStandShowCard(show)).join('');
}

function renderStandShowCard(show) {
  try {
  // Comedian filter
  if (activeComedianFilter && !show.comedians.some(c => c.toLowerCase() === activeComedianFilter.toLowerCase())) return '';

  const soldOut = !!show.soldout;
  if (soldOut && document.getElementById('hide-sold-out')?.checked) return '';

  const hideSkipsStand = document.getElementById('hide-skips')?.checked;
  // Hide entire show if any comedian is a skip
  if (hideSkipsStand && show.comedians.length > 0 && show.comedians.some(name => isSkip(name))) return '';

  const chips = show.comedians.length > 0
    ? renderComedianChips(show.comedians, hideSkipsStand, 'stand')
    : `<span style="color:var(--text-dim);font-size:13px;">Lineup TBD</span>`;

  // Determine if this is a special/named show vs regular
  let showLabel = 'The Stand';
  if (show.title) {
    const t = show.title.trim();
    const isPresents = /^The Stand Presents?/i.test(t);
    // Check if title is just a comedian's name from the lineup
    const isComedianName = show.comedians.some(c => t.toLowerCase() === c.toLowerCase());
    if (!isPresents && !isComedianName && t.toLowerCase() !== 'the stand') {
      showLabel = 'The Stand: ' + t;
    }
  }

  const shortRoom = cleanStandRoom(show.room);
  const venueText = shortRoom === 'Main' ? 'The Stand' : shortRoom.replace(/\b\w/g, c => c.toUpperCase());

  // Poster hover
  const posterHtml = show.poster
    ? `<span class="show-name poster-wrap">${showLabel}<img class="poster-preview" src="${show.poster}" alt="${showLabel}"></span>`
    : `<span class="show-name">${showLabel}</span>`;

  const cardClass = 'show-card' + (soldOut ? ' sold-out' : '');

  return `
    <div class="${cardClass}" data-venue-source="stand">
      <div class="show-header">
        <div><span class="show-time">${formatTime(show.time)}</span></div>
        ${posterHtml}
        <span class="show-venue">${venueText}</span>
      </div>
      <div class="show-lineup">${chips}</div>
      <div class="show-footer">
        ${show.url ? `<span class="reserve-group"><a href="${show.url}" target="_blank" class="reserve-btn${soldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${soldOut ? 'Sold Out' : 'Tickets'}</a></span>` : '<span></span>'}
        ${soldOut ? hideSoldOutToggle(soldOut) : '<span class="fav-count"></span>'}
      </div>
    </div>
  `;
  } catch (e) { console.error('renderStandShowCard error:', e, show); return ''; }
}

// ---- Gotham Comedy Club Renderer ----
function renderGothamShows(container) {
  container.classList.remove('picture-mode');
  const vf = document.getElementById('venue-filters');
  if (vf) vf.innerHTML = '';

  if (gothamShows.length === 0) {
    container.innerHTML = '<div class="no-shows">Loading Gotham Comedy Club shows...<br><a href="https://gothamcomedyclub.com/events" target="_blank" style="color:var(--accent);font-size:13px;margin-top:8px;display:inline-block;">View on their site →</a></div>';
    return;
  }

  let filtered = activeDate === 'all' || activeDate === 'calendar'
    ? (activeDate === 'calendar' ? gothamShows.filter(s => calendarSelectedDates.has(s.date)) : gothamShows)
    : gothamShows.filter(s => s.date === activeDate);
  filtered = filtered.filter(s => !isShowPast(s.date, s.time));

  let html = '<div class="schedule-view">';
  let lastDate = '';
  filtered.forEach(show => {
    try {
    if (show.date !== lastDate) {
      const d = new Date(show.date + 'T12:00:00');
      html += `<h2 class="schedule-day-header">${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h2>`;
      lastDate = show.date;
    }
    html += `
      <div class="show-card">
        <div class="show-header">
          <div><span class="show-time">${formatTime(show.time)}</span></div>
          <span class="show-name">${show.title}</span>
          <span class="show-venue">Gotham${show.price ? ` · $${show.price}` : ''}</span>
        </div>
        ${show.description ? `<div style="padding:8px 16px;font-size:12px;color:var(--text-dim);">${show.description}</div>` : ''}
        <div class="show-footer">
          ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Tickets</a>` : '<span></span>'}
          <span class="fav-count"></span>
        </div>
      </div>`;
    } catch (e) { console.error('renderGothamShows card error:', e, show); }
  });
  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();
}

// ---- Big Shows (SeatGeek) Renderer ----
// ---- All Venues combined view ----
function renderAllVenues(container) {
  const hideSkips = document.getElementById('hide-skips')?.checked;
  const pictureMode = document.getElementById('picture-mode')?.checked;
  if (pictureMode) container.classList.add('picture-mode');
  else container.classList.remove('picture-mode');

  renderAllVenuesSourceFilter();

  // Show onboarding if no prefs
  const prefsAV = loadPrefs();
  const hasPrefsAV = prefsAV.faves.length > 0 || prefsAV.skips.length > 0 || prefsAV.likes.length > 0;

  // Collect ALL shows into one list with date + sort key
  let allItems = [];

  // Cellar shows
  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    if (activeDate === 'calendar' && !calendarSelectedDates.has(dateStr)) return;
    const shows = allData[dateStr];
    if (!shows) return;
    shows.forEach(show => {
      const time24 = to24h(show.time) || '00:00';
      allItems.push({ type: 'cellar', dateStr, time24, show });
    });
  });

  // Stand shows
  standShows.forEach(show => {
    const time24 = to24h(show.time) || '00:00';
    allItems.push({ type: 'stand', dateStr: show.date, time24, show });
  });

  // Gotham shows
  gothamShows.forEach(show => {
    const time24 = to24h(show.time) || '00:00';
    allItems.push({ type: 'gotham', dateStr: show.date, time24, show });
  });

  // Big Shows
  bigShows.forEach(evt => {
    const time24 = to24h(evt.time) || '00:00';
    allItems.push({ type: 'big', dateStr: evt.date, time24, show: evt });
  });

  // Filter by selected date if not "all"
  if (activeDate === 'calendar') {
    allItems = allItems.filter(item => calendarSelectedDates.has(item.dateStr));
  } else if (activeDate && activeDate !== 'all') {
    allItems = allItems.filter(item => item.dateStr === activeDate);
  }

  // Filter by neighborhood if not "all"
  if (activeNeighborhood !== 'all') {
    allItems = allItems.filter(item => getNeighborhood(item) === activeNeighborhood);
  }

  // Time filter
  const timeFilterAV = document.getElementById('time-filter')?.value;
  if (timeFilterAV && timeFilterAV !== 'any') {
    allItems = allItems.filter(item => !item.time24 || item.time24 <= timeFilterAV);
  }
  const tfMinAV = window._timeFilterMin;
  if (tfMinAV) {
    allItems = allItems.filter(item => !item.time24 || item.time24 >= tfMinAV);
  }

  // Comedian filter
  if (activeComedianFilter) {
    const filterLower = activeComedianFilter.toLowerCase();
    allItems = allItems.filter(item => {
      const comedians = item.show.comedians || [];
      if (comedians.some(c => c.toLowerCase() === filterLower)) return true;
      // Big Shows: check performers field
      if (item.show.performers && item.show.performers.toLowerCase().includes(filterLower)) return true;
      return false;
    });
  }

  // Hide past shows (2+ hours ago)
  allItems = allItems.filter(item => !isShowPast(item.dateStr, item.show.time));

  // Hide sold-out shows if toggle is checked
  if (document.getElementById('hide-sold-out')?.checked) {
    allItems = allItems.filter(item => {
      if (item.type === 'cellar') return !isShowSoldOut(item.dateStr, item.show.time);
      return !item.show.soldout;
    });
  }

  // Sort — by faves if dropdown selected, otherwise by date+time
  const sortValAV = document.getElementById('sort-select')?.value || 'none';
  if (sortValAV === 'faves') {
    // Score each item by fave count
    allItems.forEach(item => {
      const comedians = item.show.comedians || [];
      let faves = 0, skips = 0;
      for (const name of comedians) {
        if (isFav(name) || isLike(name)) faves++;
        else if (isSkip(name)) skips++;
      }
      item.faveCount = faves;
      item.score = (faves * 2) - skips;
    });
    allItems.sort((a, b) => b.score - a.score || b.faveCount - a.faveCount || a.dateStr.localeCompare(b.dateStr) || a.time24.localeCompare(b.time24));
  } else {
    allItems.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.time24.localeCompare(b.time24));
  }

  let html = '';
  // Onboarding banner — commented out for now (revisit later)
  // if (!hasPrefsAV && !localStorage.getItem('onboard-dismissed')) {
  //   html += `<div class="onboard-banner"><p><strong>New here?</strong> Turn on "Ratings mode" to tap comedian names and mark favorites or skips. Or use "My Comedians" to set them all at once.</p><button class="onboard-btn" onclick="openModal()">Set Up</button><button class="onboard-dismiss" onclick="this.parentElement.remove(); localStorage.setItem('onboard-dismissed','1');">&times;</button></div>`;
  // }
  html += '<div class="schedule-view">';
  let lastDate = '';

  allItems.forEach(item => {
    try {
    if (item.dateStr !== lastDate) {
      const d = new Date(item.dateStr + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      html += `<h2 class="schedule-day-header">${dayLabel}</h2>`;
      lastDate = item.dateStr;
    }

    if (item.type === 'cellar') {
      html += renderShowCard(item.show, hideSkips, false, item.dateStr);
    } else if (item.type === 'stand') {
      html += renderStandShowCard(item.show);
    } else if (item.type === 'gotham') {
      const show = item.show;
      html += `
        <div class="show-card">
          <div class="show-header">
            <div><span class="show-time">${formatTime(show.time)}</span></div>
            <span class="show-name">${show.title}</span>
            <span class="show-venue">Gotham</span>
          </div>
          <div class="show-footer">
            ${show.url ? `<a href="${show.url}" target="_blank" class="reserve-btn" onclick="trackReserve(this)">Tickets</a>` : '<span></span>'}
            <span class="fav-count"></span>
          </div>
        </div>`;
    } else {
      const evt = item.show;
      const evtSoldOut = !!evt.soldout;
      if (evtSoldOut && document.getElementById('hide-sold-out')?.checked) return;
      // Build performer list for comedian chips — use performers string or fall back to title
      const evtPerformers = evt.performers
        ? evt.performers.split(',').map(p => p.split(' - ')[0].trim()).filter(Boolean)
        : [evt.title];
      // Seed performerImages into comedianPhotos so renderComedianChips can find them
      if (evt.performerImages) {
        Object.entries(evt.performerImages).forEach(([name, url]) => {
          if (!comedianPhotos[name]) comedianPhotos[name] = url;
        });
      }
      const hideSkipsBig = document.getElementById('hide-skips')?.checked;
      const evtChips = renderComedianChips(evtPerformers, hideSkipsBig, 'big');
      const cardClass = 'show-card' + (evtSoldOut ? ' sold-out' : '');
      const links = evt.ticketLinks || (evt.url ? [{ source: evt.source || 'tickets', url: evt.url }] : []);
      const preferred = links.find(l => l.source === 'seatgeek') || links[0];
      const ticketUrl = preferred?.url || evt.url;
      html += `
        <div class="${cardClass}" data-venue-source="big">
          <div class="show-header">
            <div><span class="show-time">${formatTime(evt.time)}</span></div>
            <span class="show-name">${evt.title}</span>
            <span class="show-venue">${cleanVenueName(evt.venue) || ''}</span>
          </div>
          <div class="show-lineup">${evtChips}</div>
          <div class="show-footer">
            ${ticketUrl ? `<a href="${ticketUrl}" target="_blank" class="reserve-btn${evtSoldOut ? ' sold-out-btn' : ''}" onclick="trackReserve(this)">${evtSoldOut ? 'Sold Out' : 'Tickets'}</a>` : '<span></span>'}
            ${evtSoldOut ? hideSoldOutToggle(evtSoldOut) : '<span class="fav-count"></span>'}
          </div>
        </div>`;
    }
    } catch (e) { console.error('renderAllVenues card error:', e, item); }
  });

  html += '</div>';
  container.innerHTML = html;
}

function getNeighborhood(item) {
  if (item.type === 'cellar' || item.type === 'stand') return 'downtown';
  if (item.type === 'gotham') return 'midtown';
  const venue = (item.show.venue || '').toLowerCase();
  if (venue.includes('beacon') || venue.includes('apollo')) return 'uptown';
  if (venue.includes('gramercy theatre') || venue.includes('irving plaza')) return 'downtown';
  if (venue.includes('ny comedy club') || venue.includes('new york comedy club')) return 'downtown';
  // Default: Big Shows Midtown (MSG, Radio City, Town Hall, Sony Hall, City Winery, Gotham)
  return 'midtown';
}

function renderAllVenuesSourceFilter() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'all') { container.innerHTML = ''; return; }
  const opts = [
    { key: 'all', label: 'All' },
    { key: 'downtown', label: 'Downtown' },
    { key: 'midtown', label: 'Midtown' },
    { key: 'uptown', label: 'Uptown' },
  ];
  container.innerHTML = opts.map(o => {
    const cls = o.key === activeNeighborhood ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setNeighborhood('${o.key}')">${o.label}</button>`;
  }).join('');
}

function setNeighborhood(nb) {
  activeNeighborhood = nb;
  updateResetBtn();
  renderShows();
}

let activeBigVenue = 'all';

function renderBigShowVenueFilters() {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'big-shows') return;
  const venueSet = [...bigShows.map(e => cleanVenueName(e.venue)), ...gothamShows.map(() => 'Gotham Comedy Club')].filter(Boolean);
  const venueCounts = {};
  venueSet.forEach(v => { venueCounts[v] = (venueCounts[v] || 0) + 1; });
  const venues = [...new Set(venueSet)].sort((a, b) => venueCounts[b] - venueCounts[a] || a.localeCompare(b));
  const allVenues = ['all', ...venues];
  container.innerHTML = allVenues.map(v => {
    const label = v === 'all' ? 'All Venues' : v;
    const cls = v === activeBigVenue ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setBigVenue('${v.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function setBigVenue(v) {
  activeBigVenue = v;
  updateResetBtn();
  renderShows();
}

function renderBigShows(container) {
  container.classList.remove('picture-mode');
  renderBigShowVenueFilters();

  if (bigShows.length === 0) {
    container.innerHTML = '<div class="no-shows">Loading big shows...</div>';
    return;
  }

  // Filter by selected date and venue
  let filtered = activeDate === 'all' || activeDate === 'calendar'
    ? (activeDate === 'calendar' ? bigShows.filter(e => calendarSelectedDates.has(e.date)) : bigShows)
    : bigShows.filter(e => e.date === activeDate);
  if (activeBigVenue !== 'all') {
    filtered = filtered.filter(e => cleanVenueName(e.venue) === activeBigVenue);
  }
  filtered = filtered.filter(e => !isShowPast(e.date, e.time));

  // Store SeatGeek performer images in global map
  filtered.forEach(evt => {
    if (evt.performerImages) {
      Object.entries(evt.performerImages).forEach(([name, url]) => {
        if (!comedianPhotos[name]) comedianPhotos[name] = url;
      });
    }
  });

  // Clean venue names before grouping
  filtered.forEach(evt => { evt.venue = cleanVenueName(evt.venue); });

  // Group by primary performer name — handles tour name variations, rescheduled suffixes, age tags
  const byPerformer = {};
  filtered.forEach(evt => {
    // Use first performer name as grouping key (strips tour names, "- Full Name" suffixes, etc.)
    const firstPerformer = (evt.performers || '').split(',')[0].trim().split(' - ')[0].trim();
    const cleanTitle = (evt.title || 'Unknown').replace(/\s*\(Rescheduled.*?\)/i, '').replace(/\s*\(Postponed.*?\)/i, '').replace(/\s*\(\d+\+\)/i, '').trim();
    let key = (firstPerformer || cleanTitle).toLowerCase();
    // Fuzzy merge: if no performer and title-based key doesn't match an existing group,
    // check if an existing group's performer words match the start of this title
    // Handles spelling variations like SG "Ruslan Bely" vs TM "RUSLAN BELIY STAND UP SHOW"
    if (!firstPerformer && !byPerformer[key]) {
      const titleWords = key.replace(/[^a-z\s]/g, '').trim().split(/\s+/);
      for (const [existingKey, existingData] of Object.entries(byPerformer)) {
        const perfWords = (existingData.performers || existingKey).toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(w => w.length >= 3);
        if (perfWords.length < 2) continue;
        const titleStart = titleWords.slice(0, perfWords.length + 2);
        const allMatch = perfWords.every(w => titleStart.some(tw => {
          if (tw === w) return true;
          const min = Math.min(tw.length, w.length);
          let shared = 0; for (let i = 0; i < min; i++) { if (tw[i] === w[i]) shared++; }
          return shared >= 3 && shared >= min - 1;
        }));
        if (allMatch) {
          key = existingKey;
          break;
        }
      }
    }
    // Pick best display title: prefer descriptive show names over redundant "Name - Name" patterns
    const titleScore = (t) => {
      const lower = t.toLowerCase();
      // Penalize "Name - Name" redundancy (e.g. "Modi - Modi Rosenfeld")
      if (/ - /.test(t) && lower.includes(firstPerformer.toLowerCase())) return 0;
      // Prefer titles with tour/show names (colon = "Name: Tour Name")
      if (/: /.test(t)) return 3;
      // Prefer titles with "with" (e.g. "Garden of Laughs with Ronny Chieng")
      if (/\bwith\b/i.test(t)) return 2;
      return 1;
    };
    if (!byPerformer[key]) {
      byPerformer[key] = { events: [], venue: evt.venue, performers: evt.performers, performerImages: evt.performerImages, displayTitle: cleanTitle };
    } else if (titleScore(cleanTitle) > titleScore(byPerformer[key].displayTitle)) {
      byPerformer[key].displayTitle = cleanTitle;
    }
    // Merge performerImages from all sources
    if (evt.performerImages) {
      Object.entries(evt.performerImages).forEach(([n, url]) => {
        if (!byPerformer[key].performerImages) byPerformer[key].performerImages = {};
        if (!byPerformer[key].performerImages[n]) byPerformer[key].performerImages[n] = url;
      });
    }
    byPerformer[key].events.push(evt);
  });

  // Sort groups by earliest show date
  const sortedGroups = Object.entries(byPerformer).sort((a, b) => {
    const aMin = a[1].events.reduce((m, e) => e.date < m ? e.date : m, '9999');
    const bMin = b[1].events.reduce((m, e) => e.date < m ? e.date : m, '9999');
    return aMin.localeCompare(bMin);
  });

  let html = '<div class="big-shows-section">';

  sortedGroups.forEach(([groupKey, data]) => {
    try {
    const title = data.displayTitle;
    const firstEvt = data.events[0];
    // Performer photo
    let photoUrl = '';
    if (data.performerImages) {
      // Find first non-bad performer image
      for (const url of Object.values(data.performerImages)) {
        if (url && !isBadPhotoUrl(url)) { photoUrl = url; break; }
      }
    }
    if (!photoUrl) {
      photoUrl = getPhotoForVenue(title, 'cellar') || localPhotoPath(title) || '';
      if (!photoUrl && data.performers) {
        for (const p of data.performers.split(', ')) {
          photoUrl = getPhotoForVenue(p, 'cellar') || localPhotoPath(p) || '';
          if (photoUrl) break;
        }
      }
    }
    const lookupName = data.performers ? data.performers.split(', ')[0] : title;
    if (!photoUrl && photoLookupCache[lookupName] && !isBadPhotoUrl(photoLookupCache[lookupName])) photoUrl = photoLookupCache[lookupName];
    if (!photoUrl && photoLookupCache[title] && !isBadPhotoUrl(photoLookupCache[title])) photoUrl = photoLookupCache[title];
    // Last resort: use event-level image (TM promotional poster)
    if (!photoUrl && data.events) {
      for (const evt of data.events) {
        if (evt.eventImage && !isBadPhotoUrl(evt.eventImage)) { photoUrl = evt.eventImage; break; }
      }
    }
    const needsLookup = !photoUrl;
    const photoId = needsLookup ? `photo-lookup-${title.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const photoHtml = photoUrl
      ? `<img src="${photoUrl}" alt="${title}" class="big-show-photo" onerror="this.style.display='none'">`
      : `<img id="${photoId}" alt="${title}" class="big-show-photo" style="display:none;" onerror="this.style.display='none'" data-lookup-name="${lookupName.replace(/"/g, '&quot;')}" data-lookup-title="${title.replace(/"/g, '&quot;')}">`;

    // Date boxes — sorted by date, deduplicated by date+time (merges SG/TM duplicates)
    // Also drop time-less entries when another entry on the same date has a time
    const hideSoldOut = document.getElementById('hide-sold-out')?.checked;
    const datesWithTime = new Set(data.events.filter(e => e.time).map(e => e.date));
    const seen = new Set();
    const sortedEvents = data.events
      .filter(evt => evt.time || !datesWithTime.has(evt.date))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
      .filter(evt => {
        const key = evt.date + '|' + (evt.time || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const allSoldOut = sortedEvents.length > 0 && sortedEvents.every(evt => evt.soldout);
    if (allSoldOut && hideSoldOut) return;
    // Filter out individual sold-out events when Hide Sold Out is checked
    const visibleEvents = hideSoldOut ? sortedEvents.filter(evt => !evt.soldout) : sortedEvents;
    if (visibleEvents.length === 0) return;
    const dateBoxes = visibleEvents.map(evt => {
      const d = new Date(evt.date + 'T12:00:00');
      const shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const shortDay = d.toLocaleDateString('en-US', { weekday: 'short' });
      const timeStr = evt.time || '';
      const priceStr = evt.price ? `$${evt.price}` : '';
      const evtSoldOut = !!evt.soldout;
      const links = evt.ticketLinks || (evt.url ? [{ source: evt.source || 'tickets', url: evt.url }] : []);

      // Sold out: grey button with white text, no links
      if (evtSoldOut) {
        return `<div class="bdb-wrap"><span class="big-date-box sold-out"><span class="bdb-day">${shortDay} ${shortDate}</span><span class="bdb-time">${timeStr}</span><span class="bdb-sold-out">SOLD OUT</span></span></div>`;
      }

      const dateContent = `<span class="bdb-day">${shortDay} ${shortDate}</span><span class="bdb-time">${timeStr}</span>${priceStr ? `<span class="bdb-price">${priceStr}</span>` : ''}`;

      // TODO: Multi-source SG/TM badges — revisit later
      // if (links.length > 1) {
      //   const sourceButtons = links.map(l =>
      //     `<a href="${l.url}" target="_blank" class="bdb-source-link" title="${l.source === 'seatgeek' ? 'SeatGeek' : 'Ticketmaster'}" onclick="trackReserve(this)">${l.source === 'seatgeek' ? 'SG' : 'TM'}</a>`
      //   ).join('');
      //   return `<div class="bdb-wrap"><a href="${links[0].url}" target="_blank" class="big-date-box" onclick="trackReserve(this)">${dateContent}</a><span class="bdb-sources">${sourceButtons}</span></div>`;
      // }

      // Single link per date box (uses first available source)
      const singleUrl = links[0]?.url || evt.url;
      return singleUrl
        ? `<div class="bdb-wrap"><a href="${singleUrl}" target="_blank" class="big-date-box" onclick="trackReserve(this)">${dateContent}</a></div>`
        : `<div class="bdb-wrap"><span class="big-date-box">${dateContent}</span></div>`;
    }).join('');

    html += `
      <div class="big-show-card${allSoldOut ? ' sold-out' : ''}">
        <div class="big-show-info">
          ${photoHtml}
          <div class="big-show-details">
            <div class="big-show-title" onclick="showTitlePopup(this)" title="${title.replace(/"/g, '&quot;')}">${title}</div>
            <div class="big-show-venue">${cleanVenueName(data.venue)}</div>
            <div class="big-date-boxes">${dateBoxes}</div>
          </div>
        </div>
      </div>`;
    } catch (e) { console.error('renderBigShows card error:', e, title); }
  });

  html += '</div>';
  container.innerHTML = html;
  renderBottomTabs();

  // Auto-resolve missing photos via server-side scrape
  container.querySelectorAll('img[data-lookup-name]').forEach(img => {
    const name = img.dataset.lookupName;
    const title = img.dataset.lookupTitle;
    autoResolvePhoto(name, img);
    if (name !== title) autoResolvePhoto(title, img);
  });
}

function renderVenueFilters(shows) {
  const container = document.getElementById('venue-filters');
  if (!container) return;
  if (activeSource !== 'cellar') { container.innerHTML = ''; return; }
  if (!shows || shows.length === 0) { container.innerHTML = ''; return; }

  // Always show the 3 main venues
  const mainVenues = ['all', 'MacDougal Street', 'Village Underground', 'Fat Black Pussycat'];
  container.innerHTML = mainVenues.map(v => {
    const label = v === 'all' ? 'All Venues' : v;
    const cls = v === activeVenue ? 'venue-btn active' : 'venue-btn';
    return `<button class="${cls}" onclick="setVenue('${v.replace(/'/g, "\\'")}')">${label}</button>`;
  }).join('');
}

function setVenue(v) {
  activeVenue = v;
  updateResetBtn();
  renderShows();
}

function renderBottomTabs() {

  let nav = document.getElementById('bottom-tabs');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'bottom-tabs';
    nav.className = 'day-tabs bottom-tabs';
    document.querySelector('.shows-container').after(nav);
  }
  nav.innerHTML = '';
  // Full Schedule first
  const allTab = document.createElement('button');
  allTab.className = 'day-tab' + (activeDate === 'all' ? ' active' : '');
  allTab.innerHTML = `<span class="tab-day">Full</span><span class="tab-date">Schedule</span>`;
  allTab.addEventListener('click', () => {
    activeDate = 'all';
    renderTabs();
    renderShows();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  nav.appendChild(allTab);

  if (activeSource === 'the-stand') {
    const standDates = [...new Set(standShows.map(s => s.date))].sort();
    standDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `
        <span class="tab-day">${getDayName(d)}</span>
        <span class="tab-date">${getDateLabel(d)}</span>
      `;
      tab.addEventListener('click', () => {
        activeDate = dateStr;
        renderTabs();
        renderShows();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      nav.appendChild(tab);
    });
    return;
  }

  if (activeSource === 'big-shows') {
    const bigDates = [...new Set(bigShows.map(e => e.date))].sort();
    bigDates.forEach(dateStr => {
      const d = new Date(dateStr + 'T12:00:00');
      const tab = document.createElement('button');
      tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '');
      tab.innerHTML = `<span class="tab-day">${getDayName(d)}</span><span class="tab-date">${getDateLabel(d)}</span>`;
      tab.addEventListener('click', () => { activeDate = dateStr; renderTabs(); renderShows(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      nav.appendChild(tab);
    });
    return;
  }

  dates.forEach(d => {
    const dateStr = formatDateParam(d);
    const shows = allData[dateStr];
    const hasCellar = shows && shows.length > 0;
    let noLineup;
    if (activeSource === 'all') {
      noLineup = !hasCellar && !standShows.some(s => s.date === dateStr) && !nyccShows.some(s => s.date === dateStr) && !gothamShows.some(s => s.date === dateStr) && !bigShows.some(e => e.date === dateStr);
    } else {
      noLineup = !hasCellar;
    }
    const tab = document.createElement('button');
    tab.className = 'day-tab' + (dateStr === activeDate ? ' active' : '') + (noLineup ? ' no-lineup' : '');
    tab.innerHTML = `
      <span class="tab-day">${getDayName(d)}</span>
      <span class="tab-date">${getDateLabel(d)}</span>
    `;
    tab.addEventListener('click', () => {
      activeDate = dateStr;
      renderTabs();
      renderShows();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    nav.appendChild(tab);
  });
}

// Click a comedian chip
function handleComedianClick(el) {
  // Find the comedian element (might have clicked a child)
  const comedianEl = el.dataset.name ? el : el.closest('[data-name]');
  if (!comedianEl) return;
  const name = comedianEl.dataset.name;
  const quickMode = document.getElementById('quick-mode')?.checked;

  // Quick fav/skip mode: cycle
  if (quickMode) {
    cycleComedian(name);
    renderTabs();
    renderShows();
    return;
  }

  // Default: expand bio panel
  const container = el.closest('.show-lineup') || el.parentElement;
  const existing = container.querySelector(`.comedian-expanded[data-for="${name}"]`);

  if (existing) {
    existing.remove();
    return;
  }
  container.querySelectorAll('.comedian-expanded').forEach(e => e.remove());

  // Determine venue source from show card context
  const showCard = el.closest('.show-card');
  let panelVenueSource = 'cellar'; // default
  // Check data attribute first (most reliable)
  if (showCard?.dataset?.venueSource) {
    panelVenueSource = showCard.dataset.venueSource;
  } else if (activeSource === 'the-stand') {
    panelVenueSource = 'stand';
  } else if (activeSource === 'all' && showCard) {
    const venueEl = showCard.querySelector('.show-venue');
    const showNameEl = showCard.querySelector('.show-name');
    const venueText = venueEl?.textContent?.toLowerCase() || '';
    const showName = showNameEl?.textContent?.toLowerCase() || '';
    if (venueText.includes('stand') || showName.includes('stand')) panelVenueSource = 'stand';
    else if (venueText.includes('gotham')) panelVenueSource = 'gotham';
    else if (venueText.includes('comedy club')) panelVenueSource = 'nycc';
  }

  const fullBio = getBioForVenue(name, panelVenueSource);
  const photo = getPhotoForVenue(name, panelVenueSource);
  const prefs = loadPrefs();
  const isFavd = prefs.faves.includes(name);
  const isSkipd = prefs.skips.includes(name);
  const isLiked = prefs.likes.includes(name);
  const isNeutral = !isFavd && !isSkipd && !isLiked;
  const esc = name.replace(/'/g, "\\'");
  const alerted = isAlerted(name);

  const dbEntry = comedianDB.find(c => c.name === name);
  const dbPhoto = photo; // already venue-aware via getPhotoForVenue
  // Format venue names: exclude current source AND only show venues we actively have data for
  const venueNameMap = {
    'the_stand': 'The Stand',
    'comedy_cellar': 'Comedy Cellar',
    'nycc': 'NY Comedy Club',
    'ny_comedy_club': 'NY Comedy Club',
  };
  // Only show "Also at" if comedian has a live upcoming show at that venue
  const standComedianNames = new Set();
  standShows.forEach(show => show.comedians.forEach(n => standComedianNames.add(n)));
  const cellarComedianNames = new Set();
  Object.values(allData).forEach(dayShows => { if (dayShows) dayShows.forEach(show => show.comedians.forEach(n => cellarComedianNames.add(n))); });
  const liveVenueCheck = {
    'comedy_cellar': (n) => cellarComedianNames.has(n),
    'the_stand': (n) => standComedianNames.has(n),
  };
  // Exclude the venue the user is currently browsing — no "Also at: Comedy Cellar" on the Cellar tab
  const excludeVenues = new Set();
  if (activeSource === 'cellar') excludeVenues.add('comedy_cellar');
  else if (activeSource === 'the-stand') excludeVenues.add('the_stand');
  else if (activeSource === 'all') {
    // In "All Venues" mode, exclude any venue the comedian actually appears in
    if (cellarComedianNames.has(name)) excludeVenues.add('comedy_cellar');
    if (standComedianNames.has(name)) excludeVenues.add('the_stand');
  }
  const venues = dbEntry?.venues
    ?.filter(v => !excludeVenues.has(v) && liveVenueCheck[v]?.(name))
    ?.map(v => venueNameMap[v] || v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    ?.join(', ') || '';

  const panel = document.createElement('div');
  panel.className = 'comedian-expanded open';
  panel.dataset.for = name;
  if (fullBio) panel.dataset.fullBio = fullBio;
  panel.innerHTML = `
    ${dbPhoto ? `<img src="${dbPhoto}" alt="${name}">` : ''}
    <div class="exp-info">
      <div class="exp-name">${name}</div>
      ${fullBio ? (() => {
        const longMode = document.getElementById('expand-long-bios')?.checked;
        const MAX = 300;
        if (longMode || fullBio.length <= MAX) return `<div class="exp-tagline">${fullBio}</div>`;
        const truncated = fullBio.substring(0, MAX).replace(/\s+\S*$/, '') + '...';
        return `<div class="exp-tagline exp-bio-truncated">${truncated} <a href="#" class="bio-more-link" onclick="event.preventDefault();expandBioInPanel(this);" style="color:var(--text-dim);font-weight:500;">more</a></div>`;
      })() : ''}
      ${venues ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Also at: ${venues}</div>` : ''}
      <div class="exp-actions">
        <button class="exp-btn ${isFavd ? 'is-fav' : ''}" onclick="setPref('${esc}','fav')">
          ${isFavd ? `${ICON.starFilled} Favorited` : `${ICON.starOutline} Favorite`}
        </button>
        <button class="exp-btn ${isNeutral ? 'is-neutral' : ''}" onclick="setPref('${esc}','neutral')">
          ${isNeutral ? '● Neutral' : '○ Neutral'}
        </button>
        <button class="exp-btn ${isSkipd ? 'is-skip' : ''}" onclick="setPref('${esc}','skip')">
          ${isSkipd ? `${ICON.x} Skipped` : `${ICON.minus} Skip`}
        </button>
        <button class="exp-btn ${alerted ? 'is-alert' : ''}" onclick="toggleAlertBtn('${esc}', this)">
          ${alerted ? `${ICON.bell} Notifications on` : `${ICON.bellOff} Notify me`}
        </button>
        <button class="exp-btn" onclick="filterByComedian('${esc}')">
          ${ICON.search} Filter shows
        </button>
      </div>
    </div>
  `;
  // Append at end of lineup (before reserve/footer), not after clicked card
  container.appendChild(panel);
}

function expandBioInPanel(link) {
  const panel = link.closest('.comedian-expanded');
  if (!panel) return;
  const tagline = panel.querySelector('.exp-tagline');
  if (tagline && panel.dataset.fullBio) {
    tagline.textContent = panel.dataset.fullBio;
    tagline.classList.remove('exp-bio-truncated');
  }
}

function toggleAlertBtn(name, btn) {
  // Prompt for email on first alert if not set
  if (!isAlerted(name) && !getAlertEmail()) {
    const email = prompt('Enter your email to get notified when this comedian is in an upcoming lineup:');
    if (!email || !email.includes('@')) return;
    setAlertEmail(email.trim());
  }
  toggleAlert(name);
  const alerted = isAlerted(name);
  btn.className = 'exp-btn' + (alerted ? ' is-alert' : '');
  btn.innerHTML = alerted ? `${ICON.bell} Notifications on` : `${ICON.bellOff} Notify me`;
}

// Global filter state for comedian filtering
let activeComedianFilter = null;

function filterByComedian(name) {
  if (activeComedianFilter === name) {
    // Toggle off — clear filter
    activeComedianFilter = null;
  } else {
    activeComedianFilter = name;
  }
  // Collapse expanded panel
  document.querySelectorAll('.expanded-panel').forEach(p => p.remove());
  renderShows();
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setPref(name, type) {
  const prefs = loadPrefs();
  prefs.faves = prefs.faves.filter(n => n !== name);
  prefs.skips = prefs.skips.filter(n => n !== name);
  prefs.likes = prefs.likes.filter(n => n !== name);
  if (type === 'fav') prefs.faves.push(name);
  else if (type === 'like') prefs.likes.push(name);
  else if (type === 'skip') prefs.skips.push(name);
  // 'neutral' = just remove from all (already done above)
  savePrefs(prefs);
  renderTabs();
  renderShows();
}

// ---- Comedian Directory (archive + alert browse) ----
window._dirSearch = window._dirSearch || '';
window._dirOnlyFaves = window._dirOnlyFaves || false;
window._dirOnlyLive = window._dirOnlyLive || false;
window._dirShowCount = window._dirShowCount || 60;

function _dirLiveSet() {
  const live = new Set();
  Object.values(allData).forEach(day => { if (day) day.forEach(s => s.comedians.forEach(n => live.add(n))); });
  standShows.forEach(s => s.comedians.forEach(n => live.add(n)));
  if (typeof gothamShows !== 'undefined') gothamShows.forEach(s => (s.comedians || []).forEach(n => live.add(n)));
  if (typeof bigShows !== 'undefined') bigShows.forEach(e => {
    if (e.title) live.add(e.title.trim());
    if (e.performers) e.performers.split(/,\s*/).forEach(n => { if (n.trim()) live.add(n.trim()); });
  });
  return live;
}

function renderComedianDirectory(container) {
  const prefs = loadPrefs();
  const liveSet = _dirLiveSet();
  const search = (window._dirSearch || '').toLowerCase().trim();
  const onlyFaves = window._dirOnlyFaves;
  const onlyLive = window._dirOnlyLive;

  // Filter
  let list = (comedianDB || []).slice();
  if (search) list = list.filter(c => c.name.toLowerCase().includes(search));
  if (onlyFaves) list = list.filter(c => prefs.faves.includes(c.name));
  if (onlyLive) list = list.filter(c => liveSet.has(c.name));

  // Split deceased into separate section
  const deceasedList = list.filter(c => c.deceased).sort((a, b) => a.name.localeCompare(b.name));
  list = list.filter(c => !c.deceased);

  // Sort: faves first, then live, then alphabetical
  list.sort((a, b) => {
    const af = prefs.faves.includes(a.name) ? 0 : 1;
    const bf = prefs.faves.includes(b.name) ? 0 : 1;
    if (af !== bf) return af - bf;
    const al = liveSet.has(a.name) ? 0 : 1;
    const bl = liveSet.has(b.name) ? 0 : 1;
    if (al !== bl) return al - bl;
    return a.name.localeCompare(b.name);
  });

  const total = list.length + deceasedList.length;
  const livingShown = Math.min(window._dirShowCount, list.length);
  const visible = list.slice(0, livingShown);
  const showRip = !onlyFaves && !onlyLive && deceasedList.length > 0 && livingShown >= list.length;

  const scrollY = window.scrollY;

  container.innerHTML = `
    <div class="comedian-directory">
      <div class="dir-controls">
        <input type="text" id="dir-search" class="dir-search" placeholder="Search ${total} comedians..." value="${(window._dirSearch || '').replace(/"/g, '&quot;')}">
        <div class="dir-toggles">
          <label class="dir-toggle"><input type="checkbox" id="dir-only-faves" ${onlyFaves ? 'checked' : ''}><span>My faves only</span></label>
          <label class="dir-toggle"><input type="checkbox" id="dir-only-live" ${onlyLive ? 'checked' : ''}><span>Booked this week</span></label>
        </div>
        <div class="dir-count">${total === 0 ? 'No comedians match' : `${livingShown === list.length ? total : livingShown + ' of ' + total} comedian${total === 1 ? '' : 's'}`}</div>
      </div>
      <div class="dir-grid">
        ${visible.map(c => _dirCardHTML(c, prefs, liveSet)).join('')}
      </div>
      ${livingShown < list.length ? `<button class="dir-load-more" id="dir-load-more">Show more (${list.length - livingShown} left)</button>` : ''}
      ${showRip ? `
        <div class="dir-rip-section">
          <h3 class="dir-rip-heading">In Memoriam</h3>
          <div class="dir-grid">
            ${deceasedList.map(c => _dirCardHTML(c, prefs, liveSet)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Restore scroll for in-place updates (e.g. after fave toggle)
  if (scrollY > 0) window.scrollTo(0, scrollY);

  // Wire controls
  const searchInput = document.getElementById('dir-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      window._dirSearch = e.target.value;
      window._dirShowCount = 60;
      _dirRerenderDebounced();
    });
    if (document.activeElement !== searchInput && search) {
      // keep focus if user was typing — but only if they're already focused; don't steal focus
    }
  }
  const onlyFavesCb = document.getElementById('dir-only-faves');
  if (onlyFavesCb) onlyFavesCb.addEventListener('change', (e) => {
    window._dirOnlyFaves = e.target.checked;
    window._dirShowCount = 60;
    renderShows();
  });
  const onlyLiveCb = document.getElementById('dir-only-live');
  if (onlyLiveCb) onlyLiveCb.addEventListener('change', (e) => {
    window._dirOnlyLive = e.target.checked;
    window._dirShowCount = 60;
    renderShows();
  });
  const loadMoreBtn = document.getElementById('dir-load-more');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => {
    window._dirShowCount += 60;
    renderShows();
  });
}

let _dirSearchTimer = null;
function _dirRerenderDebounced() {
  clearTimeout(_dirSearchTimer);
  _dirSearchTimer = setTimeout(() => {
    const grid = document.querySelector('.dir-grid');
    const countEl = document.querySelector('.dir-count');
    const loadMore = document.getElementById('dir-load-more');
    if (!grid) { renderShows(); return; }
    const prefs = loadPrefs();
    const liveSet = _dirLiveSet();
    const search = (window._dirSearch || '').toLowerCase().trim();
    let list = (comedianDB || []).slice();
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search));
    if (window._dirOnlyFaves) list = list.filter(c => prefs.faves.includes(c.name));
    if (window._dirOnlyLive) list = list.filter(c => liveSet.has(c.name));
    list = list.filter(c => !c.deceased); // RIP section is static between renders
    list.sort((a, b) => {
      const af = prefs.faves.includes(a.name) ? 0 : 1;
      const bf = prefs.faves.includes(b.name) ? 0 : 1;
      if (af !== bf) return af - bf;
      const al = liveSet.has(a.name) ? 0 : 1;
      const bl = liveSet.has(b.name) ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    });
    const livingShown = Math.min(window._dirShowCount, list.length);
    const visible = list.slice(0, livingShown);
    // Keep this update scoped to the LIVING grid (first .dir-grid). RIP grid is below.
    grid.innerHTML = visible.map(c => _dirCardHTML(c, prefs, liveSet)).join('');
    const deceasedCount = (comedianDB || []).filter(c => c.deceased).length;
    const total = list.length + deceasedCount;
    if (countEl) countEl.textContent = total === 0 ? 'No comedians match' : `${livingShown === list.length ? total : livingShown + ' of ' + total} comedian${total === 1 ? '' : 's'}`;
    if (loadMore) {
      if (livingShown < list.length) {
        loadMore.textContent = `Show more (${list.length - livingShown} left)`;
        loadMore.style.display = '';
      } else {
        loadMore.style.display = 'none';
      }
    }
  }, 120);
}

function _dirCardHTML(c, prefs, liveSet) {
  const name = c.name;
  const esc = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const isFavd = prefs.faves.includes(name);
  const isSkipd = prefs.skips.includes(name);
  const alerted = (typeof isAlerted === 'function') ? isAlerted(name) : false;
  const isLive = liveSet.has(name);
  const isDeceased = !!c.deceased;
  // Photo: prefer prebaked local, then DB venue photos, then Wikipedia thumbnail
  let photo = (typeof getPhotoForVenue === 'function') ? getPhotoForVenue(name, '') : (c.photo_stand || c.photo_nycc || '');
  if (!photo && c.photo_wiki) photo = c.photo_wiki;
  const bio = (typeof getBioForVenue === 'function') ? getBioForVenue(name, '') : (c.bio || c.bio_wiki || '');
  const bioShort = bio ? (bio.length > 140 ? bio.substring(0, 140).replace(/\s+\S*$/, '') + '…' : bio) : '';
  return `
    <div class="dir-card ${isFavd ? 'is-fav' : ''} ${isSkipd ? 'is-skip' : ''} ${isDeceased ? 'deceased' : ''}">
      <div class="dir-card-photo">${photo ? `<img src="${photo}" alt="${name}" loading="lazy" onerror="this.style.display='none'">` : `<div class="dir-photo-placeholder">${ICON.mic}</div>`}</div>
      <div class="dir-card-body">
        <div class="dir-card-name">${name}${isLive ? ' <span class="dir-live-dot" title="Booked in upcoming lineup">●</span>' : ''}</div>
        ${bioShort ? `<div class="dir-card-bio">${bioShort}</div>` : ''}
        ${isDeceased ? '' : `<div class="dir-card-actions">
          <button class="dir-btn ${isFavd ? 'is-fav' : ''}" onclick="setPref('${esc}','${isFavd ? 'neutral' : 'fav'}')" title="${isFavd ? 'Remove favorite' : 'Favorite'}">${isFavd ? ICON.starFilled : ICON.starOutline}</button>
          <button class="dir-btn ${isSkipd ? 'is-skip' : ''}" onclick="setPref('${esc}','${isSkipd ? 'neutral' : 'skip'}')" title="${isSkipd ? 'Un-skip' : 'Skip'}">${isSkipd ? ICON.x : ICON.minus}</button>
          <button class="dir-btn ${alerted ? 'is-alert' : ''}" onclick="toggleAlertBtn('${esc}', this)" title="${alerted ? 'Notifications on' : 'Notify when booked'}">${alerted ? ICON.bell : ICON.bellOff}</button>
        </div>`}
      </div>
    </div>
  `;
}

window.renderComedianDirectory = renderComedianDirectory;

// ---- Modal ----
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  renderModal();
  if (window.va) window.va('event', { name: 'modal_open' });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  showBookmarkToast();
  updateSettingsBtnState();
  updateResetBtn();
  renderTabs();
  renderShows();
}

function renderModal(filter = '') {
  const prefs = loadPrefs();
  const filterLower = filter.toLowerCase();

  // Favs section
  const favList = document.getElementById('fav-list');
  favList.innerHTML = prefs.faves
    .filter(n => n.toLowerCase().includes(filterLower))
    .map(n => `<span class="chip fav-state" onclick="modalCycle('${n.replace(/'/g, "\\'")}')">${n}</span>`)
