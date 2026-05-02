// ---- Native bridge (Capacitor on iOS, no-op on web) ----
const Native = (function() {
  function cap() { return window.Capacitor; }
  function isNative() { return !!(cap() && cap().isNativePlatform && cap().isNativePlatform()); }
  function plugin(name) { return cap()?.Plugins?.[name]; }

  async function impact(style) {
    if (!isNative()) return;
    const Haptics = plugin('Haptics');
    if (!Haptics) return;
    try { await Haptics.impact({ style: style || 'Medium' }); } catch {}
  }

  async function selection() {
    if (!isNative()) return;
    const Haptics = plugin('Haptics');
    if (!Haptics) return;
    try { await Haptics.selectionStart(); await Haptics.selectionChanged(); await Haptics.selectionEnd(); } catch {}
  }

  async function share(title, url) {
    if (isNative()) {
      const Share = plugin('Share');
      if (Share) {
        try { await Share.share({ title, url, dialogTitle: title }); return 'native'; } catch { return 'cancelled'; }
      }
    }
    if (navigator.share) {
      try { await navigator.share({ title, url }); return 'webshare'; } catch { return 'cancelled'; }
    }
    try { await navigator.clipboard.writeText(url); return 'clipboard'; } catch { return 'failed'; }
  }

  let _notifPermissionAsked = false;
  async function ensureNotifPermission() {
    if (!isNative()) return false;
    const LN = plugin('LocalNotifications');
    if (!LN) return false;
    try {
      const current = await LN.checkPermissions();
      if (current.display === 'granted') return true;
      if (_notifPermissionAsked) return false;
      _notifPermissionAsked = true;
      const req = await LN.requestPermissions();
      return req.display === 'granted';
    } catch { return false; }
  }

  function hashId(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 2147483647;
  }

  // Reschedule all future reminders based on current favorites.
  // items: [{ dateStr, time, title, comedians, venue }]
  async function scheduleReminders(items) {
    if (!isNative()) return { scheduled: 0 };
    const LN = plugin('LocalNotifications');
    if (!LN) return { scheduled: 0 };
    const granted = await ensureNotifPermission();
    if (!granted) return { scheduled: 0 };

    const prefs = (typeof loadPrefs === 'function') ? loadPrefs() : { faves: [] };
    const faveSet = new Set(prefs.faves || []);
    const now = Date.now();
    const toSchedule = [];
    for (const it of items) {
      if (!it || !it.dateStr || !it.time) continue;
      const matching = (it.comedians || []).filter(n => faveSet.has(n));
      if (matching.length === 0) continue;
      const when = parseShowDate(it.dateStr, it.time);
      if (!when) continue;
      const notifyAt = when.getTime() - 60 * 60 * 1000; // 1hr before
      if (notifyAt <= now + 60 * 1000) continue; // skip near-past
      const id = hashId(`${it.dateStr}|${it.time}|${it.title || ''}|${matching.join(',')}`);
      const who = matching.length === 1 ? matching[0] : `${matching[0]} +${matching.length - 1}`;
      toSchedule.push({
        id,
        title: `${who} on at ${it.time}`,
        body: `${it.venue || 'Show'} starts in 1 hr. Tap to open Tonight NYC.`,
        schedule: { at: new Date(notifyAt) },
      });
    }

    try {
      const pending = await LN.getPending();
      if (pending?.notifications?.length) {
        await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      }
    } catch {}
    if (toSchedule.length === 0) return { scheduled: 0 };
    try {
      await LN.schedule({ notifications: toSchedule });
      return { scheduled: toSchedule.length };
    } catch { return { scheduled: 0 }; }
  }

  function parseShowDate(dateStr, timeStr) {
    // dateStr: 'YYYY-MM-DD', timeStr: e.g. '7:30 PM' or '19:30'
    if (!dateStr) return null;
    const m24 = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '');
    const m12 = /^(\d{1,2}):(\d{2})\s*([APap][Mm])$/.exec(timeStr || '');
    let hh = 0, mm = 0;
    if (m24) { hh = parseInt(m24[1], 10); mm = parseInt(m24[2], 10); }
    else if (m12) {
      hh = parseInt(m12[1], 10) % 12;
      mm = parseInt(m12[2], 10);
      if (m12[3].toUpperCase() === 'PM') hh += 12;
    } else return null;
    const [Y, M, D] = dateStr.split('-').map(n => parseInt(n, 10));
    if (!Y || !M || !D) return null;
    return new Date(Y, M - 1, D, hh, mm, 0, 0);
  }

  return { isNative, impact, selection, share, scheduleReminders, ensureNotifPermission };
})();
