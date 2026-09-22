/* Dashboard — given vs received visualizations.
 * Renders plain inline SVG (no chart library) and wires up hover/tooltip
 * interaction after the HTML is in the DOM (call Dashboard.mount after render).
 */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attrJSON = (o) => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inr = (n, d = 0) => (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 10000000) return (n / 10000000).toFixed(a >= 100000000 ? 0 : 1) + 'Cr';
    if (a >= 100000) return (n / 100000).toFixed(a >= 1000000 ? 0 : 1) + 'L';
    if (a >= 1000) return (n / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
    return Math.round(n).toString();
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function monthKey(dateStr) { return dateStr.slice(0, 7); }
  function addMonthKey(key, n) {
    const [y, m] = key.split('-').map(Number);
    const total = (m - 1) + n; const ty = y + Math.floor(total / 12); const tm = ((total % 12) + 12) % 12;
    return ty + '-' + String(tm + 1).padStart(2, '0');
  }
  function keyLabel(key) { const [y, m] = key.split('-').map(Number); return MON[m - 1] + ' ' + String(y).slice(2); }

  /** Monthly running totals of money given out vs received back, most recent <=12 months. */
  function trendSeries(db) {
    if (!db.loans.length) return null;
    const allDates = db.loans.map((l) => l.startDate).concat(db.payments.map((p) => p.date));
    const minKey = monthKey(allDates.reduce((a, b) => (a < b ? a : b)));
    const nowKey = monthKey(new Date().toISOString());
    let keys = [];
    for (let k = minKey; k <= nowKey; k = addMonthKey(k, 1)) { keys.push(k); if (keys.length > 500) break; }
    if (keys.length > 12) keys = keys.slice(keys.length - 12);
    const givenByMonth = {}, recvByMonth = {};
    db.loans.forEach((l) => { const k = monthKey(l.startDate); givenByMonth[k] = (givenByMonth[k] || 0) + Number(l.principal); });
    db.payments.forEach((p) => { const k = monthKey(p.date); recvByMonth[k] = (recvByMonth[k] || 0) + Number(p.amount); });
    // running totals as of the START of the window (so the line begins at the true cumulative, not zero)
    let baseGiven = 0, baseRecv = 0;
    Object.keys(givenByMonth).forEach((k) => { if (k < keys[0]) baseGiven += givenByMonth[k]; });
    Object.keys(recvByMonth).forEach((k) => { if (k < keys[0]) baseRecv += recvByMonth[k]; });
    let g = baseGiven, r = baseRecv;
    const points = keys.map((k) => {
      g += givenByMonth[k] || 0; r += recvByMonth[k] || 0;
      return { key: k, label: keyLabel(k), given: g, received: r, givenMonth: givenByMonth[k] || 0, receivedMonth: recvByMonth[k] || 0 };
    });
    return points.length >= 2 ? points : null;
  }

  /** Given vs received per borrower, top N by amount lent, rest folded into "Other". */
  function borrowerBars(db, E, n = 6) {
    const rows = db.borrowers.map((b) => {
      const ls = db.loans.filter((l) => l.borrowerId === b.id);
      const lent = ls.reduce((s, l) => s + Number(l.principal), 0);
      const paid = ls.reduce((s, l) => s + E.computeLoan(l, db.payments, E.todayStr()).totalPaid, 0);
      return { name: b.name, lent, paid };
    }).filter((r) => r.lent > 0).sort((a, b) => b.lent - a.lent);
    if (!rows.length) return [];
    const top = rows.slice(0, n);
    const rest = rows.slice(n);
    if (rest.length) top.push({ name: rest.length + ' other' + (rest.length > 1 ? 's' : ''), lent: rest.reduce((s, r) => s + r.lent, 0), paid: rest.reduce((s, r) => s + r.paid, 0) });
    return top;
  }

  function summary(db, E) {
    const t = E.todayStr(); let lent = 0, paid = 0, out = 0, interest = 0, active = 0, settled = 0, overpaid = 0;
    db.loans.forEach((l) => {
      const c = E.computeLoan(l, db.payments, t);
      lent += Number(l.principal); paid += c.totalPaid; interest += c.totalInterest;
      if (c.overpaid) overpaid++; else if (c.settled) settled++; else { active++; out += c.outstanding; }
    });
    return { lent: E.round2(lent), paid: E.round2(paid), out: E.round2(out), interest: E.round2(interest), active, settled, overpaid, loans: db.loans.length };
  }

  // ---------- SVG chart builders ----------
  const W = 320, H = 168, PAD = { l: 4, r: 4, t: 10, b: 22 };

  function trendChart(points) {
    if (!points) return '';
    const max = Math.max(1, ...points.map((p) => Math.max(p.given, p.received)));
    const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
    const x = (i) => PAD.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v) => PAD.t + innerH - (v / max) * innerH;
    const path = (key) => points.map((p, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1)).join(' ');
    const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
    const gridlines = ticks.map((v) => `<line class="dvgrid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="dvaxis" x="${PAD.l}" y="${(y(v) - 3).toFixed(1)}">${compact(v)}</text>`).join('');
    const lastI = points.length - 1;
    const hits = points.map((p, i) => {
      const bw = innerW / points.length;
      const bx = PAD.l + i * bw;
      return `<rect class="dvhit" data-i="${i}" x="${bx.toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent"/>`;
    }).join('');
    const xlabels = points.map((p, i) => (i === 0 || i === lastI || i === Math.floor(lastI / 2)) ? `<text class="dvaxis" x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === lastI ? 'end' : 'middle'}">${esc(p.label)}</text>` : '').join('');
    const dots = (key, cls) => points.map((p, i) => `<circle class="dvdot ${cls}" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3.5"/>`).join('');
    return `<div class="dvchart" data-kind="trend" data-points="${attrJSON(points)}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Amount given and received by month">
        ${gridlines}
        <path class="dvline given" d="${path('given')}" fill="none"/>
        <path class="dvline received" d="${path('received')}" fill="none"/>
        ${dots('given', 'given')}${dots('received', 'received')}
        <line class="dvcrosshair" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}" hidden/>
        ${xlabels}
        ${hits}
      </svg>
      <div class="dvtip" hidden></div>
    </div>
    <div class="dvlegend"><span class="dvkey line given"></span>Given<span class="dvkey line received"></span>Received</div>`;
  }

  function barChart(rows) {
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((r) => Math.max(r.lent, r.paid)));
    const rowH = 40;
    const chartH = rows.length * rowH;
    const barMaxW = 100; // percent basis, rendered with CSS width
    return `<div class="dvbars" data-kind="bars" data-rows="${attrJSON(rows)}" style="--rows:${rows.length}">
      ${rows.map((r, i) => `
        <div class="dvbarrow" data-i="${i}">
          <div class="dvbarname">${esc(r.name)}</div>
          <div class="dvbarpair">
            <div class="dvbartrack"><div class="dvbar given dvhit" data-i="${i}" style="width:${Math.max(2, (r.lent / max) * 100).toFixed(1)}%"></div></div>
            <div class="dvbartrack"><div class="dvbar received dvhit" data-i="${i}" style="width:${Math.max(2, (r.paid / max) * 100).toFixed(1)}%"></div></div>
          </div>
        </div>`).join('')}
      <div class="dvtip" hidden></div>
    </div>
    <div class="dvlegend"><span class="dvkey rect given"></span>Given<span class="dvkey rect received"></span>Received</div>`;
  }

  function meter(pct, label, sub) {
    const p = Math.max(0, Math.min(100, pct));
    return `<div class="dvmeter">
      <div class="dvmeter-head"><span>${esc(label)}</span><b>${pct.toFixed(0)}%</b></div>
      <div class="dvmeter-track"><div class="dvmeter-fill" style="width:${p}%"></div></div>
      ${sub ? `<div class="hint" style="margin-top:6px">${esc(sub)}</div>` : ''}
    </div>`;
  }

  function render(db, E) {
    const s = summary(db, E);
    if (!s.loans) {
      return `<div class="wrap"><div class="empty"><b>Nothing to show yet</b>Add a borrower and a loan, and this dashboard will fill in.</div></div>`;
    }
    const recoveryPct = s.lent > 0 ? (s.paid / s.lent) * 100 : 0;
    const trend = trendSeries(db);
    const bars = borrowerBars(db, E);
    return `<div class="wrap">
      <div class="kpirow">
        <div class="kpi"><div class="kpi-k">Total given</div><div class="kpi-v">${inr(s.lent)}</div></div>
        <div class="kpi"><div class="kpi-k">Total received</div><div class="kpi-v pos">${inr(s.paid)}</div></div>
        <div class="kpi"><div class="kpi-k">Outstanding</div><div class="kpi-v">${inr(s.out)}</div></div>
        <div class="kpi"><div class="kpi-k">Interest earned</div><div class="kpi-v">${inr(s.interest)}</div></div>
      </div>
      <div class="card">${meter(recoveryPct, 'Received back so far', s.active + ' active · ' + s.settled + ' settled' + (s.overpaid ? ' · ' + s.overpaid + ' overpaid' : ''))}</div>
      ${trend ? `<div class="card"><h2>Given vs received, by month</h2>${trendChart(trend)}</div>` : `<div class="card"><h2>Given vs received, by month</h2><div class="hint">Spanning a few more weeks will start a trend line here.</div></div>`}
      ${bars.length ? `<div class="card"><h2>By borrower</h2>${barChart(bars)}</div>` : ''}
    </div>`;
  }

  function fmtTip(html, x, y, root) {
    const tip = root.querySelector('.dvtip');
    if (!tip) return;
    tip.innerHTML = html; tip.hidden = false;
    const bw = root.getBoundingClientRect().width;
    let left = x; const tw = 150;
    left = Math.max(4, Math.min(bw - tw - 4, left - tw / 2));
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, y - 12) + 'px';
  }

  function mount(root) {
    root.querySelectorAll('.dvchart[data-kind="trend"]').forEach((chart) => {
      const svg = chart.querySelector('svg'); const cross = chart.querySelector('.dvcrosshair'); const tip = chart.querySelector('.dvtip');
      const pts = JSON.parse(chart.dataset.points || 'null');
      if (!pts) return;
      const hide = () => { tip.hidden = true; cross.hidden = true; chart.querySelectorAll('.dvdot').forEach((d) => d.classList.remove('hi')); };
      chart.addEventListener('pointerleave', hide);
      chart.addEventListener('pointermove', (e) => {
        const hit = e.target.closest('.dvhit'); if (!hit) return;
        const i = +hit.dataset.i; const p = pts[i]; if (!p) return;
        const cx = hit.x.baseVal.value + hit.width.baseVal.value / 2;
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.hidden = false;
        chart.querySelectorAll('.dvdot').forEach((d) => d.classList.toggle('hi', +d.dataset.i === i));
        const rect = svg.getBoundingClientRect();
        const px = (cx / W) * rect.width;
        fmtTip(`<b>${p.label}</b><div class="dvtiprow"><span class="dvkey line given"></span>Given<b>${inr(p.given)}</b></div><div class="dvtiprow"><span class="dvkey line received"></span>Received<b>${inr(p.received)}</b></div>`, px, 0, chart);
      });
    });
    root.querySelectorAll('.dvbars[data-kind="bars"]').forEach((box) => {
      const rows = JSON.parse(box.dataset.rows || 'null'); if (!rows) return;
      const tip = box.querySelector('.dvtip');
      box.addEventListener('pointerleave', () => { tip.hidden = true; });
      box.addEventListener('pointermove', (e) => {
        const hit = e.target.closest('.dvhit'); if (!hit) { tip.hidden = true; return; }
        const i = +hit.dataset.i; const r = rows[i]; if (!r) return;
        const br = hit.getBoundingClientRect(); const bb = box.getBoundingClientRect();
        fmtTip(`<b>${esc(r.name)}</b><div class="dvtiprow"><span class="dvkey rect given"></span>Given<b>${inr(r.lent)}</b></div><div class="dvtiprow"><span class="dvkey rect received"></span>Received<b>${inr(r.paid)}</b></div>`, br.left - bb.left + br.width / 2, br.top - bb.top, box);
      });
    });
  }

  root.Dashboard = { render, mount, trendSeries, borrowerBars, summary };
})(typeof window !== 'undefined' ? window : globalThis);
