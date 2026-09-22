/* Excel backup (export) and restore (import) using SheetJS. */
(function (root) {
  'use strict';
  const XL = root.XLSX;

  const unitLabel = (u) => (u === 'year' ? 'Per year' : 'Per month');
  const MONEY = '#,##0.00';

  function styleCols(ws, cols, fmt, fromRow) {
    const ref = XL.utils.decode_range(ws['!ref']);
    for (let r = fromRow; r <= ref.e.r; r++) {
      for (const c of cols) {
        const cell = ws[XL.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') cell.z = fmt;
      }
    }
  }
  function widths(ws, w) { ws['!cols'] = w.map((x) => ({ wch: x })); }

  /** Build the .xlsx as an ArrayBuffer. */
  function build(db, E) {
    const today = E.todayStr();
    const wb = XL.utils.book_new();
    const borrowers = [...db.borrowers].sort((a, b) => a.name.localeCompare(b.name));
    const nameOf = Object.fromEntries(db.borrowers.map((b) => [b.id, b.name]));
    const calc = new Map(db.loans.map((l) => [l.id, E.computeLoan(l, db.payments, today)]));

    // --- Summary ---
    const rows = [
      ['LEDGER BACKUP'],
      ['Backup date', today],
      ['Amounts calculated as of', today],
      ['This file contains ID numbers. Keep it only on the pendrive or another safe place.'],
      [],
      ['Borrower', 'Phone', 'Loans', 'Total lent', 'Total paid', 'Outstanding today'],
    ];
    let tLent = 0, tPaid = 0, tOut = 0;
    for (const b of borrowers) {
      const ls = db.loans.filter((l) => l.borrowerId === b.id);
      const lent = ls.reduce((s, l) => s + Number(l.principal), 0);
      const paid = ls.reduce((s, l) => s + calc.get(l.id).totalPaid, 0);
      const out = ls.reduce((s, l) => s + Math.max(calc.get(l.id).outstanding, 0), 0);
      tLent += lent; tPaid += paid; tOut += out;
      rows.push([b.name, b.phone, ls.length, E.round2(lent), E.round2(paid), E.round2(out)]);
    }
    rows.push([], ['TOTAL', '', db.loans.length, E.round2(tLent), E.round2(tPaid), E.round2(tOut)]);
    const wsS = XL.utils.aoa_to_sheet(rows);
    widths(wsS, [30, 16, 8, 16, 16, 20]);
    styleCols(wsS, [3, 4, 5], MONEY, 5);
    XL.utils.book_append_sheet(wb, wsS, 'Summary');

    // --- Borrowers ---
    const bRows = [['Borrower ID', 'Name', 'Phone', 'Address', 'ID Type', 'ID Number', 'Notes', 'Added On']];
    for (const b of borrowers) bRows.push([b.id, b.name, b.phone, b.address || '', b.idType || '', b.idNumber || '', b.notes || '', (b.createdAt || '').slice(0, 10)]);
    const wsB = XL.utils.aoa_to_sheet(bRows);
    widths(wsB, [12, 28, 16, 40, 16, 20, 30, 12]);
    XL.utils.book_append_sheet(wb, wsB, 'Borrowers');

    // --- Loans ---
    const lRows = [['Loan ID', 'Borrower ID', 'Borrower', 'Principal', 'Rate', 'Rate Unit', 'Start Date', 'Notes', 'Total Paid', 'Interest To Date', 'Outstanding', 'Status']];
    const loans = [...db.loans].sort((a, b) => (nameOf[a.borrowerId] || '').localeCompare(nameOf[b.borrowerId] || '') || a.startDate.localeCompare(b.startDate));
    for (const l of loans) {
      const c = calc.get(l.id);
      lRows.push([l.id, l.borrowerId, nameOf[l.borrowerId] || '', Number(l.principal), Number(l.rate), unitLabel(l.rateUnit), l.startDate, l.notes || '',
        c.totalPaid, c.totalInterest, c.outstanding, c.overpaid ? 'Overpaid' : c.settled ? 'Settled' : 'Active']);
    }
    const wsL = XL.utils.aoa_to_sheet(lRows);
    widths(wsL, [12, 12, 26, 14, 8, 11, 12, 30, 14, 16, 14, 10]);
    styleCols(wsL, [3, 8, 9, 10], MONEY, 1);
    XL.utils.book_append_sheet(wb, wsL, 'Loans');

    // --- Payments ---
    const loanById = Object.fromEntries(db.loans.map((l) => [l.id, l]));
    const pRows = [['Payment ID', 'Loan ID', 'Borrower', 'Date', 'Amount', 'Mode', 'Note']];
    const pays = [...db.payments].sort((a, b) => a.date.localeCompare(b.date));
    for (const p of pays) {
      const l = loanById[p.loanId];
      pRows.push([p.id, p.loanId, l ? nameOf[l.borrowerId] || '' : '', p.date, Number(p.amount), p.mode || '', p.note || '']);
    }
    const wsP = XL.utils.aoa_to_sheet(pRows);
    widths(wsP, [12, 12, 26, 12, 14, 14, 30]);
    styleCols(wsP, [4], MONEY, 1);
    XL.utils.book_append_sheet(wb, wsP, 'Payments');

    return XL.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  // ---------- restore ----------
  function num(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[₹,\s]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  function normDate(v) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // Excel serial
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // dd/mm/yyyy
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return null;
  }
  const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

  function parse(buf) {
    const wb = XL.read(buf, { type: 'array' });
    const sheet = (n) => {
      const ws = wb.Sheets[n];
      if (!ws) throw new Error('This does not look like a Ledger backup (sheet "' + n + '" is missing).');
      return XL.utils.sheet_to_json(ws, { defval: '', raw: true });
    };
    const problems = [];
    const borrowers = [];
    const ids = new Set();
    for (const r of sheet('Borrowers')) {
      const id = str(r['Borrower ID']); const name = str(r['Name']);
      if (!id || !name) continue;
      ids.add(id);
      borrowers.push({ id, name, phone: str(r['Phone']), address: str(r['Address']), idType: str(r['ID Type']), idNumber: str(r['ID Number']),
        notes: str(r['Notes']), photos: [], createdAt: (normDate(r['Added On']) || new Date().toISOString().slice(0, 10)) + 'T00:00:00.000Z' });
    }
    const loans = [];
    const loanIds = new Set();
    for (const r of sheet('Loans')) {
      const id = str(r['Loan ID']); if (!id) continue;
      const borrowerId = str(r['Borrower ID']);
      const principal = num(r['Principal']); const rate = num(r['Rate']); const startDate = normDate(r['Start Date']);
      if (!ids.has(borrowerId) || !(principal > 0) || !Number.isFinite(rate) || !startDate) { problems.push('Loan ' + id + ' skipped (incomplete row)'); continue; }
      loanIds.add(id);
      loans.push({ id, borrowerId, principal, rate, rateUnit: /year|annum|yr/i.test(str(r['Rate Unit'])) ? 'year' : 'month', startDate, notes: str(r['Notes']), createdAt: startDate + 'T00:00:00.000Z' });
    }
    const payments = [];
    for (const r of sheet('Payments')) {
      const id = str(r['Payment ID']); const loanId = str(r['Loan ID']);
      const amount = num(r['Amount']); const date = normDate(r['Date']);
      if (!id) continue;
      if (!loanIds.has(loanId) || !(amount > 0) || !date) { problems.push('Payment ' + id + ' skipped (incomplete row)'); continue; }
      payments.push({ id, loanId, date, amount, mode: str(r['Mode']), note: str(r['Note']) });
    }
    if (!borrowers.length) throw new Error('No borrowers found in this file.');
    return { borrowers, loans, payments, problems };
  }

  root.Backup = { build, parse };
})(typeof window !== 'undefined' ? window : globalThis);
