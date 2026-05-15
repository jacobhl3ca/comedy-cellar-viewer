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
      // Preserve selected date across tabs if that date exists in new source
      if (prevDate && prevDate !== 'all') {
        activeDate = prevDate;
      } else {
        activeDate = 'all';
      }
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
  const THRESHOLD = 70;
  const MAX_PULL = 110;
  let startY = 0;
  let pulling = false;
  let pullingClass = false;
  let pullDistance = 0;
  let refreshing = false;
  let pendingDy = null;
  let rafId = 0;

  function applyPull() {
    rafId = 0;
    if (pendingDy === null || !pulling) return;
    if (pendingDy <= 0) {
      pullDistance = 0;
      if (pullingClass) {
        indicator.classList.remove('pulling');
        document.body.classList.remove('ptr-pulling');
        pullingClass = false;
      }
      document.body.style.transform = '';
      indicator.style.transform = '';
      return;
    }
    pullDistance = Math.min(pendingDy * 0.6, MAX_PULL);
    if (!pullingClass) {
      indicator.classList.add('pulling');
      document.body.classList.add('ptr-pulling');
      pullingClass = true;
    }
    document.body.style.transform = `translateY(${pullDistance}px)`;
    indicator.style.transform = `translate(-50%, 0) rotate(${pullDistance * 4}deg)`;
    indicator.style.opacity = Math.min(pullDistance / 30, 1);
  }

  function resetPull() {
    pulling = false;
    pullDistance = 0;
    pendingDy = null;
    if (pullingClass) {
      indicator.classList.remove('pulling');
      document.body.classList.remove('ptr-pulling');
      pullingClass = false;
    }
    document.body.style.transform = '';
    if (!refreshing) { indicator.style.transform = ''; indicator.style.opacity = ''; }
  }

  document.addEventListener('touchstart', (e) => {
    if (refreshing) return;
    if (window.scrollY > 0) { pulling = false; return; }
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
        pullingClass = false;
      }
      // Keep body translated at THRESHOLD until reload, so the gap stays open
      document.body.style.transform = `translateY(${THRESHOLD}px)`;
      indicator.classList.add('refreshing');
      indicator.style.transform = 'translate(-50%, 0) rotate(0deg)';
      indicator.style.opacity = '1';
      Native.impact('Medium');
      setTimeout(() => location.reload(), 350);
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
