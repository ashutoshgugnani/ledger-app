/* Per-borrower statement (PDF) — built with jsPDF + autoTable, entirely on-device. */
(function (root) {
  'use strict';
  const E = root.Engine;
  if (root.applyPlugin && root.jspdf && root.jspdf.jsPDF) root.applyPlugin(root.jspdf.jsPDF);

  const inr = (n, d = 2) => (n < 0 ? '-Rs. ' : 'Rs. ') + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fdate = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; };
  const rateText = (l) => Number(l.rate) + '% per ' + (l.rateUnit === 'year' ? 'year' : 'month') + ' (compounded monthly)';
  const maskedId = (b) => (b.idNumber ? '•••• ' + b.idNumber.slice(-4) : '—');

  const INK = [22, 32, 28], MUTED = [110, 120, 114], LINE = [223, 227, 222], ACCENT = [15, 92, 71], BAD = [179, 38, 30], OK = [27, 122, 79], SOFT = [242, 246, 243];

  function buildBorrowerStatement(borrower, loans, payments, opts) {
    opts = opts || {};
    const { jsPDF } = root.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const M = 40;
    let y = 44;
    const today = E.todayStr();

    function header() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...INK);
      doc.text('Loan statement', M, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
      doc.text('Generated ' + fdate(today), pageW - M, y - 4, { align: 'right' });
      y += 18;
      doc.setDrawColor(...LINE); doc.setLineWidth(1); doc.line(M, y, pageW - M, y);
      y += 22;
    }
    function footer() {
      const n = doc.internal.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
        doc.text('Informal statement, not a legal or bank document. Page ' + i + ' of ' + n, M, doc.internal.pageSize.getHeight() - 22);
      }
    }
    function ensure(h) { if (y + h > doc.internal.pageSize.getHeight() - 46) { doc.addPage(); y = 44; } }

    header();

    // ---- borrower block ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(borrower.name, M, y); y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    const lines = [];
    if (borrower.phone) lines.push('Phone: ' + borrower.phone);
    if (borrower.address) lines.push('Address: ' + borrower.address);
    if (borrower.idType) lines.push(borrower.idType + ': ' + maskedId(borrower));
    lines.forEach((t) => { const wrapped = doc.splitTextToSize(t, pageW - M * 2); doc.text(wrapped, M, y); y += 12 * wrapped.length; });
    y += 6;

    // ---- overall summary ----
    const t = today;
    const calc = loans.map((l) => ({ l, c: E.computeLoan(l, payments, t) }));
    const totLent = calc.reduce((s, x) => s + Number(x.l.principal), 0);
    const totPaid = calc.reduce((s, x) => s + x.c.totalPaid, 0);
    const totInterest = calc.reduce((s, x) => s + x.c.totalInterest, 0);
    const totOut = calc.reduce((s, x) => s + Math.max(x.c.outstanding, 0), 0);

    ensure(70);
    const boxW = (pageW - M * 2 - 24) / 4;
    const stats = [['Total given', inr(totLent, 0)], ['Total received', inr(totPaid, 0)], ['Interest earned', inr(totInterest, 0)], ['Outstanding today', inr(totOut, 0)]];
    doc.setFillColor(...SOFT); doc.roundedRect(M, y, pageW - M * 2, 50, 6, 6, 'F');
    stats.forEach((s, i) => {
      const bx = M + 12 + i * boxW;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(s[0], bx, y + 18);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...INK); doc.text(s[1], bx, y + 35);
    });
    y += 68;

    // ---- per-loan detail ----
    calc.forEach(({ l, c }, idx) => {
      ensure(60);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...INK);
      doc.text('Loan ' + (idx + 1) + ' — given ' + fdate(l.startDate), M, y); y += 4;
      const chipTxt = c.overpaid ? 'OVERPAID' : c.settled ? 'SETTLED' : 'ACTIVE';
      const chipCol = c.overpaid ? BAD : c.settled ? MUTED : ACCENT;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...chipCol);
      doc.text(chipTxt, pageW - M, y - 8, { align: 'right' });
      y += 12;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
      doc.text('Principal ' + inr(Number(l.principal), 0) + '   ·   ' + rateText(l) + (l.notes ? '   ·   ' + l.notes : ''), M, y);
      y += 14;

      const body = c.ledger.map((r) => {
        const change = r.type === 'payment' ? '- ' + inr(r.amount) : r.type === 'interest' ? '+ ' + inr(r.amount) : inr(r.amount);
        const desc = r.type === 'payment' ? 'Payment received' + (r.mode ? ' (' + r.mode + ')' : '') + (r.note ? ' — ' + r.note : '') : r.label;
        return [fdate(r.date), desc, change, inr(r.balanceAfter)];
      });
      doc.autoTable({
        startY: y, margin: { left: M, right: M },
        head: [['Date', 'Entry', 'Amount', 'Balance owed']],
        body,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: { top: 4, bottom: 4, left: 4, right: 4 }, lineColor: LINE, lineWidth: 0.5 },
        headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 8, fillColor: false },
        columnStyles: { 0: { cellWidth: 62 }, 2: { halign: 'right', cellWidth: 78 }, 3: { halign: 'right', cellWidth: 90 } },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 2) {
            const raw = data.cell.raw;
            data.cell.styles.textColor = raw.startsWith('-') ? OK : raw.startsWith('+') ? MUTED : INK;
          }
        },
        didDrawPage() { y = 44; },
      });
      y = doc.lastAutoTable.finalY + 10;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text((c.overpaid ? 'Overpaid by ' : 'Owed as of ' + fdate(today) + ': ') + inr(Math.abs(c.outstanding)), M, y);
      y += 22;
    });

    footer();
    return doc;
  }

  root.Statement = { buildBorrowerStatement };
})(typeof window !== 'undefined' ? window : globalThis);
