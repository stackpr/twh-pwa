// reports.js — the three reports, computed from the canonical ledger.
//
// Every displayed figure traces to a sum over `ledger.legs` with a filter.
// Sign is flipped in exactly one place: sectionSign().

import {
  CATEGORY_ORDER, NET_LINES, categoriesInGroup,
  fiscalYearOf, fiscalYearStartDate, fiscalYearLabel, budgetFor, sectionBudget,
} from './config.js';
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
  const { accountClass } = cfg;

  // Every account in the chart starts at zero, whether or not the export
  // touched it. An account a troop has configured is an account it holds, and
  // "we hold this and it is empty" is a different statement from silence — a
  // dormant savings account missing from the balance sheet reads as one nobody
  // remembered, which is the reading this app exists to make impossible. It
  // also makes the snapshot complete: a capture writes a figure for every
  // account, so the historical columns cannot go blank the year an account
  // happens to sit idle. Troop-held (`_`) accounts cannot be seeded the same
  // way — they are not in the chart, so there is no list of them to read.
  const accountBal = new Map(Object.keys(accountClass).map(k => [k, 0]));
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

  // Prepaid fees are what the scouts are collectively in credit for, arrears
  // what they are collectively behind on, and the two are kept apart because a
  // troop with 16,000 prepaid and 900 in arrears is in a different position
  // from one holding 15,100 evenly. Troop-held funds are excluded from both:
  // they sit under Liabilities on their own lines and counting them here as
  // well would double them.
  const prepaid = scouts.filter(([, v]) => v > 0).reduce((s, [, v]) => s + v, 0);
  const inArrears = scouts.filter(([, v]) => v < -0.005);
  const arrearsCount = inArrears.length;
  const arrearsTotal = inArrears.reduce((s, [, v]) => s + v, 0);
  const netScout = prepaid + arrearsTotal;   // == total scout net obligation

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
  const futureAll = withActivity.filter(e => e.date > asOf).sort((a, b) => a.date - b.date);
  const pastAll = withActivity.filter(e => e.date <= asOf).sort((a, b) => b.date - a.date);
  const past = pastAll.slice(0, Math.max(0, cfg.params.pastEventsShown));
  const future = futureAll.slice(0, Math.max(0, cfg.params.futureEventsShown));
  return {
    future, past, futureAll,
    pastOmitted: pastAll.length - past.length,
    futureOmitted: futureAll.length - future.length,
  };
}

export function eventIncome(ledger, cfg, asOf) {
  const since = new Date(cfg.params.activitySince + 'T00:00:00');
  const { future, past, futureAll, pastOmitted, futureOmitted } = selectEventColumns(ledger, cfg, asOf, since);
  const columns = [...future, ...past];
  const colIndex = new Map(columns.map((e, ix) => [e.name, ix]));
  // The Future column is every event still to come, whether or not it got a
  // column of its own. Limiting the columns is a page-fit control, and a
  // page-fit control that moved money into Other would be changing the figures
  // to fit the paper.
  const futureNames = new Set(futureAll.map(e => e.name));

  // fund -> { total, other, cols[] }  (all values are raw signed leg sums)
  const acc = new Map();
  const bucket = fund => {
    if (!acc.has(fund)) acc.set(fund, { total: 0, future: 0, cols: new Array(columns.length).fill(0) });
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
    if (l.event && futureNames.has(l.event)) b.future += l.amount;
    if (l.event && colIndex.has(l.event)) {
      b.cols[colIndex.get(l.event)] += l.amount;
    }
  }
  // Other is what is left of the period once the future events and the past
  // events with columns are taken out: non-event activity, plus any past event
  // whose column was trimmed for the page.
  for (const b of acc.values()) {
    const shownPast = b.cols.slice(future.length).reduce((s, v) => s + v, 0);
    b.other = b.total - b.future - shownPast;
  }

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
        future: sign * b.future,
        cols: b.cols.map(v => sign * v),
      }));
    return { key, isRevenue, funds, subtotal: sumRows(funds, columns.length) };
  });

  const netOf = (...keys) => {
    const rows = sections.filter(s => keys.includes(s.key));
    const signOf = s => (s.isRevenue ? 1 : -1);
    const total = rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.total, 0);
    const other = rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.other, 0);
    const future = rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.future, 0);
    const cols = columns.map((_, i) =>
      rows.reduce((s, sec) => s + signOf(sec) * sec.subtotal.cols[i], 0));
    return { total, other, future, cols };
  };

  // One net line per group, in CATEGORY_ORDER's order, so adding a category to
  // a group changes what nets without changing anything here.
  const nets = NET_LINES.map(({ group, label }) =>
    ({ group, label, ...netOf(...categoriesInGroup(group)) }));
  const netTotal = {
    total: nets.reduce((s, n) => s + n.total, 0),
    other: nets.reduce((s, n) => s + n.other, 0),
    future: nets.reduce((s, n) => s + n.future, 0),
    cols: columns.map((_, i) => nets.reduce((s, n) => s + n.cols[i], 0)),
  };

  const futureCount = future.length;

  return {
    asOf, since, columns, futureCount, pastOmitted, futureOmitted, priorPeriod,
    sections, nets, netTotal,
    futureTotal: netTotal.future, exclFuture: netTotal.total - netTotal.future,
  };
}

function sumRows(rows, ncols) {
  return {
    total: rows.reduce((s, r) => s + r.total, 0),
    other: rows.reduce((s, r) => s + r.other, 0),
    future: rows.reduce((s, r) => s + r.future, 0),
    cols: Array.from({ length: ncols }, (_, i) => rows.reduce((s, r) => s + r.cols[i], 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Monthly Income                                                      */
/* ------------------------------------------------------------------ */

export function monthlyIncome(ledger, cfg, asOf) {
  // Two windows. Without a fiscal year the statement is a rolling monthsShown
  // months, as it always was. With one it runs from the first month of the
  // fiscal year containing the as-of date — which is what makes the Total
  // column comparable to a fiscal-year budget.
  //
  // COMPLETED months only. A month still running is a part-month, and a
  // part-month inside the total is what makes the same total incomparable to
  // last year's: eleven months and three days against twelve. Dropping it costs
  // the newest column and buys a Prior YTD that means something.
  const startMonth = cfg.params.fiscalYearStart;
  const fiscalYear = fiscalYearOf(asOf, startMonth);
  const lastDayOf = d => new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const complete = d => lastDayOf(d) <= asOf;
  const months = [];
  if (fiscalYear !== null) {
    const start = fiscalYearStartDate(fiscalYear, startMonth);
    const span = (asOf.getFullYear() - start.getFullYear()) * 12 + asOf.getMonth() - start.getMonth();
    for (let i = 0; i <= Math.min(span, 11); i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      if (complete(d)) months.push({ key: monthKey(d), label: monthLabel(d), date: d });
    }
  } else {
    for (let i = cfg.params.monthsShown; i >= 1; i--) {
      const d = new Date(asOf.getFullYear(), asOf.getMonth() - i + 1, 1);
      if (complete(d)) months.push({ key: monthKey(d), label: monthLabel(d), date: d });
    }
  }
  const mIndex = new Map(months.map((m, i) => [m.key, i]));

  // The same span of months one fiscal year earlier, so Prior YTD compares
  // like with like: eleven complete months against eleven complete months.
  // Without a fiscal year there is no "same span last year" to speak of.
  const priorKeys = new Set();
  if (fiscalYear !== null) {
    const priorStart = fiscalYearStartDate(fiscalYear - 1, startMonth);
    for (let i = 0; i < months.length; i++) {
      priorKeys.add(monthKey(new Date(priorStart.getFullYear(), priorStart.getMonth() + i, 1)));
    }
  }
  const hasPrior = priorKeys.size > 0;

  // The budget for the fiscal year on show, if one was entered. Budgets are
  // this app's own: TroopWebHost has no idea they exist.
  const budget = fiscalYear === null ? null : (cfg.budgets || {})[String(fiscalYear)] || null;
  const hasBudget = !!budget && Object.values(budget).some(v => Number.isFinite(v) && v !== 0);

  const acc = new Map();
  const bucket = fund => {
    if (!acc.has(fund)) acc.set(fund, { cols: new Array(months.length).fill(0), allTime: 0, prior: 0 });
    return acc.get(fund);
  };
  for (const l of ledger.legs) {
    if (l.kind !== 'fund') continue;
    const b = bucket(l.key);
    b.allTime += l.amount;
    const key = monthKey(l.date);
    const ix = mIndex.get(key);
    if (ix !== undefined) b.cols[ix] += l.amount;
    if (priorKeys.has(key)) b.prior += l.amount;
  }

  const sections = CATEGORY_ORDER.map(({ key, isRevenue }) => {
    const sign = sectionSign(isRevenue);
    const inCategory = Object.keys(cfg.fundCategories).filter(f => cfg.fundCategories[f] === key);
    // A budgeted fund with nothing spent against it yet still belongs on the
    // statement — its whole budget is what remains, and that is the line a
    // treasurer is looking for.
    const budgeted = hasBudget ? inCategory.filter(f => budgetFor(budget, f) !== null) : [];
    const active = [...acc.entries()]
      .filter(([f]) => cfg.fundCategories[f] === key)
      .filter(([, b]) => b.cols.some(v => Math.abs(v) > 0.005))
      .map(([f]) => f);
    const empty = { cols: new Array(months.length).fill(0), allTime: 0, prior: 0 };
    const funds = [...new Set([...active, ...budgeted])]
      .sort((a, b) => a.localeCompare(b))
      .map(f => [f, acc.get(f) || empty])
      .map(([f, b]) => ({
        label: f,
        cols: b.cols.map(v => sign * v),
        total: sign * b.cols.reduce((s, v) => s + v, 0),
        allTime: sign * b.allTime,
        prior: hasPrior ? sign * b.prior : null,
        budget: hasBudget ? budgetFor(budget, f) : null,
      }));
    const subtotal = {
      cols: months.map((_, i) => funds.reduce((s, r) => s + r.cols[i], 0)),
      total: funds.reduce((s, r) => s + r.total, 0),
      allTime: funds.reduce((s, r) => s + r.allTime, 0),
      prior: hasPrior ? funds.reduce((s, r) => s + r.prior, 0) : null,
      budget: hasBudget ? sectionBudget(budget, key, inCategory) : null,
    };
    return { key, isRevenue, funds, subtotal };
  });

  const netOf = keys => {
    const rows = sections.filter(s => keys.includes(s.key));
    const sg = s => (s.isRevenue ? 1 : -1);
    // A net line's budget is budgeted revenue less budgeted expenses, and it
    // exists only if one of its sections was budgeted at all. Half a budget
    // still answers a real question — "we said we would raise this much" —
    // as long as the missing half is visibly missing rather than treated as
    // zero, which is what showing nothing at all would imply.
    const parts = rows.map(sec => sec.subtotal.budget).filter(v => v !== null);
    return {
      cols: months.map((_, i) => rows.reduce((s, sec) => s + sg(sec) * sec.subtotal.cols[i], 0)),
      total: rows.reduce((s, sec) => s + sg(sec) * sec.subtotal.total, 0),
      prior: hasPrior ? rows.reduce((s, sec) => s + sg(sec) * sec.subtotal.prior, 0) : null,
      budget: parts.length
        ? rows.reduce((s, sec) => s + sg(sec) * (sec.subtotal.budget || 0), 0)
        : null,
      budgetPartial: parts.length > 0 && parts.length < rows.length,
    };
  };
  const nets = NET_LINES.map(({ group, label }) =>
    ({ group, label, ...netOf(categoriesInGroup(group)) }));
  const netBudgets = nets.map(n => n.budget).filter(v => v !== null);
  const netTotal = {
    cols: months.map((_, i) => nets.reduce((s, n) => s + n.cols[i], 0)),
    total: nets.reduce((s, n) => s + n.total, 0),
    prior: hasPrior ? nets.reduce((s, n) => s + n.prior, 0) : null,
    budget: netBudgets.length ? netBudgets.reduce((s, v) => s + v, 0) : null,
    budgetPartial: nets.some(n => n.budgetPartial)
      || (netBudgets.length > 0 && netBudgets.length < nets.length),
  };

  const allTimeNet = sections.reduce((s, sec) => s + (sec.isRevenue ? 1 : -1) * sec.subtotal.allTime, 0);

  return {
    asOf, months, sections, nets, netTotal, allTimeNet, hasPrior,
    // Fiscal-year framing, null when no fiscal year is configured.
    fiscalYear,
    fiscalYearLabel: fiscalYear === null ? null : fiscalYearLabel(fiscalYear, startMonth),
    hasBudget,
  };
}

/* ------------------------------------------------------------------ */
/* Fiscal Year Comparison                                              */
/* ------------------------------------------------------------------ */

/**
 * The same statement as Monthly Income, with a fiscal year per column instead
 * of a month: the year in progress on the left, older years to the right.
 *
 * Reading left to right is reading backwards in time on purpose. The question a
 * treasurer is answering at a meeting is "how are we doing", and the answer is
 * the leftmost column; last year is the thing it is compared against, and the
 * year before that is context. A chronological run puts the answer at the far
 * edge of the widest report in the app.
 *
 * `earliestFiscalYear` drops the years before it entirely. A troop's first years
 * in TroopWebHost are usually a partial migration, and a column of those beside
 * real years invites a comparison that means nothing. Which year is the first
 * trustworthy one is a judgement the ledger cannot make, so it is asked for.
 *
 * Needs a fiscal year to be configured: without one there are no years to
 * compare, and the caller gets `years: []` to render nothing from.
 */
export function fiscalYearComparison(ledger, cfg, asOf) {
  const startMonth = cfg.params.fiscalYearStart;
  if (!startMonth) return { years: [], sections: [], nets: [], netTotal: null, omitted: 0, startMonth: null };

  const current = fiscalYearOf(asOf, startMonth);
  const earliest = Number.isFinite(cfg.params.earliestFiscalYear) ? cfg.params.earliestFiscalYear : null;

  // Only years the export actually has fund activity in: an empty column is a
  // year the troop did not exist, not a year it earned nothing.
  const present = new Set();
  for (const l of ledger.legs) {
    if (l.kind !== 'fund') continue;
    const y = fiscalYearOf(l.date, startMonth);
    if (y !== null && y <= current) present.add(y);
  }
  const all = [...present].sort((a, b) => b - a);          // newest first
  const years = earliest === null ? all : all.filter(y => y >= earliest);
  const omitted = all.length - years.length;
  const yIndex = new Map(years.map((y, i) => [y, i]));

  const acc = new Map();
  for (const l of ledger.legs) {
    if (l.kind !== 'fund') continue;
    const ix = yIndex.get(fiscalYearOf(l.date, startMonth));
    if (ix === undefined) continue;
    if (!acc.has(l.key)) acc.set(l.key, new Array(years.length).fill(0));
    acc.get(l.key)[ix] += l.amount;
  }

  // A budget column beside a year, but only where a budget was actually
  // entered: a column of blanks for the years before anyone kept one is a
  // column of nothing, and this report is already the widest thing on the page.
  const budgets = years.map(y => (cfg.budgets || {})[String(y)] || null);
  const budgetYears = budgets.map(b =>
    !!b && Object.values(b).some(v => Number.isFinite(v) && v !== 0));

  const sections = CATEGORY_ORDER.map(({ key, isRevenue }) => {
    const sign = sectionSign(isRevenue);
    const inCategory = Object.keys(cfg.fundCategories).filter(f => cfg.fundCategories[f] === key);
    const funds = [...acc.entries()]
      .filter(([f]) => cfg.fundCategories[f] === key)
      .filter(([, cols]) => cols.some(v => Math.abs(v) > 0.005))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([f, cols]) => ({
        label: f,
        cols: cols.map(v => sign * v),
        budgets: budgets.map((b, i) => (budgetYears[i] ? budgetFor(b, f) : null)),
      }));
    const subtotal = {
      cols: years.map((_, i) => funds.reduce((s, r) => s + r.cols[i], 0)),
      budgets: budgets.map((b, i) => (budgetYears[i] ? sectionBudget(b, key, inCategory) : null)),
    };
    return { key, isRevenue, funds, subtotal };
  });

  const netOf = keys => {
    const rows = sections.filter(s => keys.includes(s.key));
    const sg = s => (s.isRevenue ? 1 : -1);
    return {
      cols: years.map((_, i) => rows.reduce((s, sec) => s + sg(sec) * sec.subtotal.cols[i], 0)),
      // Same rule as the monthly statement: a net line's budget exists only if
      // one of its sections was budgeted, and half a budget stays visibly half.
      budgets: years.map((_, i) => {
        const parts = rows.map(sec => sec.subtotal.budgets[i]).filter(v => v !== null);
        return parts.length ? rows.reduce((s, sec) => s + sg(sec) * (sec.subtotal.budgets[i] || 0), 0) : null;
      }),
    };
  };
  const nets = NET_LINES.map(({ group, label }) =>
    ({ group, label, ...netOf(categoriesInGroup(group)) }));
  const netTotal = {
    cols: years.map((_, i) => nets.reduce((s, n) => s + n.cols[i], 0)),
    budgets: years.map((_, i) => {
      const parts = nets.map(n => n.budgets[i]).filter(v => v !== null);
      return parts.length ? parts.reduce((s, v) => s + v, 0) : null;
    }),
  };

  return {
    asOf, years, startMonth, omitted, sections, nets, netTotal, budgetYears,
    labels: years.map(y => fiscalYearLabel(y, startMonth)),
    partialYear: years.length ? years[0] === current : false,
  };
}
