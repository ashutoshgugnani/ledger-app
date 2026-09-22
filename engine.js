/* Interest engine — monthly compounding with daily proration.
 *
 * Rules
 *  - A loan has a start date. Interest periods are the monthly anniversaries of
 *    the start date (15 Jan -> 15 Feb -> 15 Mar ...; day is clamped to month end).
 *  - Monthly rate: "month" unit = rate% per month; "year" unit = rate% / 12 per month.
 *  - Within a period interest accrues day by day on the balance (rate * days/daysInPeriod).
 *  - On each anniversary the accrued interest is added to the balance (compounding).
 *  - A payment first clears interest accrued so far, then reduces the balance.
 *  - Outstanding on any date = balance + interest accrued so far in the current period.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;

  // ---- date helpers (dates are 'YYYY-MM-DD' strings, handled as UTC day numbers) ----
  function toDayNum(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY);
  }
  function fromDayNum(n) {
    const dt = new Date(n * DAY);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // n-th monthly anniversary of a start date, clamped to the end of shorter months
  function addMonths(startStr, n) {
    const [y, m, d] = startStr.slice(0, 10).split('-').map(Number);
    const total = (m - 1) + n;
    const ty = y + Math.floor(total / 12);
    const tm = ((total % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return Math.round(Date.UTC(ty, tm, Math.min(d, lastDay)) / DAY);
  }
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  function monthlyRate(loan) {
    const r = Number(loan.rate) / 100;
    return loan.rateUnit === 'year' ? r / 12 : r;
  }

  /**
   * Compute a loan's position as of a date.
   * @returns {{outstanding, balance, accrued, principal, totalPaid, totalInterest,
   *            monthsCompleted, ledger, overpaid, settled, nextCapitalisation}}
   */
  function computeLoan(loan, payments, asOfStr) {
    const asOf = toDayNum(asOfStr || todayStr());
    const start = toDayNum(loan.startDate);
    const r = monthlyRate(loan);
    const principal = Number(loan.principal);

    const pays = (payments || [])
      .filter((p) => p.loanId === loan.id && toDayNum(p.date) <= asOf)
      .sort((a, b) => toDayNum(a.date) - toDayNum(b.date) || (a.id > b.id ? 1 : -1));

    const ledger = [];
    if (asOf < start) {
      return { outstanding: principal, balance: principal, accrued: 0, principal, totalPaid: 0,
        totalInterest: 0, monthsCompleted: 0, ledger, overpaid: false, settled: false,
        notStarted: true, nextCapitalisation: fromDayNum(addMonths(loan.startDate, 1)) };
    }

    let bal = principal;
    let acc = 0;
    let cursor = start;
    let k = 0; // completed periods
    let periodStart = start;
    let periodEnd = addMonths(loan.startDate, 1);
    let totalPaid = 0;
    let interestCapitalised = 0;

    ledger.push({ type: 'loan', date: fromDayNum(start), amount: principal, balanceAfter: principal, label: 'Loan given' });

    function accrueTo(target) {
      while (cursor < target) {
        const step = Math.min(target, periodEnd);
        const days = step - cursor;
        const base = bal > 0 ? bal : 0;
        acc += base * r * days / (periodEnd - periodStart);
        cursor = step;
        if (cursor === periodEnd) {
          const cap = round2(acc);
          bal = round2(bal + cap);
          interestCapitalised += cap;
          k += 1;
          ledger.push({ type: 'interest', date: fromDayNum(cursor), amount: cap, balanceAfter: bal, label: 'Month ' + k + ' interest added' });
          acc = 0;
          periodStart = periodEnd;
          periodEnd = addMonths(loan.startDate, k + 1);
        }
      }
    }

    for (const p of pays) {
      const pd = Math.max(toDayNum(p.date), start);
      accrueTo(pd);
      const amt = Number(p.amount);
      const toInterest = Math.min(amt, Math.max(acc, 0));
      acc -= toInterest;
      bal = round2(bal - (amt - toInterest));
      totalPaid += amt;
      ledger.push({ type: 'payment', date: p.date, amount: amt, balanceAfter: round2(bal + acc), label: 'Payment received', id: p.id, note: p.note, mode: p.mode });
    }
    accrueTo(asOf);

    const outstanding = round2(bal + acc);
    // interest generated so far (paid or not) = what is owed + what was paid - what was lent
    const totalInterest = round2(outstanding + totalPaid - principal);
    return {
      outstanding,
      balance: round2(bal),
      accrued: round2(acc),
      principal,
      totalPaid: round2(totalPaid),
      totalInterest,
      monthsCompleted: k,
      ledger,
      overpaid: outstanding < -0.005,
      settled: Math.abs(outstanding) < 0.5 || outstanding < 0,
      nextCapitalisation: fromDayNum(periodEnd),
    };
  }

  const api = { computeLoan, monthlyRate, toDayNum, fromDayNum, todayStr, addMonths, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
