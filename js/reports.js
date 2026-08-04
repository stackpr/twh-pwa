// reports.js — the three reports, computed from the canonical ledger.
//
// Every displayed figure traces to a sum over `ledger.legs` with a filter.
// Sign is flipped in exactly one place: sectionSign().

import { CATEGORY_ORDER } from './config.js';
import { isPseudoAccount } from './ledger.js';

const sectionSign = isRevenue => (isRevenue ? 1 : -1);
const sameOrBefore = (d, asOf) => d <= asOf;
const monthKey = d => `${d.getFullYear()}-${d.getMonth() + 1}`;
const monthLabel = d => d.toLocaleString('en-US', { month: 'short', year: '2-digit' });

/* ------------------------------------------------------------------ */
/* Balance Sheet                                                       */
/* ------------------------------------------------------------------ */

/**
 * The balance sheet reflects EVERY recorded transaction, not only those dated
 * on or before `asOf`. This is deliberate. TWH dates an event pre-charge to the
 * event date, so a scout charged today for a September campout produces a
 * future-dated row that has nonetheless already moved their account balance.
 * Filtering those out would understate liabilities and would contradict the
 * "Other Future Events (Net)" line, which is by definition about future dates.
 *
 * The consequence is that a true historical balance sheet cannot be recomputed
 * from the ledger: a future-dated pre-charge is indistinguishable from a
 * back-dated correction. That is exactly what snapshots are for. `asOf` labels
 * the report and drives the future/past event split; it does not filter legs.
 */
export function balanceSheet(ledger, cfg, asOf) {
  const { accountClass, params } = cfg;
  const legacy = params.legacyMode;

  const accountBal = new Map();
  const personBal = new Map();
  for (const l of ledger.legs) {
    const target = l.kind === 'asset' ? accountBal : l.kind === 'person' ? personBal : null;
    if (!target) continue;
    target.set(l.key, (target.get(l.key) || 0) + l.amount);
  }

  const byClass = cls => [...accountBal.entries()]
    .filter(([k]) => accountClass[k] === cls)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Assets are presented as one section: cash and non-cash accounts together,
  // totalling to Total Assets. The `noncash` classification does not move a line
  // out of the section; it only marks the amount for deduction from unrestricted
  // net assets, since inventory can't be spent.
  const cash = byClass('cash');
  const noncash = byClass('noncash');
  const assets = [...cash, ...noncash].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const liabilityAccounts = byClass('liability').map(([k, v]) => [k, -v]);

  const totalAssets = assets.reduce((s, [, v]) => s + v, 0);
  const totalNoncash = noncash.reduce((s, [, v]) => s + v, 0);

  // --- scout balances ---
  const pseudo = [...personBal.entries()].filter(([k]) => isPseudoAccount(k))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const scouts = [...personBal.entries()].filter(([k]) => !isPseudoAccount(k));

  let prepaid, arrearsTotal, arrearsCount, netScout;
  if (legacy) {
    // Reproduces the spreadsheet-era treatment: prepaid fees are all person legs
    // minus a hand-maintained list of troop-held accounts. Any pseudo-account
    // missing from that list gets double-counted — the classic defect. Arrears
    // are counted across every account, pseudo ones included.
    const allPersons = [...personBal.values()].reduce((s, v) => s + v, 0);
    const deducted = (params.legacyDeductedAccounts || [])
      .reduce((s, k) => s + (personBal.get(k) || 0), 0);
    prepaid = allPersons - deducted;
    const neg = [...personBal.entries()].filter(([, v]) => v < -0.005);
    arrearsCount = neg.length;
    arrearsTotal = neg.reduce((s, [, v]) => s + v, 0);
    netScout = prepaid + arrearsTotal;   // arrears counted twice, as in the original
  } else {
    prepaid = scouts.filter(([, v]) => v > 0).reduce((s, [, v]) => s + v, 0);
    const neg = scouts.filter(([, v]) => v < -0.005);
    arrearsCount = neg.length;
    arrearsTotal = neg.reduce((s, [, v]) => s + v, 0);
    netScout = prepaid + arrearsTotal;   // == total scout net obligation
  }

  // --- deferred revenue on events that haven't happened yet ---
  const futureEvents = ledger.events.filter(e => e.date && e.date > asOf);
  const otherFutureEventsNet = futureEvents.reduce((s, e) => s + e.allTimeNet, 0);

  const totalLiabilities =
    liabilityAccounts.reduce((s, [, v]) => s + v, 0) +
    otherFutureEventsNet +
    pseudo.reduce((s, [, v]) => s + v, 0);

  const unrestricted = totalAssets - netScout - totalLiabilities - totalNoncash;
  const twhComparison = unrestricted + otherFutureEventsNet + arrearsTotal;

  return {
    asOf,
    assets, totalAssets,
    noncash, totalNoncash,
    prepaid, arrearsCount, arrearsTotal, netScout,
    liabilityAccounts, otherFutureEventsNet, pseudo, totalLiabilities,
    unrestricted, twhComparison,
    futureEventNames: futureEvents.map(e => e.name).sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Event Income                                                        */
/* ------------------------------------------------------------------ */

export function selectEventColumns(ledger, cfg, asOf, since) {
  const active = since
    ? new Set(ledger.legs.filter(l => l.kind === 'fund' && l.event && l.date >= since).map(l => l.event))
    : null;
  const withActivity = ledger.events
    .filter(e => e.kind === 'program' && e.date)
    .filter(e => !active || active.has(e.name));
  const future = withActivity.filter(e => e.date > asOf).sort((a, b) => a.date - b.date);
  const pastAll = withActivity.filter(e => e.date <= asOf).sort((a, b) => b.date - a.date);
  const past = pastAll.slice(0, Math.max(0, cfg.params.pastEventsShown));
  return { future, past, pastOmitted: pastAll.length - past.length };
}

export function eventIncome(ledger, cfg, asOf) {
  const since = new Date(cfg.params.activitySince + 'T00:00:00');
  const { future, past, pastOmitted } = selectEventColumns(ledger, cfg, asOf, since);
  const columns = [...future, ...past];
  const colIndex = new Map(columns.map((e, ix) => [e.name, ix]));

  // fund -> { total, other, cols[] }  (all values are raw signed leg sums)
  const acc = new Map();
  const bucket = fund => {
    if (!acc.has(fund)) acc.set(fund, { total: 0, cols: new Array(columns.length).fill(0) });
    return acc.get(fund);
  };

  // "Total" is the period total: activity on or after the activity-since date,
  // including future-dated pre-charges. Anything earlier belongs to the prior
  // period and is reported on its own line, not folded into Total.
  for (const l of ledger.legs) {
    if (l.kind !== 'fund') continue;
    if (l.date < since) continue;
    const b = bucket(l.key);
    b.total += l.amount;
    if (l.event && colIndex.has(l.event)) {
      b.cols[colIndex.get(l.event)] += l.amount;
    }
  }
  for (const b of acc.values()) b.other = b.total - b.cols.reduce((s, v) => s + v, 0);

  // Prior-period net income per column: all-time event net minus current-period net.
  const priorPeriod = columns.map(e => {
    let current = 0;
    for (const l of ledger.legs) {
      if (l.kind === 'fund' && l.event === e.name && l.date >= since) current += l.amount;
    }
    return e.allTimeNet - current;
  });

  const sections = CATEGORY_ORDER.map(({ key, isRevenue }) => {
    const sign = sectionSign(isRevenue);
    const funds = [...acc.entries()]
      .filter(([f]) => cfg.fundCategories[f] === key)
      .filter(([, b]) => Math.abs(b.total) > 0.005 || b.cols.some(v => Math.abs(v) > 0.005))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([f, b]) => ({
        label: f,
        total: sign * b.total,
        other: sign * b.other,
        cols: b.cols.map(v => sign * v),
      }));
    return { key, isRevenue, funds, subtotal: sumRows(funds, columns.length) };
  });

  const netOf = (...keys) => {
    const rows = sections.filter(s => keys.includes(s.key));
    const signOf = s => (s.isRevenue ? 1 : -1);
    const total = rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.total, 0);
    const other = rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.other, 0);
    const cols = columns.map((_, i) =>
      rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.cols[i], 0));
    return { total, other, cols };
  };

  const netProgram = netOf('Program Revenue', 'Program Expenses');
  const netFundraising = netOf('Fundraising Revenue', 'Fundraising Expenses');
  const netOther = netOf('Other Income', 'Other Expenses');
  const netTotal = {
    total: netProgram.total + netFundraising.total + netOther.total,
    other: netProgram.other + netFundraising.other + netOther.other,
    cols: columns.map((_, i) => netProgram.cols[i] + netFundraising.cols[i] + netOther.cols[i]),
  };

  const futureCount = future.length;
  const futureTotal = netTotal.cols.slice(0, futureCount).reduce((s, v) => s + v, 0);

  return {
    asOf, since, columns, futureCount, pastOmitted, priorPeriod,
    sections, netProgram, netFundraising, netOther, netTotal,
    futureTotal, exclFuture: netTotal.total - futureTotal,
  };
}

function sumRows(rows, ncols) {
  return {
    total: rows.reduce((s, r) => s + r.total, 0),
    other: rows.reduce((s, r) => s + r.other, 0),
    cols: Array.from({ length: ncols }, (_, i) => rows.reduce((s, r) => s + r.cols[i], 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Monthly Income                                                      */
/* ------------------------------------------------------------------ */

export function monthlyIncome(ledger, cfg, asOf) {
  const n = cfg.params.monthsShown;
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: monthLabel(d), date: d });
  }
  const mIndex = new Map(months.map((m, i) => [m.key, i]));

  const acc = new Map();
  const bucket = fund => {
    if (!acc.has(fund)) acc.set(fund, { cols: new Array(months.length).fill(0), allTime: 0 });
    return acc.get(fund);
  };
  for (const l of ledger.legs) {
    if (l.kind !== 'fund') continue;
    const b = bucket(l.key);
    b.allTime += l.amount;
    const ix = mIndex.get(monthKey(l.date));
    if (ix !== undefined) b.cols[ix] += l.amount;
  }

  const sections = CATEGORY_ORDER.map(({ key, isRevenue }) => {
    const sign = sectionSign(isRevenue);
    const funds = [...acc.entries()]
      .filter(([f]) => cfg.fundCategories[f] === key)
      .filter(([, b]) => b.cols.some(v => Math.abs(v) > 0.005))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([f, b]) => ({
        label: f,
        cols: b.cols.map(v => sign * v),
        total: sign * b.cols.reduce((s, v) => s + v, 0),
        allTime: sign * b.allTime,
      }));
    const subtotal = {
      cols: months.map((_, i) => funds.reduce((s, r) => s + r.cols[i], 0)),
      total: funds.reduce((s, r) => s + r.total, 0),
      allTime: funds.reduce((s, r) => s + r.allTime, 0),
    };
    return { key, isRevenue, funds, subtotal };
  });

  const netOf = keys => {
    const rows = sections.filter(s => keys.includes(s.key));
    const sg = s => (s.isRevenue ? 1 : -1);
    return {
      cols: months.map((_, i) => rows.reduce((s, sec) => s + sg(sec) * sec.subtotal.cols[i], 0)),
      total: rows.reduce((s, sec) => s + sg(sec) * sec.subtotal.total, 0),
    };
  };
  const netProgram = netOf(['Program Revenue', 'Program Expenses']);
  const netFundraising = netOf(['Fundraising Revenue', 'Fundraising Expenses']);
  const netOther = netOf(['Other Income', 'Other Expenses']);
  const netTotal = {
    cols: months.map((_, i) => netProgram.cols[i] + netFundraising.cols[i] + netOther.cols[i]),
    total: netProgram.total + netFundraising.total + netOther.total,
  };

  const allTimeNet = sections.reduce((s, sec) => s + (sec.isRevenue ? 1 : -1) * sec.subtotal.allTime, 0);

  return { asOf, months, sections, netProgram, netFundraising, netOther, netTotal, allTimeNet };
}
