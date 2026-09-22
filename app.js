/* Ledger — private lending records, locked with a PIN. */
(function () {
  'use strict';
  const E = window.Engine, V = window.Vault, B = window.Backup, D = window.Dashboard, ST = window.Statement;
  const $ = (s, r = document) => r.querySelector(s);
  const appEl = $('#app'), sheetRoot = $('#sheet-root');

  const S = {
    session: null, db: null,
    mode: 'boot',              // boot | welcome | setup | lock | app
    view: { name: 'home' }, stack: [], tab: 'borrowers',
    q: '', loanFilter: 'active', lockMsg: '', setup: null, reveal: false,
  };
  let suspendUntil = 0, lastActive = Date.now(), bgAt = null;
  let pageUrls = [], sheetUrls = [], F = null; // F = state of the open form

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n, d = 2) => (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fdate = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; };
  const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const rateText = (l) => Number(l.rate) + '% per ' + (l.rateUnit === 'year' ? 'year' : 'month');
  const safeName = (s) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'x';
  const borrower = (id) => S.db.borrowers.find((b) => b.id === id);
  const loan = (id) => S.db.loans.find((l) => l.id === id);
  const today = () => E.todayStr();
  let toastT;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }
  const blankDb = () => ({ v: 1, borrowers: [], loans: [], payments: [], settings: { lockGraceSec: 30, idleMin: 5 }, lastBackupAt: null });
  function normDb(d) {
    const b = blankDb();
    return Object.assign(b, d, { settings: Object.assign(b.settings, (d && d.settings) || {}) });
  }
  function calcAll() {
    const t = today(); const m = new Map();
    S.db.loans.forEach((l) => m.set(l.id, E.computeLoan(l, S.db.payments, t)));
    return m;
  }
  function activeLoansFor(borrowerId, calc) {
    calc = calc || calcAll();
    return S.db.loans.filter((l) => l.borrowerId === borrowerId && !calc.get(l.id).settled);
  }

  const ICON = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>',
    loans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M8 9h8M8 13h8M8 17h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/><path d="M2.5 20h19" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };

  /* ---------------- persistence ---------------- */
  let saveChain = Promise.resolve();
  function persist() {
    const session = S.session; const snap = JSON.parse(JSON.stringify(S.db));
    saveChain = saveChain.then(() => session.saveDb(snap)).catch((e) => { console.error(e); toast('Could not save! ' + e.message); });
    return saveChain;
  }

  /* ---------------- files ---------------- */
  const SUSPEND_MS = 120000;      // pickers / share sheets can take a while
  const settleSuspend = () => { suspendUntil = Date.now() + 4000; }; // covers the "returning to app" event
  async function saveFile(blob, name) {
    suspendUntil = Date.now() + SUSPEND_MS;
    try { return await saveFileInner(blob, name); } finally { settleSuspend(); }
  }
  async function saveFileInner(blob, name) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e && e.name === 'AbortError') return false; /* otherwise fall back to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }
  async function compressImage(file, max = 1400, q = 0.72) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', q));
  }
  function hydratePhotos(root, bucket) {
    const s = S.session; if (!s) return;
    root.querySelectorAll('img[data-photo]').forEach((img) => {
      if (img.getAttribute('src')) return;
      s.getPhoto(img.dataset.photo).then((b) => {
        if (!b || !S.session) return;
        const u = URL.createObjectURL(b); bucket.push(u); img.src = u;
      }).catch(() => {});
    });
  }
  function revoke(list) { list.splice(0).forEach((u) => URL.revokeObjectURL(u)); }

  /* ---------------- navigation ---------------- */
  function go(view) { S.stack.push(S.view); S.view = view; S.reveal = false; render(true); }
  function back() { S.view = S.stack.pop() || { name: 'home' }; S.reveal = false; render(true); }

  /* ---------------- render ---------------- */
  function render(toTop) {
    revoke(pageUrls);
    if (!S.session) { renderLocked(); return; }
    const v = S.view;
    let html;
    if (v.name === 'borrower' && borrower(v.id)) html = viewBorrower(v.id);
    else if (v.name === 'loan' && loan(v.id)) html = viewLoan(v.id);
    else { S.view = { name: 'home' }; S.stack = []; html = viewHome(); }
    appEl.innerHTML = html;
    hydratePhotos(appEl, pageUrls);
    if (S.view.name === 'home' && S.tab === 'dashboard' && D) D.mount(appEl);
    if (toTop) window.scrollTo(0, 0);
  }

  /* ======================= LOCKED SCREENS ======================= */
  function renderLocked() {
    const m = S.mode;
    if (m === 'boot') { appEl.innerHTML = '<div class="center"><div class="lockicon">' + ICON.lock + '</div></div>'; return; }
    if (m === 'welcome') {
      appEl.innerHTML = `<div class="center">
        <div class="lockicon">${ICON.lock}</div>
        <h1>Ledger</h1>
        <p>Your private lending records, locked with a PIN.</p>
        <div class="btn-row">
          <button class="btn" data-act="welcome-new">Set up a new ledger</button>
          <label class="btn ghost filepick">Restore from an Excel backup<input type="file" id="welcome-restore"></label>
        </div>
        <div class="err" id="err"></div></div>`;
      return;
    }
    if (m === 'setup') {
      const restoring = !!(S.setup && S.setup.initialDb);
      appEl.innerHTML = `<div class="center">
        <div class="lockicon">${ICON.lock}</div>
        <h1>Create a PIN</h1>
        <p>${restoring ? 'Your backup is ready to restore. Choose a PIN to protect it on this phone.' : 'This PIN locks Ledger. Anyone who knows it, with this phone in hand, can open your records — so keep it private and don’t reuse a PIN from something else.'}</p>
        <form id="setupform">
          <label class="f"><span>PIN (4 to 8 digits)</span><input id="pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
          <label class="f"><span>Repeat PIN</span><input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
          <div class="hint">If the PIN is forgotten, the data on this phone can't be opened — only an Excel backup can bring the records back.</div>
          <div class="err" id="err"></div>
          <div class="btn-row"><button class="btn" type="submit">Create PIN</button>
          <button class="btn ghost" type="button" data-act="setup-cancel">Cancel</button></div>
        </form></div>`;
      return;
    }
    // lock
    appEl.innerHTML = `<div class="center">
      <div class="lockicon">${ICON.lock}</div>
      <h1>Ledger is locked</h1>
      <p>${esc(S.lockMsg) || 'Enter your PIN to open Ledger.'}</p>
      <form id="lockform">
        <label class="f"><span>PIN</span><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
        <div class="err" id="err"></div>
        <div class="btn-row"><button class="btn" type="submit">Unlock</button></div>
      </form>
      <button class="linklike" style="margin-top:14px;text-align:left;padding:0" data-act="forgot-pin">Forgot your PIN?</button></div>`;
    const pinEl = $('#pin'); if (pinEl) pinEl.focus();
  }
  const showErr = (m) => { const e = $('#err'); if (e) e.textContent = m; };

  /* ---- unlock attempts (with slow-down after repeated wrong tries) ---- */
  function throttleLeft() { try { const o = JSON.parse(localStorage.getItem('lg_f') || '{}'); return Math.max(0, (o.until || 0) - Date.now()); } catch (e) { return 0; } }
  function noteFail() { try { const o = JSON.parse(localStorage.getItem('lg_f') || '{}'); const n = (o.n || 0) + 1; localStorage.setItem('lg_f', JSON.stringify({ n, until: n >= 5 ? Date.now() + Math.min(600, 15 * Math.pow(2, n - 5)) * 1000 : 0 })); } catch (e) { /* ignore */ } }
  function clearFails() { try { localStorage.removeItem('lg_f'); } catch (e) { /* ignore */ } }

  async function tryUnlock() {
    const left = throttleLeft();
    if (left > 0) { showErr('Too many wrong tries. Please wait ' + Math.ceil(left / 1000) + ' seconds.'); return; }
    const pin = ($('#pin') || {}).value || '';
    if (!/^\d{4,8}$/.test(pin)) { showErr('Enter your PIN.'); return; }
    try {
      const session = await V.unlock(pin);
      S.session = session; S.db = normDb(await session.loadDb());
      clearFails(); S.mode = 'app'; S.view = { name: 'home' }; S.stack = []; S.tab = 'borrowers'; S.lockMsg = ''; lastActive = Date.now();
      render(true);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      if (e.code === 'BAD_KEY') noteFail();
      showErr(e.code === 'BAD_KEY' ? 'Wrong PIN.' : e.message || 'Could not unlock');
    }
  }
  function lock(msg) {
    S.session = null; S.db = null; S.view = { name: 'home' }; S.stack = []; S.reveal = false; S.q = ''; F = null;
    closeSheet(); closeViewer(); $('#toast').hidden = true; S.mode = 'lock'; S.lockMsg = msg || '';
    render();
  }

  /* ---- first-time setup ---- */
  async function createVault() {
    const a = $('#pin1').value, b = $('#pin2').value;
    if (!/^\d{4,8}$/.test(a)) return showErr('The PIN must be 4 to 8 digits.');
    if (a !== b) return showErr('The two PINs do not match.');
    try {
      S.session = await V.create({ pin: a, db: (S.setup && S.setup.initialDb) || blankDb() });
      S.db = normDb(await S.session.loadDb()); S.setup = null;
      S.mode = 'app'; S.view = { name: 'home' }; S.stack = []; S.tab = 'borrowers'; lastActive = Date.now();
      render(true); toast('Ledger is ready');
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { showErr(e.message || 'Could not create the PIN'); }
  }

  /* ======================= MAIN VIEWS ======================= */
  function tabbar() {
    const t = (id, label, ic) => `<button class="${S.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${ICON[ic]}<span>${label}</span></button>`;
    return `<nav class="tabbar">${t('borrowers', 'Borrowers', 'people')}${t('loans', 'Loans', 'loans')}${t('dashboard', 'Dashboard', 'chart')}${t('settings', 'Settings', 'gear')}</nav>`;
  }
  function viewHome() {
    let inner;
    if (S.tab === 'borrowers') inner = tabBorrowers();
    else if (S.tab === 'loans') inner = tabLoans();
    else if (S.tab === 'dashboard') inner = tabDashboard();
    else inner = tabSettings();
    return inner + tabbar();
  }
  const topbar = (title, left, right) => `<header class="topbar">${left || ''}<h1>${esc(title)}</h1>${right || ''}</header>`;

  function backupDays() {
    const t = S.db.lastBackupAt; if (!t) return null;
    return Math.floor((Date.now() - new Date(t).getTime()) / 86400000);
  }

  /* ---- Borrowers tab ---- */
  function borrowerRows() {
    const calc = calcAll(); const q = S.q.trim().toLowerCase();
    const items = S.db.borrowers
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.phone || '').includes(q))
      .map((b) => {
        const ls = S.db.loans.filter((l) => l.borrowerId === b.id);
        const active = ls.filter((l) => !calc.get(l.id).settled);
        const owed = active.reduce((s, l) => s + calc.get(l.id).outstanding, 0);
        return { b, ls, active, owed };
      })
      .sort((x, y) => y.owed - x.owed || x.b.name.localeCompare(y.b.name));
    if (!items.length) {
      return `<div class="empty"><b>${S.db.borrowers.length ? 'No match' : 'No borrowers yet'}</b>${S.db.borrowers.length ? 'Try a different name or number.' : 'Tap “+ Borrower” to add the first one.'}</div>`;
    }
    return items.map(({ b, ls, active, owed }) => `
      <button class="row" data-act="open-borrower" data-id="${b.id}">
        <div class="avatar">${esc(initials(b.name))}</div>
        <div class="main"><div class="t">${esc(b.name)}</div><div class="s">${esc(b.phone || '')}</div></div>
        <div class="amt">${active.length ? inr(owed, 0) + `<small>${active.length} active loan${active.length > 1 ? 's' : ''}</small>` : `<small>${ls.length ? 'All settled' : 'No loans'}</small>`}</div>
        <span class="chev">›</span></button>`).join('');
  }
  function tabBorrowers() {
    const calc = calcAll();
    let out = 0, lent = 0, paid = 0, interest = 0, active = 0;
    S.db.loans.forEach((l) => {
      const c = calc.get(l.id); lent += Number(l.principal); paid += c.totalPaid; interest += c.totalInterest;
      if (!c.settled) { out += c.outstanding; active++; }
    });
    const days = backupDays();
    const banner = (days === null || days >= 7) && S.db.borrowers.length
      ? `<div class="banner"><span>${days === null ? 'No backup yet.' : 'Last backup was ' + days + ' days ago.'}</span><button data-act="export">Back up</button></div>` : '';
    return `<div class="screen">
      ${topbar('Ledger', '', '<button class="icon-btn" data-act="lock">Lock</button>')}
      <div class="wrap">
        <div class="card hero"><div class="label">Total to receive today · ${active} active loan${active === 1 ? '' : 's'}</div>
          <div class="big">${inr(out)}</div>
          <div class="stats"><div class="stat"><div class="k">Lent</div><div class="v">${inr(lent, 0)}</div></div>
          <div class="stat"><div class="k">Received</div><div class="v">${inr(paid, 0)}</div></div>
          <div class="stat"><div class="k">Interest so far</div><div class="v">${inr(interest, 0)}</div></div></div>
          <button class="hero-action" data-act="record-payment">+ Record a payment</button></div>
        ${banner}
        <input class="search" id="q" type="search" placeholder="Search name or phone" value="${esc(S.q)}" autocomplete="off">
        <div class="list" id="blist">${borrowerRows()}</div>
      </div></div>
      <button class="btn fab" data-act="add-borrower">+ Borrower</button>`;
  }

  /* ---- Loans tab ---- */
  function tabLoans() {
    const calc = calcAll();
    const flt = S.loanFilter;
    const rows = S.db.loans
      .map((l) => ({ l, c: calc.get(l.id), b: borrower(l.borrowerId) }))
      .filter(({ c }) => flt === 'all' || (flt === 'active' ? !c.settled : c.settled))
      .sort((x, y) => y.c.outstanding - x.c.outstanding);
    const list = rows.length ? rows.map(({ l, c, b }) => `
      <button class="row" data-act="open-loan" data-id="${l.id}">
        <div class="avatar">${esc(initials(b ? b.name : '?'))}</div>
        <div class="main"><div class="t">${esc(b ? b.name : 'Unknown')}</div><div class="s">${inr(Number(l.principal), 0)} · ${esc(rateText(l))} · ${fdate(l.startDate)}</div></div>
        <div class="amt">${c.overpaid ? '<span class="chip bad">Overpaid</span>' : c.settled ? '<span class="chip gray">Settled</span>' : inr(c.outstanding, 0) + '<small>owed today</small>'}</div>
        <span class="chev">›</span></button>`).join('')
      : `<div class="empty"><b>No ${flt === 'all' ? '' : flt + ' '}loans</b>${S.db.loans.length ? '' : 'Open a borrower and tap “New loan”.'}</div>`;
    return `<div class="screen">${topbar('Loans')}<div class="wrap">
      <div class="seg">${[['active', 'Active'], ['settled', 'Settled'], ['all', 'All']].map(([k, n]) => `<button class="${flt === k ? 'on' : ''}" data-act="set-filter" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="list">${list}</div></div></div>`;
  }

  /* ---- Dashboard tab ---- */
  function tabDashboard() {
    return `<div class="screen">${topbar('Dashboard')}${D.render(S.db, E)}</div>`;
  }

  /* ---- Settings tab ---- */
  function tabSettings() {
    const st = S.db.settings; const days = backupDays();
    const opt = (v, cur, label) => `<option value="${v}" ${Number(cur) === v ? 'selected' : ''}>${label}</option>`;
    return `<div class="screen">${topbar('Settings')}<div class="wrap">
      <div class="card"><h2>Backup</h2>
        <div class="hint" style="margin:0 0 10px">${days === null ? 'No backup made yet.' : 'Last backup: ' + (days === 0 ? 'today' : days + ' day' + (days > 1 ? 's' : '') + ' ago') + '.'} The Excel file contains everything except ID photos, and is not password protected — keep it somewhere private.</div>
        <div class="btn-row"><button class="btn" data-act="export">Download Excel backup</button>
        <button class="btn secondary" data-act="export-photos">Back up ID photos</button>
        <label class="btn ghost filepick">Restore from Excel<input type="file" id="restore-xlsx"></label>
        <label class="btn ghost filepick">Restore ID photos<input type="file" id="restore-photos" accept="image/*" multiple></label></div></div>
      <div class="card"><h2>Security</h2>
        <div class="btn-row"><button class="btn secondary" data-act="change-pin">Change PIN</button>
        <button class="btn ghost" data-act="lock">Lock now</button></div>
        <label class="f"><span>Lock when the app is left for</span><select id="set-grace">${opt(0, st.lockGraceSec, 'Right away')}${opt(30, st.lockGraceSec, '30 seconds')}${opt(120, st.lockGraceSec, '2 minutes')}${opt(300, st.lockGraceSec, '5 minutes')}</select></label>
        <label class="f"><span>Lock after no activity for</span><select id="set-idle">${opt(2, st.idleMin, '2 minutes')}${opt(5, st.idleMin, '5 minutes')}${opt(10, st.idleMin, '10 minutes')}</select></label></div>
      <div class="card"><h2>Danger zone</h2>
        <div class="btn-row"><button class="btn danger" data-act="erase">Erase everything on this phone</button></div>
        <div class="hint">Ledger v2.0 · ${S.db.borrowers.length} borrowers · ${S.db.loans.length} loans · ${S.db.payments.length} payments</div></div>
    </div></div>`;
  }

  /* ---- Borrower detail ---- */
  function maskId(b) {
    if (!b.idNumber) return '—';
    if (S.reveal) return esc(/^\d{12}$/.test(b.idNumber) ? b.idNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : b.idNumber);
    return '<span class="mask">••••</span> ' + esc(b.idNumber.slice(-4));
  }
  function viewBorrower(id) {
    const b = borrower(id); const calc = calcAll();
    const ls = S.db.loans.filter((l) => l.borrowerId === id).sort((x, y) => y.startDate.localeCompare(x.startDate));
    const owed = ls.reduce((s, l) => s + (calc.get(l.id).settled ? 0 : calc.get(l.id).outstanding), 0);
    const loanRows = ls.length ? ls.map((l) => { const c = calc.get(l.id); return `
      <button class="row" data-act="open-loan" data-id="${l.id}">
        <div class="main"><div class="t">${inr(Number(l.principal), 0)} · ${esc(rateText(l))}</div><div class="s">Since ${fdate(l.startDate)}</div></div>
        <div class="amt">${c.overpaid ? '<span class="chip bad">Overpaid</span>' : c.settled ? '<span class="chip gray">Settled</span>' : inr(c.outstanding, 0) + '<small>owed today</small>'}</div><span class="chev">›</span></button>`; }).join('')
      : '<div class="empty">No loans yet.</div>';
    const thumbs = (b.photos || []).map((p) => `<button class="thumb" data-act="view-photo" data-id="${p}"><img data-photo="${p}" alt="ID photo"></button>`).join('');
    return `<div class="screen no-tabs">
      ${topbar(b.name, '<button class="icon-btn" data-act="back">‹ Back</button>', '<button class="icon-btn" data-act="edit-borrower" data-id="' + b.id + '">Edit</button>')}
      <div class="wrap">
        <div class="card hero"><div class="label">Owed by ${esc(b.name.split(' ')[0])} today</div><div class="big" style="margin-bottom:0">${inr(owed)}</div></div>
        <div class="card"><h2>Contact</h2>
          <div class="kv"><span class="k">Phone</span><span class="v">${b.phone ? `<a href="tel:${esc(b.phone)}" style="color:var(--accent);text-decoration:none">${esc(b.phone)}</a>` : '—'}</span></div>
          <div class="kv"><span class="k">Address</span><span class="v">${esc(b.address) || '—'}</span></div>
          ${b.notes ? `<div class="kv"><span class="k">Notes</span><span class="v">${esc(b.notes)}</span></div>` : ''}</div>
        <div class="card"><h2>Identification</h2>
          <div class="kv"><span class="k">${esc(b.idType || 'ID')}</span><span class="v">${maskId(b)}${b.idNumber ? `<button class="linklike" data-act="reveal">${S.reveal ? 'Hide' : 'Show'}</button>` : ''}</span></div>
          ${thumbs ? `<div class="thumbs">${thumbs}</div>` : '<div class="hint">No ID photo added.</div>'}</div>
        <h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);margin:20px 4px 0">Loans</h2>
        <div class="list">${loanRows}</div>
        <div class="btn-row"><button class="btn" data-act="add-loan" data-id="${b.id}">+ New loan</button>
        ${ls.length ? `<button class="btn secondary" data-act="borrower-statement" data-id="${b.id}">Share statement (PDF)</button>` : ''}</div>
      </div></div>`;
  }

  /* ---- Loan detail ---- */
  function viewLoan(id) {
    const l = loan(id); const b = borrower(l.borrowerId);
    const asOf = S.view.asOf || today();
    const c = E.computeLoan(l, S.db.payments, asOf);
    const label = asOf === today() ? 'today' : 'on ' + fdate(asOf);
    const chip = c.overpaid ? '<span class="chip bad">Overpaid</span>' : c.settled ? '<span class="chip gray">Settled</span>' : '<span class="chip">Active</span>';
    const eff = (Math.pow(1 + E.monthlyRate(l), 12) - 1) * 100;
    const items = c.ledger.slice().reverse().map((r) => {
      const sign = r.type === 'payment' ? '<span class="pos">− ' + inr(r.amount) + '</span>' : r.type === 'interest' ? '+ ' + inr(r.amount) : inr(r.amount);
      const meta = r.type === 'payment' ? [r.mode, r.note].filter(Boolean).map(esc).join(' · ') : '';
      return `<li ${r.type === 'payment' ? `data-act="edit-payment" data-id="${r.id}" style="cursor:pointer"` : ''}>
        <span class="dot ${r.type}"></span>
        <div class="m"><b>${esc(r.label)}</b><small>${fdate(r.date)}${meta ? ' · ' + meta : ''}</small></div>
        <div class="a">${sign}<small>owed ${inr(r.balanceAfter)}</small></div></li>`;
    }).join('');
    return `<div class="screen no-tabs">
      ${topbar(b ? b.name : 'Loan', '<button class="icon-btn" data-act="back">‹ Back</button>', '<button class="icon-btn" data-act="edit-loan" data-id="' + l.id + '">Edit</button>')}
      <div class="wrap">
        <div class="card hero"><div class="label">${c.overpaid ? 'Overpaid' : 'Owed'} ${esc(label)} ${chip.replace('class="chip', 'style="margin-left:6px" class="chip')}</div>
          <div class="big" style="margin-bottom:0">${inr(Math.abs(c.outstanding))}</div></div>
        <div class="btn-row"><button class="btn" data-act="add-payment" data-id="${l.id}">+ Add payment</button></div>
        <div class="card">
          <div class="kv"><span class="k">Loan amount</span><span class="v">${inr(c.principal)}</span></div>
          <div class="kv"><span class="k">+ Interest so far</span><span class="v">${inr(c.totalInterest)}</span></div>
          <div class="kv"><span class="k">− Paid so far</span><span class="v pos">${inr(c.totalPaid)}</span></div>
          <div class="kv"><span class="k"><b>= Owed ${esc(label)}</b></span><span class="v"><b>${inr(c.outstanding)}</b></span></div></div>
        <div class="card"><h2>Terms</h2>
          <div class="kv"><span class="k">Interest rate</span><span class="v">${esc(rateText(l))}</span></div>
          <div class="kv"><span class="k">Compounded monthly</span><span class="v">≈ ${eff.toFixed(1)}% a year</span></div>
          <div class="kv"><span class="k">Loan date</span><span class="v">${fdate(l.startDate)}</span></div>
          ${c.settled ? '' : `<div class="kv"><span class="k">Next interest added</span><span class="v">${fdate(c.nextCapitalisation)}</span></div>`}
          ${l.notes ? `<div class="kv"><span class="k">Notes</span><span class="v">${esc(l.notes)}</span></div>` : ''}
          <label class="f"><span>See the amount owed on another date</span><input type="date" id="asof" value="${asOf}" min="${l.startDate}"></label></div>
        <div class="card"><h2>History</h2><ul class="tl">${items}</ul></div>
      </div></div>`;
  }

  /* ======================= SHEETS (forms) ======================= */
  function openSheet(html) {
    sheetRoot.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog"><div class="grab"></div>${html}</div></div>`;
    hydratePhotos(sheetRoot, sheetUrls);
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    sheetRoot.innerHTML = ''; document.body.style.overflow = '';
    if (F && F.photos) F.photos.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
    revoke(sheetUrls); F = null;
  }
  const fieldErr = (m) => { const e = $('#ferr'); if (e) e.textContent = m; };

  /* ---- borrower form ---- */
  const ID_TYPES = ['Aadhaar', 'PAN', 'Voter ID', 'Driving Licence', 'Passport', 'Ration Card', 'Other'];
  function sheetBorrower(id) {
    const b = id ? borrower(id) : { name: '', phone: '', address: '', idType: 'Aadhaar', idNumber: '', notes: '', photos: [] };
    F = { kind: 'borrower', id, photos: (b.photos || []).map((p) => ({ id: p, isNew: false })), removed: [] };
    openSheet(`<h2>${id ? 'Edit borrower' : 'New borrower'}</h2>
      <label class="f"><span>Full name *</span><input id="f-name" type="text" autocomplete="off" value="${esc(b.name)}"></label>
      <label class="f"><span>Phone number *</span><input id="f-phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(b.phone)}"></label>
      <label class="f"><span>Address</span><textarea id="f-addr">${esc(b.address)}</textarea></label>
      <label class="f"><span>ID type</span><select id="f-idtype">${ID_TYPES.map((t) => `<option ${t === b.idType ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="f"><span>ID number</span><input id="f-idno" type="text" autocomplete="off" autocapitalize="characters" value="${esc(b.idNumber)}"></label>
      <div class="f"><span style="display:block;font-size:13px;color:var(--ink-2);margin:14px 0 0;font-weight:600">ID photos (up to 4)</span>
        <div class="thumbs" id="thumbs"></div>
        <label class="btn secondary filepick" style="margin-top:10px">Add photo<input type="file" id="photoin" accept="image/*" multiple></label></div>
      <label class="f"><span>Notes</span><textarea id="f-notes">${esc(b.notes)}</textarea></label>
      <div class="err" id="ferr"></div>
      <div class="btn-row"><button class="btn" data-act="save-borrower">Save</button>
        ${id ? '<button class="btn danger" data-act="del-borrower">Delete borrower</button>' : ''}
        <button class="btn ghost" data-act="close-sheet">Cancel</button></div>`);
    renderThumbs();
  }
  function renderThumbs() {
    const t = $('#thumbs'); if (!t || !F) return;
    t.innerHTML = F.photos.map((p) => `<div class="thumb"><img ${p.url ? `src="${p.url}"` : `data-photo="${p.id}"`} alt="ID photo"><button class="x" data-act="rm-photo" data-id="${p.id}" aria-label="Remove photo">×</button></div>`).join('') || '<div class="hint">No photo yet. Tap Add photo to use the camera or choose from Photos.</div>';
    hydratePhotos(t, sheetUrls);
  }
  async function saveBorrower() {
    const v = (id) => $(id).value.trim();
    const name = v('#f-name'), phone = v('#f-phone'), idType = $('#f-idtype').value;
    const idNumber = v('#f-idno').replace(idType === 'Aadhaar' ? /\s|-/g : /\s+/g, '');
    if (!name) return fieldErr('Please enter the name.');
    if (!phone) return fieldErr('Please enter a phone number.');
    if (idType === 'Aadhaar' && idNumber && !/^\d{12}$/.test(idNumber)) return fieldErr('An Aadhaar number has 12 digits.');
    const btn = $('[data-act="save-borrower"]'); if (btn) btn.disabled = true;
    let b = F.id ? borrower(F.id) : null; const isNew = !b;
    if (isNew) { b = { id: uid(), createdAt: new Date().toISOString(), photos: [] }; S.db.borrowers.push(b); }
    Object.assign(b, { name, phone, address: v('#f-addr'), idType, idNumber, notes: v('#f-notes') });
    for (const p of F.photos.filter((x) => x.isNew)) await S.session.putPhoto(p.id, p.blob);
    for (const pid of F.removed) await S.session.delPhoto(pid);
    b.photos = F.photos.map((p) => p.id);
    await persist(); closeSheet();
    if (isNew) go({ name: 'borrower', id: b.id }); else render();
    toast('Saved');
  }
  async function deleteBorrower() {
    const b = borrower(F.id); const ls = S.db.loans.filter((l) => l.borrowerId === b.id);
    if (!confirm('Delete ' + b.name + (ls.length ? ' and their ' + ls.length + ' loan(s) with all payments' : '') + '? This cannot be undone.')) return;
    const lids = new Set(ls.map((l) => l.id));
    S.db.payments = S.db.payments.filter((p) => !lids.has(p.loanId));
    S.db.loans = S.db.loans.filter((l) => l.borrowerId !== b.id);
    S.db.borrowers = S.db.borrowers.filter((x) => x.id !== b.id);
    for (const pid of b.photos || []) await S.session.delPhoto(pid);
    await persist(); closeSheet(); S.view = { name: 'home' }; S.stack = []; render(true); toast('Deleted');
  }

  /* ---- loan form ---- */
  function sheetLoan(borrowerId, loanId) {
    const l = loanId ? loan(loanId) : { principal: '', rate: '', rateUnit: 'month', startDate: today(), notes: '' };
    F = { kind: 'loan', borrowerId, id: loanId, unit: l.rateUnit };
    openSheet(`<h2>${loanId ? 'Edit loan' : 'New loan'}</h2>
      <label class="f"><span>Amount lent (₹) *</span><input id="l-amt" type="number" inputmode="decimal" min="0" step="any" value="${esc(l.principal)}"></label>
      <div class="f"><span style="display:block;font-size:13px;color:var(--ink-2);margin:14px 0 6px;font-weight:600">Interest rate *</span>
        <div class="seg" style="margin-bottom:10px"><button class="${l.rateUnit === 'month' ? 'on' : ''}" data-act="unit" data-v="month">Per month</button><button class="${l.rateUnit === 'year' ? 'on' : ''}" data-act="unit" data-v="year">Per year</button></div>
        <input id="l-rate" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 2" value="${esc(l.rate)}">
        <div class="hint" id="l-hint">Interest is added to the loan every month and then earns interest too (compound).</div></div>
      <label class="f"><span>Date lent *</span><input id="l-date" type="date" value="${l.startDate}"></label>
      <label class="f"><span>Notes</span><textarea id="l-notes" placeholder="Purpose, guarantor, collateral…">${esc(l.notes)}</textarea></label>
      <div class="err" id="ferr"></div>
      <div class="btn-row"><button class="btn" data-act="save-loan">Save</button>
        ${loanId ? '<button class="btn danger" data-act="del-loan">Delete loan</button>' : ''}
        <button class="btn ghost" data-act="close-sheet">Cancel</button></div>`);
    loanHint();
  }
  function loanHint() {
    const h = $('#l-hint'); if (!h || !F) return;
    const amt = parseFloat($('#l-amt').value), rate = parseFloat($('#l-rate').value);
    if (!(amt > 0) || !(rate >= 0)) { h.textContent = 'Interest is added to the loan every month and then earns interest too (compound).'; return; }
    const r = (F.unit === 'year' ? rate / 12 : rate) / 100;
    h.textContent = 'About ' + inr(amt * r) + ' interest in the first month · ' + inr(amt * Math.pow(1 + r, 12)) + ' owed after 1 year if nothing is paid.';
  }
  async function saveLoan() {
    const amt = parseFloat($('#l-amt').value), rate = parseFloat($('#l-rate').value), date = $('#l-date').value;
    if (!(amt > 0)) return fieldErr('Enter the amount lent.');
    if (!(rate >= 0) || $('#l-rate').value === '') return fieldErr('Enter the interest rate.');
    if (!date) return fieldErr('Pick the date the money was lent.');
    let l = F.id ? loan(F.id) : null;
    if (l && S.db.payments.some((p) => p.loanId === l.id && p.date < date)) return fieldErr('A payment is dated before this date. Fix or delete that payment first.');
    const isNew = !l;
    if (isNew) { l = { id: uid(), borrowerId: F.borrowerId, createdAt: new Date().toISOString() }; S.db.loans.push(l); }
    Object.assign(l, { principal: amt, rate, rateUnit: F.unit, startDate: date, notes: $('#l-notes').value.trim() });
    await persist(); closeSheet();
    if (isNew) go({ name: 'loan', id: l.id }); else render();
    toast('Saved');
  }
  async function deleteLoan() {
    const l = loan(F.id);
    if (!confirm('Delete this loan and all its payments? This cannot be undone.')) return;
    S.db.payments = S.db.payments.filter((p) => p.loanId !== l.id);
    S.db.loans = S.db.loans.filter((x) => x.id !== l.id);
    await persist(); closeSheet(); back(); toast('Deleted');
  }

  /* ---- payment form ---- */
  const MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Other'];
  function sheetPayment(loanId, payId) {
    const l = loan(loanId); const p = payId ? S.db.payments.find((x) => x.id === payId) : null;
    const d = p ? p.date : (today() < l.startDate ? l.startDate : today());
    F = { kind: 'payment', loanId, id: payId };
    openSheet(`<h2>${p ? 'Edit payment' : 'Add payment'}</h2>
      <label class="f"><span>Date received *</span><input id="p-date" type="date" value="${d}" min="${l.startDate}"></label>
      <div class="hint" id="p-owed"></div>
      <label class="f"><span>Amount received (₹) *</span><input id="p-amt" type="number" inputmode="decimal" min="0" step="any" value="${p ? esc(p.amount) : ''}"></label>
      <button class="linklike" style="padding:8px 0 0" data-act="pay-full">Fill the full amount owed</button>
      <label class="f"><span>How was it paid?</span><select id="p-mode">${MODES.map((m) => `<option ${p && p.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f"><span>Note</span><input id="p-note" type="text" autocomplete="off" value="${p ? esc(p.note) : ''}"></label>
      <div class="err" id="ferr"></div>
      <div class="btn-row"><button class="btn" data-act="save-payment">Save payment</button>
        ${p ? '<button class="btn danger" data-act="del-payment">Delete payment</button>' : ''}
        <button class="btn ghost" data-act="close-sheet">Cancel</button></div>`);
    owedHint();
  }
  function owedOn(date) {
    const l = loan(F.loanId);
    return E.computeLoan(l, S.db.payments.filter((p) => p.id !== F.id), date).outstanding;
  }
  function owedHint() {
    const el = $('#p-owed'); if (!el || !F) return;
    const d = $('#p-date').value; if (!d) { el.textContent = ''; return; }
    el.textContent = 'Owed on ' + fdate(d) + ' before this payment: ' + inr(owedOn(d));
  }
  async function savePayment() {
    const l = loan(F.loanId); const date = $('#p-date').value; const amt = parseFloat($('#p-amt').value);
    if (!date) return fieldErr('Pick the date.');
    if (date < l.startDate) return fieldErr('The payment cannot be before the loan date (' + fdate(l.startDate) + ').');
    if (!(amt > 0)) return fieldErr('Enter the amount received.');
    const owed = owedOn(date);
    if (amt > owed + 0.5 && !confirm('This is more than the ' + inr(owed) + ' owed on that date. Save anyway?')) return;
    let p = F.id ? S.db.payments.find((x) => x.id === F.id) : null;
    if (!p) { p = { id: uid(), loanId: l.id }; S.db.payments.push(p); }
    Object.assign(p, { date, amount: amt, mode: $('#p-mode').value, note: $('#p-note').value.trim() });
    await persist(); closeSheet(); render(); toast('Payment saved');
  }
  async function deletePayment() {
    if (!confirm('Delete this payment?')) return;
    S.db.payments = S.db.payments.filter((p) => p.id !== F.id);
    await persist(); closeSheet(); render(); toast('Deleted');
  }

  /* ---- record-payment quick picker (from the Borrowers tab) ---- */
  function sheetPickBorrowerForPayment() {
    const calc = calcAll();
    const rows = S.db.borrowers.map((b) => {
      const ls = activeLoansFor(b.id, calc);
      if (!ls.length) return null;
      const owed = ls.reduce((s, l) => s + calc.get(l.id).outstanding, 0);
      return { b, ls, owed };
    }).filter(Boolean).sort((x, y) => y.owed - x.owed);
    if (!rows.length) { toast('No active loans yet — add a borrower and a loan first.'); return; }
    F = { kind: 'pick-payment' };
    openSheet(`<h2>Record a payment</h2>
      <p class="hint" style="margin:0 0 10px">Who paid?</p>
      <div class="list">${rows.map(({ b, ls, owed }) => `
        <button class="row" data-act="pick-borrower-pay" data-id="${b.id}">
          <div class="avatar">${esc(initials(b.name))}</div>
          <div class="main"><div class="t">${esc(b.name)}</div><div class="s">${ls.length} active loan${ls.length > 1 ? 's' : ''}</div></div>
          <div class="amt">${inr(owed, 0)}<small>owed</small></div><span class="chev">›</span></button>`).join('')}</div>
      <div class="btn-row"><button class="btn ghost" data-act="close-sheet">Cancel</button></div>`);
  }
  function sheetPickLoanForPayment(borrowerId) {
    const b = borrower(borrowerId); const calc = calcAll();
    const ls = activeLoansFor(borrowerId, calc);
    F = { kind: 'pick-payment-loan' };
    openSheet(`<h2>${esc(b.name)}</h2>
      <p class="hint" style="margin:0 0 10px">Which loan is this payment for?</p>
      <div class="list">${ls.map((l) => { const c = calc.get(l.id); return `
        <button class="row" data-act="pick-loan-pay" data-id="${l.id}">
          <div class="main"><div class="t">${inr(Number(l.principal), 0)} · ${esc(rateText(l))}</div><div class="s">Since ${fdate(l.startDate)}</div></div>
          <div class="amt">${inr(c.outstanding, 0)}<small>owed</small></div><span class="chev">›</span></button>`; }).join('')}</div>
      <div class="btn-row"><button class="btn ghost" data-act="close-sheet">Cancel</button></div>`);
  }

  /* ---- PIN ---- */
  function sheetPin() {
    F = { kind: 'pin' };
    openSheet(`<h2>Change PIN</h2>
      <p class="hint" style="margin:0 0 4px">If the new PIN is forgotten, only an Excel backup can bring the data back.</p>
      <label class="f"><span>New PIN (4 to 8 digits)</span><input id="n-pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
      <label class="f"><span>Repeat new PIN</span><input id="n-pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
      <div class="err" id="ferr"></div>
      <div class="btn-row"><button class="btn" data-act="save-pin">Save PIN</button>
        <button class="btn ghost" data-act="close-sheet">Cancel</button></div>`);
  }
  async function savePin() {
    const a = $('#n-pin1').value, b = $('#n-pin2').value;
    if (!/^\d{4,8}$/.test(a)) return fieldErr('The PIN must be 4 to 8 digits.');
    if (a !== b) return fieldErr('The two PINs do not match.');
    try { await S.session.changePin(S.db, a); closeSheet(); render(); toast('PIN changed'); }
    catch (e) { fieldErr('Could not change the PIN: ' + e.message); }
  }

  /* ======================= BACKUP, RESTORE & STATEMENTS ======================= */
  async function doExport() {
    try {
      const buf = B.build(S.db, E);
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const ok = await saveFile(blob, 'Ledger-Backup-' + today() + '.xlsx');
      if (ok) { S.db.lastBackupAt = new Date().toISOString(); await persist(); render(); toast('Backup ready to share or save.'); }
    } catch (e) { toast('Backup failed: ' + e.message); }
  }
  async function doPhotoExport() {
    const files = [];
    for (const b of S.db.borrowers) {
      let n = 0;
      for (const pid of b.photos || []) {
        const blob = await S.session.getPhoto(pid); if (!blob) continue;
        files.push(new File([blob], 'ID_' + b.id + '_' + (++n) + '_' + safeName(b.name) + '.jpg', { type: 'image/jpeg' }));
      }
    }
    if (!files.length) { toast('There are no ID photos to back up.'); return; }
    suspendUntil = Date.now() + SUSPEND_MS;
    try {
      if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: 'ID photos' }); toast('Photos shared.'); }
      else { for (const f of files) await saveFile(f, f.name); }
    } catch (e) { if (!e || e.name !== 'AbortError') toast('Could not share the photos'); }
    finally { settleSuspend(); }
  }
  async function readWorkbook(file) {
    const r = B.parse(await file.arrayBuffer());
    if (r.problems.length) console.warn(r.problems);
    return r;
  }
  async function restoreInto(file) {
    try {
      const r = await readWorkbook(file);
      const msg = 'Found ' + r.borrowers.length + ' borrowers, ' + r.loans.length + ' loans and ' + r.payments.length + ' payments' + (r.problems.length ? ' (' + r.problems.length + ' rows skipped)' : '') + '.\n\nThis REPLACES everything now in the app. Continue?';
      if (!confirm(msg)) return;
      const old = new Map(S.db.borrowers.map((b) => [b.id, b.photos || []]));
      r.borrowers.forEach((b) => { b.photos = old.get(b.id) || []; });
      const keep = new Set(r.borrowers.flatMap((b) => b.photos));
      for (const [, ph] of old) for (const p of ph) if (!keep.has(p)) await S.session.delPhoto(p);
      S.db.borrowers = r.borrowers; S.db.loans = r.loans; S.db.payments = r.payments;
      await persist(); S.view = { name: 'home' }; S.stack = []; S.tab = 'borrowers'; render(true); toast('Restored');
    } catch (e) { alert('Could not restore: ' + e.message); }
  }
  async function restorePhotos(fileList) {
    let ok = 0, skipped = 0;
    for (const f of fileList) {
      const m = f.name.match(/^ID_([a-z0-9]+)_\d+_/i);
      const b = m && borrower(m[1]);
      if (!b || (b.photos || []).length >= 4) { skipped++; continue; }
      const id = 'ph_' + uid();
      await S.session.putPhoto(id, f); b.photos = (b.photos || []).concat(id); ok++;
    }
    await persist(); render();
    toast(ok + ' photo' + (ok === 1 ? '' : 's') + ' restored' + (skipped ? ', ' + skipped + ' skipped' : ''));
  }
  async function doStatement(borrowerId) {
    const b = borrower(borrowerId);
    const ls = S.db.loans.filter((l) => l.borrowerId === borrowerId).sort((x, y) => x.startDate.localeCompare(y.startDate));
    if (!ls.length) { toast('Add a loan first.'); return; }
    try {
      const doc = ST.buildBorrowerStatement(b, ls, S.db.payments);
      const blob = doc.output('blob');
      const ok = await saveFile(blob, 'Statement-' + safeName(b.name) + '-' + today() + '.pdf');
      if (ok) toast('Statement ready to share or save.');
    } catch (e) { toast('Could not build the statement: ' + (e.message || e)); }
  }

  /* ---- viewer ---- */
  let viewerUrl = null;
  async function openViewer(pid) {
    const blob = await S.session.getPhoto(pid); if (!blob) return;
    viewerUrl = URL.createObjectURL(blob);
    const v = $('#viewer'); v.innerHTML = '<img alt="ID photo"><button data-act="close-viewer">Close</button>'; v.querySelector('img').src = viewerUrl; v.hidden = false;
  }
  function closeViewer() { const v = $('#viewer'); v.hidden = true; v.innerHTML = ''; if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; } }

  /* ======================= EVENTS ======================= */
  document.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'lockform') { e.preventDefault(); await tryUnlock(); }
    else if (e.target && e.target.id === 'setupform') { e.preventDefault(); await createVault(); }
  });

  document.addEventListener('click', async (e) => {
    if (e.target.closest('label.filepick')) suspendUntil = Date.now() + SUSPEND_MS;
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    lastActive = Date.now();
    switch (act) {
      /* setup / lock */
      case 'welcome-new': S.setup = null; S.mode = 'setup'; render(); break;
      case 'setup-cancel': S.setup = null; S.mode = 'welcome'; render(); break;
      case 'forgot-pin':
        if (confirm('Without the PIN the data on this phone cannot be opened.\n\nIf you have an Excel backup, you can erase this app’s data and restore from that backup with a new PIN.\n\nErase the data on this phone now?')) {
          await V.wipe(); S.mode = 'welcome'; render();
        }
        break;
      /* navigation */
      case 'tab': S.tab = el.dataset.tab; render(true); break;
      case 'back': back(); break;
      case 'open-borrower': go({ name: 'borrower', id }); break;
      case 'open-loan': go({ name: 'loan', id }); break;
      case 'set-filter': S.loanFilter = el.dataset.v; render(); break;
      case 'reveal': S.reveal = !S.reveal; render(); break;
      case 'lock': lock(); break;
      /* forms */
      case 'add-borrower': sheetBorrower(); break;
      case 'edit-borrower': sheetBorrower(id); break;
      case 'save-borrower': await saveBorrower(); break;
      case 'del-borrower': await deleteBorrower(); break;
      case 'add-loan': sheetLoan(id); break;
      case 'edit-loan': sheetLoan(loan(id).borrowerId, id); break;
      case 'save-loan': await saveLoan(); break;
      case 'del-loan': await deleteLoan(); break;
      case 'unit': F.unit = el.dataset.v; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); loanHint(); break;
      case 'add-payment': sheetPayment(id); break;
      case 'edit-payment': sheetPayment(S.view.id, id); break;
      case 'save-payment': await savePayment(); break;
      case 'del-payment': await deletePayment(); break;
      case 'pay-full': { const d = $('#p-date').value; if (d) { $('#p-amt').value = Math.max(0, owedOn(d)).toFixed(2); } break; }
      case 'record-payment': sheetPickBorrowerForPayment(); break;
      case 'pick-borrower-pay': {
        const ls = activeLoansFor(id); closeSheet();
        if (ls.length === 1) sheetPayment(ls[0].id); else sheetPickLoanForPayment(id);
        break;
      }
      case 'pick-loan-pay': closeSheet(); sheetPayment(id); break;
      case 'rm-photo': {
        const p = F.photos.find((x) => x.id === id); if (!p) break;
        if (p.url) URL.revokeObjectURL(p.url); else F.removed.push(p.id);
        F.photos = F.photos.filter((x) => x.id !== id); renderThumbs(); break;
      }
      case 'view-photo': openViewer(id); break;
      case 'close-viewer': closeViewer(); break;
      case 'close-sheet': closeSheet(); break;
      case 'scrim': if (e.target === el) closeSheet(); break;
      /* settings */
      case 'export': await doExport(); break;
      case 'export-photos': await doPhotoExport(); break;
      case 'borrower-statement': await doStatement(id); break;
      case 'change-pin': sheetPin(); break;
      case 'save-pin': await savePin(); break;
      case 'erase': {
        const t = prompt('This permanently erases ALL records on this phone.\nType ERASE to confirm.');
        if (t && t.trim().toUpperCase() === 'ERASE') { await V.wipe(); S.session = null; S.db = null; S.mode = 'welcome'; closeSheet(); render(); }
        break;
      }
      default: break;
    }
  });

  document.addEventListener('input', (e) => {
    lastActive = Date.now();
    const id = e.target.id;
    if (id === 'q') { S.q = e.target.value; const l = $('#blist'); if (l) l.innerHTML = borrowerRows(); }
    else if (id === 'l-amt' || id === 'l-rate') loanHint();
    else if (id === 'p-date') owedHint();
    else if (id === 'pin' || id === 'pin1' || id === 'n-pin1') { const err = $('#err') || $('#ferr'); if (err) err.textContent = ''; }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target, id = t.id; lastActive = Date.now();
    if (t.type === 'file') settleSuspend();
    const file = t.files && t.files[0];
    if (id === 'welcome-restore' && file) {
      try {
        const r = await readWorkbook(file);
        S.setup = { initialDb: Object.assign(blankDb(), { borrowers: r.borrowers, loans: r.loans, payments: r.payments }) };
        S.mode = 'setup'; render(); toast('Found ' + r.borrowers.length + ' borrowers. Now create a PIN.');
      } catch (err) { showErr(err.message); }
      t.value = '';
    }
    else if (id === 'restore-xlsx' && file) { await restoreInto(file); t.value = ''; }
    else if (id === 'restore-photos' && t.files.length) { await restorePhotos(Array.from(t.files)); t.value = ''; }
    else if (id === 'photoin' && t.files.length && F) {
      for (const f of Array.from(t.files)) {
        if (F.photos.length >= 4) { toast('Up to 4 photos'); break; }
        try { const blob = await compressImage(f); F.photos.push({ id: 'ph_' + uid(), isNew: true, blob, url: URL.createObjectURL(blob) }); }
        catch (err) { toast('Could not read that photo'); }
      }
      renderThumbs(); t.value = '';
    }
    else if (id === 'asof') { S.view.asOf = t.value || undefined; render(); }
    else if (id === 'set-grace') { S.db.settings.lockGraceSec = Number(t.value); persist(); }
    else if (id === 'set-idle') { S.db.settings.idleMin = Number(t.value); persist(); }
  });

  /* ---- auto-lock ---- */
  document.addEventListener('visibilitychange', () => {
    if (!S.session) return;
    if (document.hidden) { bgAt = Date.now(); return; }
    const away = bgAt ? Date.now() - bgAt : 0; bgAt = null;
    if (Date.now() < suspendUntil) return;
    if (away >= S.db.settings.lockGraceSec * 1000) lock('Locked because the app was closed. Enter your PIN to open it.');
  });
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!S.session || Date.now() < suspendUntil) return;
    if (Date.now() - lastActive > S.db.settings.idleMin * 60000) lock('Locked after a few minutes without use.');
  }, 15000);

  /* ======================= BOOT ======================= */
  async function boot() {
    render();
    try {
      if (!window.indexedDB || !window.crypto || !crypto.subtle) throw new Error('This browser cannot keep private data safely. Open the app in Safari over https.');
      S.mode = (await V.exists()) ? 'lock' : 'welcome';
    } catch (e) {
      appEl.innerHTML = '<div class="center"><h1>Cannot start</h1><p>' + esc(e.message) + '</p></div>'; return;
    }
    render();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot();

  // exposed for automated tests only
  window.__ledger = { S, E };
})();
