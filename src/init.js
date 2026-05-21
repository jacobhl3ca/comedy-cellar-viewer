        show.comedians.forEach(name => allComediansSeen.add(name));
      });
    } else {
      allData[dateStr] = null;
    }
  });

  // Add Stand comedians to the seen list too
  standShows.forEach(show => {
    show.comedians.forEach(name => allComediansSeen.add(name));
  });

  // Add Gotham shows to seen list
  gothamShows.forEach(show => {
    if (show.title) allComediansSeen.add(show.title.trim());
  });

  // Add Big Shows performers to seen list
  bigShows.forEach(evt => {
    if (evt.performers) {
      evt.performers.split(/,\s*/).forEach(n => { if (n.trim()) allComediansSeen.add(n.trim()); });
    }
    if (evt.title) allComediansSeen.add(evt.title.trim());
  });

  // Show warning if any data source failed
  const failedSources = [];
  if (!batchData) failedSources.push('Comedy Cellar');
  if (!standShows.length) failedSources.push('The Stand');
  if (!bigShows.length) failedSources.push('Big Shows');
  if (failedSources.length) {
    const warn = document.createElement('div');
    warn.className = 'data-warning';
    warn.innerHTML = `${ICON.warning} Could not load: ${failedSources.join(', ')}. <button onclick="this.parentElement.remove()">${ICON.x}</button>`;
    document.getElementById('shows-container').prepend(warn);
  }

  document.getElementById('loading').style.display = 'none';
  // Default to big picture mode
  const pmEl = document.getElementById('picture-mode');
  if (pmEl && !pmEl.checked) pmEl.checked = true;
  initTheme();
  initCalendar();
  initSettingsJingle();
  updateSettingsBtnState();
  updateShareBtn();
  renderSourceTabs();
  renderTabs();
  renderShows();
  updateFooterInfo();
  document.getElementById('schedule-filter-area')?.classList.add('ready');

  // Eagerly pull Cellar days 31-60 in the background so the full date window is
  // exposed without a "More days" tab. Non-blocking — first paint is already
  // done; loadMoreDays() re-renders the strip when the extra days arrive.
  loadMoreDays();

  // Open My Comedians modal if #alerts in URL
  if (window.location.hash === '#alerts') {
    openModal();
  }

  // Enrich bios from Wikipedia in background (don't block render)
  enrichBiosFromWikipedia().then(() => {
    // Re-render to show new bios if user has bios toggled on
    if (document.getElementById('expand-bios')?.checked || document.getElementById('expand-long-bios')?.checked) {
      renderShows();
    }
  });

  // Auto-schedule local reminders for favorited comedians' upcoming shows (native only)
  function _collectReminderItems() {
    const items = [];
    Object.entries(allData).forEach(([dateStr, shows]) => {
      (shows || []).forEach(show => {
        items.push({ dateStr, time: show.time, title: show.room || 'Comedy Cellar', venue: 'Comedy Cellar', comedians: show.comedians || [] });
      });
    });
    (standShows || []).forEach(show => {
      if (show.date && show.time) items.push({ dateStr: show.date, time: show.time, title: show.room || 'The Stand', venue: 'The Stand', comedians: show.comedians || [] });
    });
    return items;
  }
  window._rescheduleReminders = function() {
    if (!Native.isNative()) return;
    Native.scheduleReminders(_collectReminderItems());
  };
  window._rescheduleReminders();

  // Venue source tab listeners
  document.querySelectorAll('.venue-source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      Native.selection();
      const prevDate = activeDate;
      // Unselect: clicking active source goes back to All Venues
      const newSource = btn.dataset.source;
      activeSource = (newSource === activeSource && newSource !== 'all') ? 'all' : newSource;
      activeVenue = 'all';
      activeStandRoom = 'all';
      activeNeighborhood = 'all';
      // Keep the selected date across tabs only if the new source actually has
      // shows that day — otherwise reset to Full Schedule so the switch never
      // lands on a blank screen (e.g. Big Shows has nothing on the picked date).
      activeDate = (prevDate && prevDate !== 'all' && dateInActiveSource(prevDate))
        ? prevDate
        : 'all';
      if (window.va) window.va('event', { name: 'tab_switch', data: { source: activeSource } });
      renderSourceTabs();
      renderTabs();
      renderShows();
      updateFooterInfo();
    });
  });

  // Filter listeners
  document.getElementById('hide-skips').addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('only-faves').addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('show-photos')?.addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('time-filter')?.addEventListener('change', () => { updateResetBtn(); renderShows(); });
  document.getElementById('sort-select')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });
  document.getElementById('expand-bios')?.addEventListener('change', (e) => {
    if (e.target.checked) { const lb = document.getElementById('expand-long-bios'); if (lb) lb.checked = false; }
    updateResetBtn(); renderShows();
  });
  document.getElementById('expand-long-bios')?.addEventListener('change', (e) => {
    if (e.target.checked) { const sb = document.getElementById('expand-bios'); if (sb) sb.checked = false; }
    updateResetBtn(); renderShows();
  });
  document.getElementById('bio-mode')?.addEventListener('change', (e) => {
    const sb = document.getElementById('expand-bios');
    const lb = document.getElementById('expand-long-bios');
    if (sb) sb.checked = e.target.value === 'short';
    if (lb) lb.checked = e.target.value === 'long';
    // Show short label after selection
    const sel = e.target;
    sel.options[0].text = 'Bios';
    sel.options[1].text = sel.value === 'short' ? 'Short' : 'Short bios';
    sel.options[2].text = sel.value === 'long' ? 'Long' : 'Long bios';
    updateResetBtn(); renderShows();
  });
  document.getElementById('quick-mode')?.addEventListener('change', (e) => {
    updateResetBtn();
    const hint = document.getElementById('quick-mode-hint');
    if (hint) {
      hint.classList.toggle('visible', e.target.checked);
    }
  });
  document.getElementById('picture-mode')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });
  document.getElementById('no-photo-filter')?.addEventListener('change', () => {
    updateResetBtn(); renderShows();
  });

  // Time range slider drives hidden time-filter select + earliest start
  const timeSteps = ['any', '19:00', '20:00', '21:00', '22:00', '23:00'];
  const timeLabels = ['Any', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'];
  const sliderMin = document.getElementById('time-slider-min');
  const sliderMax = document.getElementById('time-slider-max');
  const rangeValue = document.getElementById('time-range-value');
  const rangeFill = document.getElementById('time-range-fill');
  function updateTimeRange() {
    if (!sliderMin || !sliderMax) return;
    let lo = parseInt(sliderMin.value);
    let hi = parseInt(sliderMax.value);
    if (lo > hi) { sliderMin.value = hi; sliderMax.value = lo; lo = parseInt(sliderMin.value); hi = parseInt(sliderMax.value); }
    // Update fill bar position
    if (rangeFill) {
      const pctL = (lo / 5) * 100;
      const pctR = (hi / 5) * 100;
      rangeFill.style.left = pctL + '%';
      rangeFill.style.width = (pctR - pctL) + '%';
    }
    // Update label
    if (rangeValue) {
      if (lo === 0 && hi === 5) rangeValue.textContent = 'Any';
      else if (lo === 0) rangeValue.textContent = 'Before ' + timeLabels[hi];
      else if (hi === 5) rangeValue.textContent = 'After ' + timeLabels[lo];
      else if (lo === hi) rangeValue.textContent = timeLabels[lo];
      else rangeValue.textContent = timeLabels[lo] + ' – ' + timeLabels[hi];
    }
    // Drive the hidden time-filter (latest/max)
    const tf = document.getElementById('time-filter');
    if (tf) { tf.value = timeSteps[hi]; }
    // Set global earliest start
    window._timeFilterMin = lo === 0 ? null : timeSteps[lo];
    updateResetBtn(); renderShows();
  }
  if (sliderMin) sliderMin.addEventListener('input', updateTimeRange);
  if (sliderMax) sliderMax.addEventListener('input', updateTimeRange);
  // Initialize fill bar
  if (rangeFill) { rangeFill.style.left = '0%'; rangeFill.style.width = '100%'; }

  // Reset filters
  document.getElementById('reset-filters')?.addEventListener('click', () => {
    document.getElementById('hide-skips').checked = false;
    document.getElementById('only-faves').checked = false;
    const ss = document.getElementById('sort-select'); if (ss) ss.value = 'none';
    document.getElementById('expand-bios').checked = false;
    const elb = document.getElementById('expand-long-bios'); if (elb) elb.checked = false;
    const bm = document.getElementById('bio-mode');
    if (bm) { bm.value = 'none'; bm.options[1].text = 'Short bios'; bm.options[2].text = 'Long bios'; }
    document.getElementById('quick-mode').checked = false;
    const pm = document.getElementById('picture-mode'); if (pm) pm.checked = true;
    const npf = document.getElementById('no-photo-filter'); if (npf) npf.checked = false;
    const hso = document.getElementById('hide-sold-out'); if (hso) hso.checked = false;
    const sp = document.getElementById('show-photos'); if (sp) sp.checked = true;
    const tf = document.getElementById('time-filter');
    if (tf) tf.value = 'any';
    const tfv = document.getElementById('time-filter-visible');
    if (tfv) tfv.value = 'any';
    const tsMin = document.getElementById('time-slider-min');
    const tsMax = document.getElementById('time-slider-max');
    if (tsMin) tsMin.value = 0;
    if (tsMax) tsMax.value = 5;
    window._timeFilterMin = null;
    const rv = document.getElementById('time-range-value');
    if (rv) rv.textContent = 'Any';
    const rf = document.getElementById('time-range-fill');
    if (rf) { rf.style.left = '0%'; rf.style.width = '100%'; }
    activeVenue = 'all';
    activeStandRoom = 'all';
    activeBigVenue = 'all';
    activeNeighborhood = 'all';
    activeComedianFilter = null;
    updateResetBtn();
    renderShows();
  });

  // Modal listeners
  document.getElementById('open-settings').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-done').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('comedian-search').addEventListener('input', e => {
    renderModal(e.target.value);
  });
  document.getElementById('save-alert-email')?.addEventListener('click', () => {
    const email = document.getElementById('alert-email')?.value?.trim();
    if (email && email.includes('@')) {
      setAlertEmail(email);
      const btn = document.getElementById('save-alert-email');
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    }
  });
  document.getElementById('reset-prefs').addEventListener('click', () => {
    if (confirm('Reset all favorites and skips?')) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ faves: [], skips: [], likes: [] }));
      history.replaceState(null, '', window.location.pathname);
      document.getElementById('comedian-search').value = '';
      renderModal();
      renderTabs();
      updateSettingsBtnState();
      updateResetBtn();
      updateShareBtn();
    }
  });

  // "Filters" dropdown toggle
  const filtersBtn = document.getElementById('filters-toggle');
  const filtersInline = document.getElementById('filters-inline');
  if (filtersBtn && filtersInline) {
    filtersBtn.addEventListener('click', () => {
      const visible = filtersInline.style.display !== 'none';
      filtersInline.style.display = visible ? 'none' : 'flex';
      filtersBtn.textContent = visible ? 'Filters ▾' : 'Filters ▴';
      filtersBtn.classList.toggle('active', !visible);
      updateResetBtn();
    });
  }

  async function buildShareUrl() {
    // Unified format includes prefs + non-default settings.
    if (typeof window.__tonightNycBuildShareLink === 'function') {
      try { return await window.__tonightNycBuildShareLink(); } catch { /* fall through */ }
    }
    const prefs = loadPrefs();
    try {
      if (typeof CompressionStream !== 'undefined') {
        const compressed = await compressPrefs(prefs);
        return window.location.origin + window.location.pathname + '#p=' + compressed;
      } else {
        throw new Error('no CompressionStream');
      }
    } catch {
      const params = new URLSearchParams();
      if (prefs.faves.length) params.set('f', prefs.faves.join('|'));
      if (prefs.skips.length) params.set('s', prefs.skips.join('|'));
      if (prefs.likes.length) params.set('l', prefs.likes.join('|'));
      return window.location.origin + window.location.pathname + '#' + params.toString();
    }
  }

  async function doShare(sourceBtn, onCopyFeedback) {
    const url = await buildShareUrl();
    const result = await Native.share('My Comedians', url);
    if (result === 'clipboard' || result === 'failed') {
      onCopyFeedback && onCopyFeedback();
    }
  }

  document.getElementById('share-link').addEventListener('click', () => {
    Native.impact('Light');
    doShare(null, () => {
      const btn = document.getElementById('share-link');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Share Link'; }, 2000);
    });
  });

  document.getElementById('import-go')?.addEventListener('click', async () => {
    const input = document.getElementById('import-url');
    const status = document.getElementById('import-status');
    const raw = (input.value || '').trim();
    if (!raw) return;
    const pMatch = raw.match(/[#?&]p=([A-Za-z0-9_-]+)/);
    if (!pMatch) {
      status.textContent = 'Could not find a share code in that link. Make sure the URL contains #p=...';
      status.style.color = 'var(--accent)';
      return;
    }
    try {
      Native.impact('Light');
      const imported = await decompressPrefs(pMatch[1]);
      const current = loadPrefs();
      const merged = {
        faves: [...new Set([...(current.faves || []), ...(imported.faves || [])])],
        skips: [...new Set([...(current.skips || []), ...(imported.skips || [])])],
        likes: [...new Set([...(current.likes || []), ...(imported.likes || [])])]
      };
      savePrefs(merged);
      input.value = '';
      Native.impact('Medium');
      if (typeof renderModal === 'function') renderModal('');
      if (typeof renderShows === 'function') renderShows();
      updateShareBtn();
      status.style.color = 'var(--text-dim)';
      status.textContent = `Imported ${imported.faves.length} faves, ${imported.skips.length} skips, ${imported.likes.length} likes. Merged with what you had.`;
      setTimeout(() => {
        status.textContent = 'Merges favorites & skips from another device’s share link with what you have here.';
      }, 5000);
    } catch (e) {
      console.error('Import failed:', e);
      status.style.color = 'var(--accent)';
      status.textContent = 'Could not import — link may be invalid or corrupted.';
    }
  });

  document.getElementById('header-share').addEventListener('click', () => {
    Native.impact('Light');
    doShare(null, () => {
      const btn = document.getElementById('header-share');
      btn.querySelector('.share-icon-svg').style.display = 'none';
      btn.querySelector('.share-check').style.display = '';
      btn.title = 'Link copied!';
      setTimeout(() => {
        btn.querySelector('.share-icon-svg').style.display = '';
        btn.querySelector('.share-check').style.display = 'none';
        btn.title = 'Copy share link';
      }, 2000);
    });
  });
}

init();

function resetToHome() {
  if (typeof getMode === 'function' && getMode() === 'jazz') {
    if (typeof jazzResetHome === 'function') jazzResetHome();
    return;
  }
  activeSource = 'all';
  activeDate = 'all';
  activeVenue = 'all';
  activeStandRoom = 'all';
  activeBigVenue = 'all';
  activeNeighborhood = 'all';
  activeComedianFilter = null;
  renderSourceTabs();
  renderTabs();
  renderShows();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

(function setupHeaderHome() {
  const go = () => { Native.impact('Light'); resetToHome(); };
  const region = document.getElementById('header-home');
  region.addEventListener('click', go);
  region.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
})();

(function setupPullToRefresh() {
  const indicator = document.getElementById('ptr-indicator');
  // Wrap all body children except the indicator into a #page-wrap div so the pull
  // transform applies to the wrapper, NOT body. This keeps #ptr-indicator (a sibling
  // of the wrapper) viewport-fixed instead of being trapped by body's transform's
  // new containing block. Idempotent — runs once.
  let pageWrap = document.getElementById('page-wrap');
  if (!pageWrap && indicator) {
    pageWrap = document.createElement('div');
    pageWrap.id = 'page-wrap';
    Array.from(document.body.children).forEach(child => {
      if (child !== indicator) pageWrap.appendChild(child);
    });
    document.body.appendChild(pageWrap);
  }
  const THRESHOLD = 70;
  const MAX_PULL = 110;
  let startY = 0;
  let pulling = false;
  let pullingClass = false;
  let pullDistance = 0;
  let refreshing = false;
  let pendingDy = null;
  let rafId = 0;

  function isScrollLocked() {
    // PTR should only fire when the main page is at the top.
    // Block it when any modal/expanded overlay is open OR when the touch happens inside one.
    if (document.querySelector('.modal-overlay:not(.hidden)')) return true;
    return false;
  }

  function applyPull() {
    rafId = 0;
    if (pendingDy === null || !pulling) return;
    if (pendingDy <= 0) {
      pullDistance = 0;
      if (pullingClass) {
        indicator.classList.remove('pulling');
        pageWrap?.classList.remove('ptr-pulling');
        pullingClass = false;
      }
      if (pageWrap) pageWrap.style.transform = '';
      indicator.style.opacity = '';
      return;
    }
    pullDistance = Math.min(pendingDy * 0.55, MAX_PULL);
    if (!pullingClass) {
      indicator.classList.add('pulling');
      pageWrap?.classList.add('ptr-pulling');
      pullingClass = true;
    }
    if (pageWrap) pageWrap.style.transform = `translateY(${pullDistance}px)`;
    indicator.style.opacity = Math.min(pullDistance / 40, 1);
  }

  function resetPull() {
    pulling = false;
    pullDistance = 0;
    pendingDy = null;
    if (pullingClass) {
      indicator.classList.remove('pulling');
      pageWrap?.classList.remove('ptr-pulling');
      pullingClass = false;
    }
    if (pageWrap) pageWrap.style.transform = '';
    if (!refreshing) indicator.style.opacity = '';
  }

  document.addEventListener('touchstart', (e) => {
    if (refreshing) return;
    if (window.scrollY > 0) { pulling = false; return; }
    if (isScrollLocked()) { pulling = false; return; }
    if (e.target.closest('.modal-overlay, .calendar-popup, .expanded-card, .comedian-bio-panel')) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
    pullDistance = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || refreshing) return;
    pendingDy = e.touches[0].clientY - startY;
    if (!rafId) rafId = requestAnimationFrame(applyPull);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling || refreshing) { pulling = false; return; }
    if (pullDistance >= THRESHOLD) {
      refreshing = true;
      pulling = false;
      if (pullingClass) {
        indicator.classList.remove('pulling');
        pageWrap?.classList.remove('ptr-pulling');
        pullingClass = false;
      }
      // Hold the gap open while we refetch
      if (pageWrap) pageWrap.style.transform = `translateY(${THRESHOLD}px)`;
      indicator.classList.add('refreshing');
      indicator.style.opacity = '1';
      Native.impact('Medium');
      // In-place refresh: re-fetch data, preserve tab/date state, snap back.
      refreshShowsInPlace().finally(() => {
        if (pageWrap) pageWrap.style.transform = '';
        indicator.classList.remove('refreshing');
        indicator.style.opacity = '';
        refreshing = false;
      });
    } else {
      resetPull();
    }
  }, { passive: true });

  document.addEventListener('touchcancel', resetPull, { passive: true });
})();

// Block pinch-zoom: Safari ignores user-scalable=no for accessibility, so explicitly
// preventDefault on gesture* events. (touch-action: pan-x pan-y handles double-tap zoom.)
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
  document.addEventListener(ev, (e) => e.preventDefault())
);

// Global poster preview — renders outside card stacking contexts so opacity doesn't trap it
(function() {
  let overlay = null;
  document.addEventListener('mouseover', e => {
    const wrap = e.target.closest('.poster-wrap');
    if (!wrap) return;
    const img = wrap.querySelector('.poster-preview');
    if (!img) return;
    if (overlay) overlay.remove();
    overlay = document.createElement('img');
    overlay.id = 'global-poster-preview';
    overlay.src = img.src;
    overlay.alt = img.alt;
    document.body.appendChild(overlay);
  });
  document.addEventListener('mouseout', e => {
    const wrap = e.target.closest('.poster-wrap');
    if (wrap && overlay) { overlay.remove(); overlay = null; }
  });
})();

// Back to top button
(function() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 200);
  }, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// PWA install prompt
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'inline-block';
});

function pwaInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(() => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  });
}

// Cmd+F search popup — commented out for now, revisit as non-overriding suggestion popup
// Intent: show a suggestion popup pointing to My Comedians / filter, without overriding native Cmd+F
/*
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    showSearchPopup();
  }
});

function showSearchPopup() {
  let overlay = document.getElementById('search-popup-overlay');
  if (overlay) { overlay.remove(); return; }
  overlay = document.createElement('div');
  overlay.id = 'search-popup-overlay';
  overlay.innerHTML = `
    <div class="search-popup">
      <input type="text" id="search-popup-input" placeholder="Search comedians..." autocomplete="off" />
      <div id="search-popup-results"></div>
      <div class="search-popup-actions">
        <button onclick="openModal();document.getElementById('search-popup-overlay')?.remove();">My Comedians</button>
        <button onclick="document.getElementById('sort-select').value='faves';document.getElementById('sort-select').dispatchEvent(new Event('change'));document.getElementById('search-popup-overlay')?.remove();">Sort by Faves</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = document.getElementById('search-popup-input');
  input.focus();
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const results = document.getElementById('search-popup-results');
    if (!q) { results.innerHTML = ''; return; }
    const matches = [...allComediansSeen].filter(n => n.toLowerCase().includes(q)).slice(0, 8);
    results.innerHTML = matches.map(n =>
      `<button class="search-result-item" onclick="filterByComedian('${n.replace(/'/g, "\\'")}');document.getElementById('search-popup-overlay')?.remove();">${n}</button>`
    ).join('');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
*/

// Expose functions needed by inline onclick handlers (terser mangles names)
window.openModal = openModal;
window.closeModal = closeModal;
window.modalCycle = modalCycle;
window.handleComedianClick = handleComedianClick;
window.copyPrefsUrl = copyPrefsUrl;
window.setVenue = setVenue;
window.setPref = setPref;
window.setStandRoom = setStandRoom;
window.setBigVenue = setBigVenue;
window.toggleAlertBtn = toggleAlertBtn;
window.filterByComedian = filterByComedian;
window.trackReserve = trackReserve;
window.removeAlert = removeAlert;
window.expandBioInPanel = expandBioInPanel;
window.pwaInstall = pwaInstall;

// In-place refresh used by pull-to-refresh: refetch data sources, re-parse
// cellar HTML, re-render the current view without resetting tab/date filters.
async function refreshShowsInPlace() {
  try {
    const [batchData] = await Promise.all([
      fetchWithTimeout(STATIC_CELLAR, {}, 5000).then(r => r.json())
        .catch(() => fetchWithTimeout(`${API_BATCH_URL}?days=${dates.length}`, {}, 15000).then(r => r.json()))
        .catch(() => null),
      fetchTheStand(),
      fetchBigShows(),
      fetchNYCC(),
      fetchGotham(),
      fetchAvailability()
    ]);
    if (batchData?.results) {
      dates.forEach(d => {
        const dateStr = formatDateParam(d);
        const dayData = batchData.results[dateStr];
        const html = dayData?.show?.html || '';
        if (html) allData[dateStr] = parseShows(html, dateStr);
      });
    }
    renderShows();
  } catch (e) {
    console.error('refreshShowsInPlace failed:', e);
  }
}

// === App Settings (brand color, defaults, filters, unified share/import, QR, toast) ===
(function setupAppSettings(){
  const KEY = 'tonight-nyc-settings';
  const DEFAULTS = {
    accent: '#e63636',
    defaultTab: 'all',
    scheduleDay: 'all',
    neighborhood: 'all',
    soldOutMode: 'all',
    timeFilter: 'any',
    sort: 'none',
    bioMode: 'none',
    ratingsMode: 'off',
  };
  const PILL_GROUPS = {
    defaultTab: 'default-tab-pills',
    scheduleDay: 'default-schedule-pills',
    neighborhood: 'default-neighborhood-pills',
    soldOutMode: 'default-soldout-pills',
    timeFilter: 'default-time-pills',
    sort: 'default-sort-pills',
    bioMode: 'default-bio-pills',
    ratingsMode: 'default-ratings-pills',
  };
  // Mirror selects (hidden) we keep so external code that polls these IDs still works.
  const MIRROR_SELECTS = {
    defaultTab: 'default-tab-select',
    soldOutMode: 'default-soldout-mode',
    timeFilter: 'default-time-filter',
    sort: 'default-sort',
    bioMode: 'default-bio-mode',
  };

  function load(){
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch { return { ...DEFAULTS }; }
  }
  function save(s){ localStorage.setItem(KEY, JSON.stringify(s)); }
  function isDefault(s){
    for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) return false;
    return true;
  }

  // ---- Unified share encoding (prefs + settings) using CompressionStream when available ----
  function b64uEncode(bytes){
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str){
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function compressJson(obj){
    const json = JSON.stringify(obj);
    if (typeof CompressionStream === 'undefined') {
      // Fallback: plain base64 of UTF-8
      const enc = new TextEncoder().encode(json);
      return 'r' + b64uEncode(enc); // 'r' prefix = raw (uncompressed)
    }
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return 'd' + b64uEncode(bytes); // 'd' prefix = deflate-raw
  }
  async function decompressJson(str){
    if (!str) return null;
    try {
      const prefix = str[0];
      const body = str.slice(1);
      const bytes = b64uDecode(body);
      if (prefix === 'r') return JSON.parse(new TextDecoder().decode(bytes));
      if (prefix === 'd') {
        if (typeof DecompressionStream === 'undefined') return null;
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const json = await new Response(stream).text();
        return JSON.parse(json);
      }
      return null;
    } catch { return null; }
  }

  function snapshotPrefs(){
    try {
      return typeof loadPrefs === 'function'
        ? loadPrefs()
        : (JSON.parse(localStorage.getItem('cellar-tonight-prefs')) || { faves: [], skips: [], likes: [] });
    } catch { return { faves: [], skips: [], likes: [] }; }
  }
  function writePrefs(p){
    if (typeof savePrefs === 'function') { savePrefs(p); return; }
    localStorage.setItem('cellar-tonight-prefs', JSON.stringify(p));
  }
  function buildPayload(){
    const prefs = snapshotPrefs();
    // Omit defaults from settings to keep payload small. Decoder fills in via DEFAULTS.
    const s = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (settings[k] !== DEFAULTS[k]) s[k] = settings[k];
    }
    const p = {};
    if (prefs.faves?.length) p.f = prefs.faves;
    if (prefs.skips?.length) p.s = prefs.skips;
    if (prefs.likes?.length) p.l = prefs.likes;
    const out = {};
    if (Object.keys(s).length) out.s = s;
    if (Object.keys(p).length) out.p = p;
    return out;
  }
  async function buildShareLink(){
    const payload = buildPayload();
    if (Object.keys(payload).length === 0) {
      return window.location.origin + window.location.pathname;
    }
    const compressed = await compressJson(payload);
    return window.location.origin + window.location.pathname + '#cfg=' + compressed;
  }

  // ---- Hash import: handles #cfg= (new), #p= (legacy prefs), #s= (legacy settings) ----
  // Runs synchronously at script load so the imported state flows through normal init.
  let didImport = false;
  let priorSnapshot = null;
  async function tryImportFromHash(hashStr){
    if (!hashStr) return null;
    const cfgMatch = hashStr.match(/[#&]cfg=([^&]+)/);
    const pMatch = hashStr.match(/[#&]p=([A-Za-z0-9_-]+)/);
    const sMatch = hashStr.match(/[#&]s=([^&]+)/);
    if (cfgMatch) {
      const decoded = await decompressJson(cfgMatch[1]);
      if (!decoded) return null;
      return { prefs: decoded.p, settings: decoded.s };
    }
    if (pMatch && typeof decompressPrefs === 'function') {
      try {
        const prefs = await decompressPrefs(pMatch[1]);
        return { prefs: { f: prefs.faves, s: prefs.skips, l: prefs.likes } };
      } catch { /* ignore */ }
    }
    if (sMatch) {
      // Legacy #s= was plain base64 of settings JSON
      try {
        const bytes = b64uDecode(sMatch[1]);
        const json = new TextDecoder().decode(bytes);
        return { settings: JSON.parse(json) };
      } catch { /* ignore */ }
    }
    return null;
  }

  function pickPrefsFromImport(p){
    if (!p) return null;
    return {
      faves: p.f || p.faves || [],
      skips: p.s || p.skips || [],
      likes: p.l || p.likes || [],
    };
  }

  // ---- Visual application ----
  function setFavicon(color){
    const svg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path fill="${color}" d="m0 0h32v32h-32z"/><text fill="#fff" font-family="Helvetica,-apple-system,BlinkMacSystemFont,sans-serif" font-size="19" font-weight="700" text-anchor="middle" x="16" y="23">TN</text></svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    document.querySelectorAll('link[rel="icon"]').forEach(l => l.href = url);
  }
  function resetFavicon(){
    document.querySelectorAll('link[rel="icon"]').forEach(l => l.href = 'favicon.svg');
  }
  function applyAccent(s){
    document.documentElement.style.setProperty('--accent', s.accent);
    if (s.accent !== DEFAULTS.accent) setFavicon(s.accent); else resetFavicon();
  }

  // Resolve "schedule day" setting → activeDate value.
  function resolveScheduleDay(value){
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const now = new Date();
    if (value === 'today') return fmt(now);
    if (value === 'tomorrow') { const t = new Date(now); t.setDate(t.getDate()+1); return fmt(t); }
    if (value === 'weekend') {
      const d = new Date(now);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) return fmt(d);
      const daysUntilSat = (6 - dow + 7) % 7;
      d.setDate(d.getDate() + daysUntilSat);
      return fmt(d);
    }
    return 'all';
  }

  // Apply filter defaults to the live toolbar controls so the first render reflects them.
  function applyFilterDefaults(s){
    // Time filter
    const tfVisible = document.getElementById('time-filter-visible');
    const tfHidden = document.getElementById('time-filter');
    if (tfHidden && s.timeFilter) tfHidden.value = s.timeFilter;
    if (tfVisible && s.timeFilter) tfVisible.value = s.timeFilter;
    // Sort
    const sortSel = document.getElementById('sort-select');
    if (sortSel && s.sort) sortSel.value = s.sort;
    // Bio mode
    const bioSel = document.getElementById('bio-mode');
    if (bioSel && s.bioMode) bioSel.value = s.bioMode;
    // Ratings (quick-mode)
    const qm = document.getElementById('quick-mode');
    if (qm) qm.checked = s.ratingsMode === 'on';
    // Neighborhood
    if (typeof activeNeighborhood !== 'undefined' && s.neighborhood) {
      activeNeighborhood = s.neighborhood;
    }
    // Schedule day → activeDate
    if (typeof activeDate !== 'undefined' && s.scheduleDay) {
      activeDate = resolveScheduleDay(s.scheduleDay);
    }
  }

  // ---- Synchronous import → save → strip-hash, then load merged settings ----
  // (Runs in a top-level async IIFE — but we need it to complete BEFORE init resumes
  //  from its first `await`. We trigger it sync and let it set localStorage immediately
  //  on the synchronous portion via fallback when CompressionStream is unavailable;
  //  for the compressed path we rely on the loadPrefsFromHash awaited in init to
  //  read what we wrote.)
  (async function importFromHashOnLoad(){
    const hashStr = window.location.hash;
    const imported = await tryImportFromHash(hashStr);
    if (!imported) return;
    priorSnapshot = { prefs: snapshotPrefs(), settings: load() };
    if (imported.settings) {
      const merged = Object.assign({}, DEFAULTS, imported.settings);
      save(merged);
      Object.assign(settings, merged);
      applyAccent(settings);
      // If init has already mounted, re-apply filter defaults now.
      applyFilterDefaults(settings);
      // Sold-out filter dropdown:
      const soldSelNow = document.getElementById('soldout-filter');
      if (soldSelNow) soldSelNow.value = settings.soldOutMode || 'all';
      const hideCbNow = document.getElementById('hide-sold-out');
      if (hideCbNow) hideCbNow.checked = settings.soldOutMode === 'hide';
    }
    const prefs = pickPrefsFromImport(imported.prefs);
    if (prefs && (prefs.faves.length || prefs.skips.length || prefs.likes.length)) {
      writePrefs(prefs);
    }
    didImport = true;
    // Strip cfg/p/s from the hash.
    const cleaned = window.location.hash
      .replace(/[#&]?cfg=[^&]+/, '')
      .replace(/[#&]?p=[^&]+/, '')
      .replace(/[#&]?s=[^&]+/, '')
      .replace(/^#&/, '#');
    history.replaceState(null, '', window.location.pathname + (cleaned === '#' ? '' : cleaned));
    // Toast (after a tick so the modal/render is up).
    setTimeout(() => {
      showImportToast(imported);
      if (typeof renderShows === 'function') renderShows();
      if (typeof updateShareBtn === 'function') updateShareBtn();
    }, 200);
  })();

  const settings = load();
  applyAccent(settings);

  // Pre-set the venue tab before init's first render. activeSource is declared in data.js.
  if (settings.defaultTab && typeof activeSource !== 'undefined') {
    activeSource = settings.defaultTab;
  }
  applyFilterDefaults(settings);
  const soldSel = document.getElementById('soldout-filter');
  if (soldSel && settings.soldOutMode) soldSel.value = settings.soldOutMode;
  const hideCb = document.getElementById('hide-sold-out');
  if (hideCb) hideCb.checked = settings.soldOutMode === 'hide';

  // ---- DOM refs ----
  const overlay = document.getElementById('app-settings-overlay');
  const openBtn = document.getElementById('header-settings');
  const closeBtn = document.getElementById('app-settings-close');
  const doneBtn = document.getElementById('app-settings-done');
  const swatches = document.getElementById('color-swatches');
  const custom = document.getElementById('color-custom-input');
  const resetColorBtn = document.getElementById('reset-color');
  const shareBtn = document.getElementById('copy-settings-link');
  const qrBtn = document.getElementById('show-settings-qr');
  const resetAllBtn = document.getElementById('reset-all-settings');
  const importInput = document.getElementById('settings-import-url');
  const importGoBtn = document.getElementById('settings-import-go');
  const importStatus = document.getElementById('settings-import-status');
  const qrOverlay = document.getElementById('settings-qr-overlay');
  const qrCloseBtn = document.getElementById('settings-qr-close');
  const qrCanvas = document.getElementById('settings-qr-canvas');
  const qrUrlOut = document.getElementById('settings-qr-url');

  // ---- Pill / swatch refresh helpers ----
  function refreshPills(key){
    const groupId = PILL_GROUPS[key];
    if (!groupId) return;
    const group = document.getElementById(groupId);
    if (!group) return;
    const value = String(settings[key] ?? DEFAULTS[key]);
    group.querySelectorAll('.settings-pill').forEach(p => {
      p.setAttribute('aria-checked', p.dataset.value === value ? 'true' : 'false');
    });
    // Mirror into hidden select
    const mirrorId = MIRROR_SELECTS[key];
    if (mirrorId) {
      const sel = document.getElementById(mirrorId);
      if (sel) sel.value = value;
    }
  }
  function refreshSwatches(){
    if (!swatches) return;
    const cur = (settings.accent || '').toLowerCase();
    swatches.querySelectorAll('.color-swatch').forEach(b => {
      b.classList.toggle('active', (b.dataset.color || '').toLowerCase() === cur);
    });
  }
  function refreshShareUI(){
    const show = !isDefault(settings) || hasAnyPrefs();
    if (shareBtn) {
      shareBtn.style.display = show ? '' : 'none';
      shareBtn.textContent = 'Copy my setup';
    }
    if (qrBtn) qrBtn.style.display = show ? '' : 'none';
    if (typeof updateShareBtn === 'function') updateShareBtn();
  }
  function hasAnyPrefs(){
    const p = snapshotPrefs();
    return (p.faves?.length || 0) + (p.skips?.length || 0) + (p.likes?.length || 0) > 0;
  }
  function persist(){
    save(settings);
    refreshShareUI();
  }

  function syncToolbarFromSettings(){
    // Push current settings.* into live toolbar controls + re-render.
    applyFilterDefaults(settings);
    if (soldSel) soldSel.value = settings.soldOutMode;
    if (hideCb) hideCb.checked = settings.soldOutMode === 'hide';
    // Switch venue tab + reset date when starting tab changes.
    if (typeof activeSource !== 'undefined' && settings.defaultTab) {
      activeSource = settings.defaultTab;
    }
    if (typeof renderSourceTabs === 'function') renderSourceTabs();
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof updateFooterInfo === 'function') updateFooterInfo();
    if (typeof updateResetBtn === 'function') updateResetBtn();
    if (typeof renderShows === 'function') renderShows();
  }

  function openSettings(){
    if (!overlay) return;
    if (custom) custom.value = settings.accent;
    Object.keys(PILL_GROUPS).forEach(refreshPills);
    refreshSwatches();
    refreshShareUI();
    if (importStatus) importStatus.textContent = '';
    if (importInput) importInput.value = '';
    overlay.classList.remove('hidden');
  }
  function closeSettings(){ overlay?.classList.add('hidden'); }

  openBtn?.addEventListener('click', openSettings);
  closeBtn?.addEventListener('click', closeSettings);
  doneBtn?.addEventListener('click', closeSettings);
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });

  // ---- Brand color ----
  swatches?.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    settings.accent = btn.dataset.color;
    persist(); applyAccent(settings);
    if (custom) custom.value = settings.accent;
    refreshSwatches();
  });
  custom?.addEventListener('input', () => {
    settings.accent = custom.value;
    persist(); applyAccent(settings); refreshSwatches();
  });
  resetColorBtn?.addEventListener('click', () => {
    settings.accent = DEFAULTS.accent;
    persist(); applyAccent(settings);
    if (custom) custom.value = settings.accent;
    refreshSwatches();
  });

  // ---- Pill groups (all default-* sections) — generic handler ----
  Object.entries(PILL_GROUPS).forEach(([key, groupId]) => {
    const group = document.getElementById(groupId);
    group?.addEventListener('click', (e) => {
      const pill = e.target.closest('.settings-pill');
      if (!pill) return;
      settings[key] = pill.dataset.value;
      persist();
      refreshPills(key);
      // Live-apply the change to the home page so the user sees the effect immediately.
      syncToolbarFromSettings();
    });
  });

  // ---- Copy share link ----
  shareBtn?.addEventListener('click', async () => {
    const url = await buildShareLink();
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Copied!';
      setTimeout(() => { shareBtn.textContent = 'Copy my setup'; }, 1800);
    } catch {
      shareBtn.textContent = 'Copy failed';
      setTimeout(() => { shareBtn.textContent = 'Copy my setup'; }, 1800);
    }
  });

  // ---- QR ----
  async function loadQrLib(){
    if (window.qrcode) return window.qrcode;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  qrBtn?.addEventListener('click', async () => {
    if (!qrOverlay) return;
    qrCanvas.innerHTML = '<p style="color:var(--text-dim);text-align:center;">Generating…</p>';
    qrOverlay.classList.remove('hidden');
    try {
      const qrcode = await loadQrLib();
      const url = await buildShareLink();
      qrUrlOut.textContent = url;
      // Build QR with error-correction L for max data capacity; size 0 = auto.
      const qr = qrcode(0, 'L');
      qr.addData(url);
      qr.make();
      qrCanvas.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
    } catch (e) {
      qrCanvas.innerHTML = '<p style="color:var(--accent);">Could not load QR generator.</p>';
    }
  });
  qrCloseBtn?.addEventListener('click', () => qrOverlay?.classList.add('hidden'));
  qrOverlay?.addEventListener('click', (e) => { if (e.target === qrOverlay) qrOverlay.classList.add('hidden'); });

  // ---- Import ----
  importGoBtn?.addEventListener('click', async () => {
    const raw = (importInput?.value || '').trim();
    if (!raw) return;
    // Extract hash portion from full URL or accept bare hash.
    let hashPart = raw;
    const hashIdx = raw.indexOf('#');
    if (hashIdx >= 0) hashPart = raw.slice(hashIdx);
    else if (!/^cfg=|^p=|^s=/.test(raw)) hashPart = '#' + raw;
    else hashPart = '#' + raw;
    const imported = await tryImportFromHash(hashPart);
    if (!imported) {
      if (importStatus) { importStatus.style.color = 'var(--accent)'; importStatus.textContent = 'Could not read that link.'; }
      return;
    }
    priorSnapshot = { prefs: snapshotPrefs(), settings: load() };
    let summary = [];
    if (imported.settings) {
      const merged = Object.assign({}, DEFAULTS, imported.settings);
      save(merged);
      Object.assign(settings, merged);
      applyAccent(settings);
      syncToolbarFromSettings();
      summary.push('settings');
    }
    const prefsIn = pickPrefsFromImport(imported.prefs);
    if (prefsIn && (prefsIn.faves.length || prefsIn.skips.length || prefsIn.likes.length)) {
      // Merge with existing, like the prefs modal import does.
      const current = snapshotPrefs();
      const merged = {
        faves: [...new Set([...(current.faves || []), ...prefsIn.faves])],
        skips: [...new Set([...(current.skips || []), ...prefsIn.skips])],
        likes: [...new Set([...(current.likes || []), ...prefsIn.likes])],
      };
      writePrefs(merged);
      summary.push(`${prefsIn.faves.length} faves, ${prefsIn.skips.length} skips`);
    }
    if (importStatus) {
      importStatus.style.color = 'var(--text-dim)';
      importStatus.textContent = `Imported: ${summary.join(' · ') || 'nothing'}.`;
    }
    if (importInput) importInput.value = '';
    // Refresh modal UI
    openSettings();
    if (typeof renderShows === 'function') renderShows();
    if (typeof updateShareBtn === 'function') updateShareBtn();
    showImportToast(imported);
  });

  // ---- Toast ----
  const toast = document.getElementById('settings-toast');
  const toastMsg = document.getElementById('settings-toast-msg');
  const toastUndo = document.getElementById('settings-toast-undo');
  const toastClose = document.getElementById('settings-toast-close');
  let toastTimer = null;
  function hideToast(){ toast?.classList.add('hidden'); if (toastTimer) clearTimeout(toastTimer); toastTimer = null; }
  function showImportToast(imported){
    if (!toast) return;
    const parts = [];
    if (imported.settings) parts.push('settings');
    const prefsIn = pickPrefsFromImport(imported.prefs);
    if (prefsIn && (prefsIn.faves.length || prefsIn.skips.length || prefsIn.likes.length)) parts.push('faves');
    if (parts.length === 0) return;
    toastMsg.textContent = `Applied shared ${parts.join(' + ')}.`;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  toastUndo?.addEventListener('click', () => {
    if (!priorSnapshot) { hideToast(); return; }
    save(priorSnapshot.settings);
    Object.assign(settings, priorSnapshot.settings);
    applyAccent(settings);
    syncToolbarFromSettings();
    writePrefs(priorSnapshot.prefs);
    priorSnapshot = null;
    refreshShareUI();
    if (typeof renderShows === 'function') renderShows();
    hideToast();
  });
  toastClose?.addEventListener('click', hideToast);

  // ---- Reset all ----
  resetAllBtn?.addEventListener('click', () => {
    if (!confirm('Reset all app settings to defaults? Your faves and skips are kept.')) return;
    Object.assign(settings, DEFAULTS);
    persist();
    applyAccent(settings);
    if (custom) custom.value = settings.accent;
    Object.keys(PILL_GROUPS).forEach(refreshPills);
    refreshSwatches();
    syncToolbarFromSettings();
  });

  // Initial visibility of share + qr buttons after first render.
  setTimeout(refreshShareUI, 200);

  // Expose for the share button in the header.
  window.__tonightNycBuildShareLink = buildShareLink;
  window.__tonightNycHasNonDefault = () => !isDefault(settings) || hasAnyPrefs();
})();
