// render.js — DOM rendering. Produces the printable tables.

import { fmtMoney, fmtInt, fmtDate, fmtShortDate } from './snapshots.js';
import { CATEGORY_NAMES, ACCOUNT_CLASSES, fiscalYearLabel, budgetYearsFor } from './config.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
};

const td = (v, cls = '') => el('td', { class: cls, text: v });

// Whether figures print with cents. A module-level setting rather than an
// argument threaded through every cell: it is a property of the whole printed
// page, main.js sets it once before a render, and passing it down forty call
// sites would obscure the code that does the work.
let showCents = true;
export const setShowCents = on => { showCents = on !== false; };

const num = (v, cls = '') =>
  el('td', { class: 'num ' + cls + (v < -0.005 ? ' neg' : ''), text: fmtMoney(v, showCents) });

/**
 * Do these parts still add to this total once every one of them is rounded?
 *
 * With cents shown they always do. Rounded to whole dollars they need not: nine
 * rows each half a dollar under print a dollar low apiece while their total
 * rounds up. That is arithmetic, not an error, and the reports say so — but
 * only on a report where it actually happened, because a standing disclaimer
 * about a discrepancy that is not there teaches a reader to ignore the notes.
 */
const roundsCleanly = (parts, whole) => showCents
  || Math.abs(parts.reduce((s, v) => s + Math.round(v), 0) - Math.round(whole)) < 0.5;

/** Tracks whether rounding pulled any subtotal off its parts on this report. */
function roundingWatch() {
  let drifted = false;
  return {
    check(parts, whole) { if (!roundsCleanly(parts, whole)) drifted = true; },
    get note() {
      return drifted
        ? 'Figures are rounded to whole dollars, so a total may differ from its parts by a dollar or two.'
        : null;
    },
  };
}

const th = (v, cls = '', scope = 'col') => el('th', { class: cls, scope, text: v });

/* ------------------------------------------------------------------ */

/**
 * Wrap a report table so it scrolls sideways instead of compressing.
 *
 * The balance sheet gains a column per snapshot and the event statement one per
 * event, so a report's width is set by the data, not the design. Without this
 * the table meets its container by squeezing, and the account names — the only
 * way to tell one row from another — are what collapses first. Print opens the
 * container back up; see app.css.
 */
const scroller = table => el('div', { class: 'rpt-scroll' }, table);

/**
 * One line: who, what, and over what period — "T16 Balance Sheet (Aug 3, 2026)".
 *
 * It used to be three stacked lines. On paper the unit name and the date each
 * cost a line of their own for a handful of words, and the reports are pressed
 * for vertical space; folded together they read as a document title, which is
 * what they are.
 */
const rptHead = (title, period, troopName) => el('header', { class: 'rpt-head' },
  el('h2', { text: `${troopName ? troopName + ' ' : ''}${title} (${period})` }));

export function renderBalanceSheet(bs, snapshots, mount, troopName = '') {
  mount.replaceChildren();
  const snapDates = Object.keys(snapshots).sort().reverse();

  mount.append(rptHead('Balance Sheet', fmtDate(bs.asOf), troopName));   // a position, so one date

  const table = el('table', { class: 'rpt' });
  const cols = ['Current', ...snapDates.map(fmtShortDate)];
  const round = roundingWatch();
  table.append(el('thead', {}, el('tr', {},
    th('', 'label'), ...cols.map(c => th(c, 'num')))));

  const body = el('tbody');
  const row = (label, values, cls = '') => {
    body.append(el('tr', { class: cls },
      el('th', { class: 'label', scope: 'row', text: label }),
      ...values.map(v => (v === null ? td('', 'num') : num(v)))));
  };
  const snapVal = key => snapDates.map(d => (snapshots[d][key] ?? null));
  // Account lines live in a sub-map keyed by name. A date captured before the
  // lines were recorded, or one predating the account, leaves a blank cell
  // rather than a zero — "not captured" and "held nothing" are different
  // claims, and the footnote below says which the blank means.
  const snapAcct = name => snapDates.map(d => {
    const accounts = snapshots[d].accounts;
    return accounts && accounts[name] !== undefined ? accounts[name] : null;
  });
  const section = label => body.append(el('tr', { class: 'section' },
    el('th', { class: 'label', scope: 'row', colspan: cols.length + 1, text: label })));

  // An account row that is zero in every column, history included, is printed
  // nowhere. The account is still classified, still captured in the snapshot and
  // still counted into Total Assets \u2014 it simply has nothing to say on this
  // sheet, and a page of dashes is how a reader learns to stop reading the
  // rows. Only account lines are dropped this way: a section subtotal at zero
  // is a statement about the section, and Other Future Events at zero says
  // there are none, which is worth reading.
  const hasFigure = values => values.some(v => v !== null && v !== undefined && Math.abs(v) >= 0.005);
  const acctRow = (label, name, v) => {
    const values = [v, ...snapAcct(name)];
    if (hasFigure(values)) row(label, values, 'detail');
  };

  // The three places a total on this sheet is the sum of rows above it.
  round.check(bs.assets.map(([, v]) => v), bs.totalAssets);
  round.check([bs.prepaid, bs.arrearsTotal], bs.netScout);
  round.check([...bs.liabilityAccounts.map(([, v]) => v), bs.otherFutureEventsNet,
               ...bs.pseudo.map(([, v]) => v)], bs.totalLiabilities);

  const noncashNames = new Set(bs.noncash.map(([k]) => k));
  section('Assets');
  for (const [name, v] of bs.assets) {
    acctRow(name + (noncashNames.has(name) ? ' \u2020' : ''), name, v);
  }
  row('Total Assets', [bs.totalAssets, ...snapVal('total_assets')], 'subtotal');

  section('Scout Balances');
  row('Scout Accounts (Prepaid Fees)', [bs.prepaid, ...snapVal('scout_prepaid')], 'detail');
  body.append(el('tr', { class: 'detail' },
    el('th', { class: 'label', scope: 'row', text: `Scouts in Arrears (${fmtInt(bs.arrearsCount)})` }),
    num(bs.arrearsTotal),
    ...snapDates.map(d => (snapshots[d].scout_arrears_total === undefined ? td('', 'num') : num(snapshots[d].scout_arrears_total)))));
  row('Net Scout Balances', [bs.netScout, ...snapVal('scout_net')], 'subtotal');

  section('Liabilities');
  for (const [name, v] of bs.liabilityAccounts) acctRow(name, name, v);
  row('Other Future Events (Net)', [bs.otherFutureEventsNet, ...snapVal('other_future_events')], 'detail');
  // Displayed under its short label, looked up by the full account name — the
  // snapshot is keyed the way the export names the account, not the way the
  // balance sheet prints it.
  for (const [name, v] of bs.pseudo) acctRow(prettyPseudo(name), name, v);
  row('Total Liabilities', [bs.totalLiabilities, ...snapVal('total_liabilities')], 'subtotal');

  body.append(el('tr', { class: 'spacer' }, el('td', { colspan: cols.length + 1 })));
  row('Unrestricted Net Assets', [bs.unrestricted, ...snapVal('unrestricted_net_assets')], 'total');
  body.append(el('tr', { class: 'spacer' }, el('td', { colspan: cols.length + 1 })));
  row('Assets reported in TWH (for comparison)', [bs.twhComparison, ...snapVal('twh_comparison')], 'detail');

  table.append(body);
  mount.append(scroller(table));

  // Notes are one line each, and each is a sentence a reader needs to trust the
  // figure above it. Anything longer belongs in the Help tab, which is where the
  // reasoning lives; a report is not the place to explain itself at length, and
  // every line here is a line the table does not get.
  mount.append(el('footer', { class: 'notes' }, [
    bs.noncash.length ? '\u2020 Non-cash: in Total Assets, deducted from Unrestricted.' : null,
    'TWH omits future events and arrears; the comparison line adds both back.',
    snapDates.length ? 'Dated columns are figures as published; blanks were not captured.' : null,
    round.note,
  ].filter(Boolean).map(t => el('p', { text: t }))));
}

// Troop-held accounts are named "_<PREFIX>, Label (Main)" by convention; strip
// the machinery for display without assuming any particular prefix.
const prettyPseudo = name => name.replace(/^_[^,]*,\s*/, '').replace(/\s*\(Main\)$/, '');

// Words every unit's event names end with, which distinguish nothing once the
// column is a column of events. "Pawnee Troop Campout" and "Mt. Crescent Ski
// Trip" become "Pawnee" and "Mt. Crescent Ski", and the heading stops wrapping
// to three lines. Generic scouting vocabulary only — a list that reached for a
// particular unit's habits would be the wrong kind of list, and anything not
// matched is simply left alone.
const EVENT_SUFFIX = /(?:\s+|^)(?:(?:troop|unit|patrol)\s+)?(?:campout|camp-out|outing|trip|event|activity|weekend)$/i;

/**
 * A fund's name under its own section heading.
 *
 * Under "Program Expenses" every row already says Expense, and under a revenue
 * heading every row says Revenue; the word is repeated down the whole column
 * and pushes the ones that matter into a second line. So it is dropped where
 * the section already carries it — never down to nothing, because a fund named
 * only "Expense" has nothing else to be called.
 */
export function shortFundLabel(name, isRevenue) {
  const re = isRevenue ? /\s*\b(?:revenues?|income)\s*$/i : /\s*\bexpenses?\s*$/i;
  const short = String(name).replace(re, '').trim();
  return short || name;
}

/** The event name as a column heading: its trailing date kept, its filler dropped. */
export function shortEventName(name) {
  const m = /^(.*?)(\s*\(\d{2}\/\d{2}\/\d{2}\))\s*$/.exec(name);
  const [, stem, date] = m || [null, name, ''];
  let short = stem;
  // Twice, so "Ski Trip Weekend" loses both. Never down to nothing: a heading
  // that was only ever a suffix keeps it rather than becoming a bare date.
  for (let i = 0; i < 2; i++) {
    const next = short.replace(EVENT_SUFFIX, '');
    if (!next.trim()) break;
    short = next;
  }
  return short.trim() + date;
}

/* ------------------------------------------------------------------ */

export function renderEventIncome(ei, mount, troopName = '') {
  mount.replaceChildren();
  mount.append(rptHead('Income Statement by Event',
    `${fmtDate(ei.since)} \u2013 ${fmtDate(ei.asOf)}`, troopName));

  const round = roundingWatch();
  const table = el('table', { class: 'rpt compact' });
  const nCols = ei.columns.length;
  // ei.columns is future-first; the sheet reads past-first, so both the headings
  // and every row's cells are split the same way and reassembled in the printed
  // order. Doing it here rather than in reports.js keeps the report's own
  // structure — future then past, matching futureCount — untouched.
  const nFuture = ei.futureCount;
  const futureOf = cols => cols.slice(0, nFuture);
  const pastOf = cols => cols.slice(nFuture);
  const nPast = nCols - nFuture;

  // Columns read YTD, Other, the past events, YTD+Future, the future-event
  // total, then the future events. The rules fall before each of those six
  // boundaries and nowhere inside an event group, so the eye can find the
  // summary figures without counting across a row of campouts.
  const head = el('thead');
  head.append(el('tr', { class: 'grouphead' },
    th('', 'label'), th('', 'num rule'), th('', 'num rule'),
    ...(nPast ? [el('th', { class: 'group rule', colspan: nPast, text: 'Past Events' })] : []),
    th('', 'num rule'), th('', 'num rule'),
    ...(nFuture ? [el('th', { class: 'group rule', colspan: nFuture, text: 'Future Events' })] : [])));
  const evtTh = e => el('th', { class: 'evt', scope: 'col' }, el('span', { text: shortEventName(e.name) }));
  head.append(el('tr', {},
    th('', 'label'), th('YTD', 'num rule'), th('Other', 'num rule'),
    ...pastOf(ei.columns).map(evtTh),
    th('YTD + Future', 'num rule'), th('Future', 'num rule'),
    ...futureOf(ei.columns).map(evtTh)));
  table.append(head);

  const body = el('tbody');
  const dataRow = (label, r, cls) => body.append(el('tr', { class: cls },
    el('th', { class: 'label', scope: 'row', text: label }),
    num(r.total - r.future, 'rule'),
    num(r.other, 'rule'),
    ...pastOf(r.cols).map((v, i) => num(v, i ? '' : 'rule')),
    num(r.total, 'rule'),
    num(r.future, 'rule'),
    ...futureOf(r.cols).map((v, i) => num(v, i ? '' : 'rule'))));

  body.append(el('tr', { class: 'detail' },
    el('th', { class: 'label', scope: 'row', text: 'Prior Period Net Income' }),
    td('', 'num rule'), td('', 'num rule'),
    ...pastOf(ei.priorPeriod).map((v, i) => num(v, i ? '' : 'rule')),
    td('', 'num rule'), td('', 'num rule'),
    ...futureOf(ei.priorPeriod).map((v, i) => num(v, i ? '' : 'rule'))));

  // The section heading carries the section's own figures. It used to head a
  // block and then repeat itself as a "Total" row at the foot of it, which cost
  // a row per section — nine of them on a statement fighting for one page — to
  // say a name the reader had just read.
  for (const sec of ei.sections) {
    if (!sec.funds.length && Math.abs(sec.subtotal.total) < 0.005) continue;
    round.check(sec.funds.map(f => f.total), sec.subtotal.total);
    dataRow(sec.key, sec.subtotal, 'section');
    for (const f of sec.funds) dataRow(shortFundLabel(f.label, sec.isRevenue), f, 'detail');
  }

  body.append(el('tr', { class: 'spacer' }, el('td', { colspan: 5 + nCols })));
  for (const n of ei.nets) dataRow(`Net Income \u2014 ${n.label}`, n, 'total');
  round.check(ei.nets.map(n => n.total), ei.netTotal.total);
  dataRow('Net Income \u2014 Total', ei.netTotal, 'total grand');

  table.append(body);
  mount.append(scroller(table));

  mount.append(el('footer', { class: 'notes' }, [
    'YTD excludes events not yet held; YTD+Future adds them. Columns are program events; fundraisers and non-event activity are in Other.',
    ei.pastOmitted > 0
      ? `${ei.pastOmitted} older event${ei.pastOmitted === 1 ? '' : 's'} in Other, not shown as columns; totals unaffected.`
      : null,
    ei.futureOmitted > 0
      ? `${ei.futureOmitted} later event${ei.futureOmitted === 1 ? '' : 's'} counted in Future but not shown as columns.`
      : null,
    round.note,
  ].filter(Boolean).map(t => el('p', { text: t }))));
}

/* ------------------------------------------------------------------ */

export function renderMonthlyIncome(mi, mount, troopName = '') {
  mount.replaceChildren();
  const period = mi.fiscalYear === null
    ? `${mi.months[0].label} \u2013 ${mi.months.at(-1).label}`
    : `${mi.fiscalYearLabel} to date: ${mi.months[0].label} \u2013 ${mi.months.at(-1).label}`;
  mount.append(rptHead('Income Statement by Month', period, troopName));

  // Columns run Total, Budget, Remaining, then the months newest first.
  //
  // Budget and Remaining appear together or not at all: a remaining figure with
  // nothing to remain from is noise, and a budget with no arithmetic done on it
  // is a number the reader has to check by hand.
  //
  // The fiscal year to date and what remains of the budget are the figures a
  // treasurer is at the meeting to give, and last month is the one being asked
  // about; a chronological run put all three at the far right, past a year of
  // history, on the report that is already the widest. The months stay in
  // chronological order everywhere else — mi.months is what the totals are
  // computed from and what the period heading is written from — so this is a
  // display order and nothing more.
  const round = roundingWatch();
  const months = [...mi.months].reverse();
  const cols = months.length + 2 + (mi.hasBudget ? 2 : 0);
  const table = el('table', { class: 'rpt compact' });
  table.append(el('thead', {}, el('tr', {},
    th('', 'label'),
    th('Total', 'num'),
    ...(mi.hasBudget ? [th('Budget', 'num budget'), th('Remaining', 'num budget')] : []),
    // A rule before the first month separates the fiscal-year-to-date block
    // from the history behind it, now that the two are adjacent.
    ...months.map((m, i) => th(m.label, 'num' + (i ? '' : ' periodstart'))))));

  const body = el('tbody');
  const dataRow = (label, r, cls) => {
    const cells = [num(r.total)];
    if (mi.hasBudget) {
      // An unbudgeted row is left blank rather than shown as zero. Zero is a
      // decision \u2014 "we planned to spend nothing here" \u2014 and a blank is not.
      cells.push(r.budget === null ? td('', 'num budget') : num(r.budget, 'budget'));
      if (r.budget === null) {
        cells.push(td('', 'num budget'));
      } else {
        const remaining = num(r.budget - r.total, 'budget');
        if (r.budgetPartial) remaining.textContent += ' †';
        cells.push(remaining);
      }
    }
    cells.push(...[...r.cols].reverse().map((v, i) => num(v, i ? '' : 'periodstart')));   // months, newest first
    body.append(el('tr', { class: cls }, el('th', { class: 'label', scope: 'row', text: label }), ...cells));
  };

  for (const sec of mi.sections) {
    if (!sec.funds.length && sec.subtotal.budget === null && Math.abs(sec.subtotal.total) < 0.005) continue;
    round.check(sec.funds.map(f => f.total), sec.subtotal.total);
    dataRow(sec.key, sec.subtotal, 'section');
    for (const f of sec.funds) dataRow(shortFundLabel(f.label, sec.isRevenue), f, 'detail');
  }

  body.append(el('tr', { class: 'spacer' }, el('td', { colspan: cols })));
  for (const n of mi.nets) dataRow(`Net Income \u2014 ${n.label}`, n, 'total');
  round.check(mi.nets.map(n => n.total), mi.netTotal.total);
  round.check(mi.netTotal.cols, mi.netTotal.total);   // the Total column against its months
  dataRow('Net Income \u2014 Total', mi.netTotal, 'total grand');

  table.append(body);
  mount.append(scroller(table));

  const partial = [...mi.nets, mi.netTotal].some(n => n.budgetPartial);
  mount.append(el('footer', { class: 'notes' }, [
    `Total is the ${mi.months.length} month${mi.months.length === 1 ? '' : 's'} shown, excluding future events and anything earlier`
      + (mi.hasBudget ? `; Budget is ${mi.fiscalYearLabel} in full, held in this app only, and a blank is no budget set.` : '.'),
    mi.hasBudget && partial ? '\u2020 Budgeted on one side only; the other side is not treated as zero.' : null,
    round.note,
  ].filter(Boolean).map(t => el('p', { text: t }))));
}

/* ------------------------------------------------------------------ */

/**
 * Year against year, newest column first.
 *
 * The leftmost column is the year in progress, so it is a part-year figure
 * sitting beside whole ones. That is the comparison a treasurer wants and also
 * the one that misleads if it goes unsaid, so the column is marked and the mark
 * is explained in a line under the table.
 */
export function renderFiscalYearComparison(fy, mount, troopName = '') {
  mount.replaceChildren();
  if (!fy.years.length) { mount.hidden = true; return; }
  mount.hidden = false;

  mount.append(rptHead('Fiscal Year Comparison',
    `${fy.labels.at(-1)} \u2013 ${fy.labels[0]}`, troopName));

  // Each year, then its budget where one was kept. A rule before every year
  // keeps the pairs from reading as one run of figures.
  const round = roundingWatch();
  const cols = 1 + fy.years.length + fy.budgetYears.filter(Boolean).length;
  const table = el('table', { class: 'rpt compact' });
  table.append(el('thead', {}, el('tr', {},
    th('', 'label'),
    ...fy.labels.flatMap((l, i) => [
      th(l.replace(/^FY /, '') + (i === 0 && fy.partialYear ? ' \u2020' : ''), 'num rule'),
      ...(fy.budgetYears[i] ? [th('Budget', 'num budget')] : []),
    ]))));

  const body = el('tbody');
  const dataRow = (label, r, cls) => body.append(el('tr', { class: cls },
    el('th', { class: 'label', scope: 'row', text: label }),
    ...r.cols.flatMap((v, i) => [
      num(v, 'rule'),
      // Blank, not zero: a line nobody budgeted is not a line budgeted at zero.
      ...(fy.budgetYears[i]
        ? [r.budgets && r.budgets[i] !== null && r.budgets[i] !== undefined
            ? num(r.budgets[i], 'budget') : td('', 'num budget')]
        : []),
    ])));

  for (const sec of fy.sections) {
    if (!sec.funds.length) continue;
    fy.years.forEach((_, i) => round.check(sec.funds.map(f => f.cols[i]), sec.subtotal.cols[i]));
    dataRow(sec.key, sec.subtotal, 'section');
    for (const f of sec.funds) dataRow(shortFundLabel(f.label, sec.isRevenue), f, 'detail');
  }

  body.append(el('tr', { class: 'spacer' }, el('td', { colspan: cols })));
  for (const n of fy.nets) dataRow(`Net Income \u2014 ${n.label}`, n, 'total');
  fy.years.forEach((_, i) => round.check(fy.nets.map(n => n.cols[i]), fy.netTotal.cols[i]));
  dataRow('Net Income \u2014 Total', fy.netTotal, 'total grand');

  table.append(body);
  mount.append(scroller(table));

  mount.append(el('footer', { class: 'notes' }, [
    fy.partialYear ? '\u2020 Year in progress, compared against complete years.' : null,
    fy.omitted > 0
      ? `${fy.omitted} earlier year${fy.omitted === 1 ? '' : 's'} not shown; change "Earliest year compared" under Parameters.`
      : null,
    round.note,
  ].filter(Boolean).map(t => el('p', { text: t }))));
}

export function renderReconciliation(rec, ledger, mount) {
  mount.replaceChildren();
  const dl = el('dl', { class: 'recon' });
  const add = (k, v) => { dl.append(el('dt', { text: k }), el('dd', { text: v })); };

  add('Transactions', fmtInt(rec.rows));
  add('Ledger legs', fmtInt(rec.legs));
  add('Transaction types', fmtInt(rec.txnTypes.length));
  add('Troop accounts', `${rec.accounts.length} \u2014 all classified`);
  add('Funds in data', `${rec.fundsSeen.length} \u2014 all mapped`);
  add('Events', fmtInt(rec.eventCount));
  add('Scout accounts', fmtInt(rec.scoutAccounts));
  add('Troop-held (pseudo) accounts', rec.pseudoAccounts.length
    ? rec.pseudoAccounts.map(p => prettyPseudo(p)).join(', ') : 'none');
  add('Asset legs net', fmtMoney(rec.assetTotal));
  add('Person legs net', fmtMoney(rec.personTotal));
  add('Single-leg entries', `${fmtInt(rec.singleLegCount)}${rec.singleLegCount ? ' \u2014 ' + rec.singleLegTypes.join(', ') : ''}`);

  mount.append(dl);

  if (rec.undatedEvents.length) {
    mount.append(el('p', { class: 'warn' },
      'Events without a trailing (MM/DD/YY) date, which cannot be placed on the timeline: ' + rec.undatedEvents.join('; ')));
  }
  if (ledger.warnings.length) {
    mount.append(el('details', { class: 'warn' },
      el('summary', { text: `${ledger.warnings.length} warning(s)` }),
      el('ul', {}, ledger.warnings.map(w => el('li', { text: w })))));
  }
}

export function renderErrors(errors, mount, onGoToSettings = null) {
  mount.replaceChildren();
  if (!errors.length) { mount.hidden = true; return; }
  mount.hidden = false;
  mount.append(el('h3', { text: 'Load halted' }),
    el('ul', {}, errors.map(e => el('li', { text: e }))));
  // Every one of these errors is fixed on the Settings tab, and the text says
  // so in words. A halted load leaves the treasurer on the Import tab being
  // told to go somewhere, so put the way there next to the telling. A button,
  // not a link: following it must not touch the address bar.
  if (onGoToSettings) {
    const go = el('button', { type: 'button', text: 'Open the chart of accounts' });
    go.addEventListener('click', onGoToSettings);
    mount.append(el('p', { class: 'actions' }, go));
  }
}

/* ------------------------------------------------------------------ */

/**
 * The import review: what this export added to the chart of accounts, and what
 * the chart holds that the export never mentions.
 *
 * The added entries are already in the settings by the time this renders — the
 * point of the panel is that no guess passes unseen. Each row carries the
 * evidence the guess was made from, so confirming one is a judgement rather than
 * an act of faith.
 */
export function renderChartReview(review, mount, { onFundChange, onAccountChange, onRemoveUnused, onDone }) {
  mount.replaceChildren();
  const added = review.newFunds.length + review.newAccounts.length;
  const unused = review.unusedFunds.length + review.unusedAccounts.length;
  const budgeted = review.unusedBudgetedFunds?.length || 0;
  if (!added && !unused && !budgeted) { mount.hidden = true; return; }
  mount.hidden = false;

  if (added) {
    mount.append(el('p', { class: 'warn' },
      el('strong', { text: `${plural(added, 'new name')} in this export ${added === 1 ? 'was' : 'were'} not in your settings.` }),
      document.createTextNode(' Each has been added with the classification guessed below, so the reports could run.'
        + ' A guess puts money in a section; check them before you publish anything.')));

    if (review.newFunds.length) {
      const table = el('table', { class: 'cfg' });
      table.append(el('thead', {}, el('tr', {},
        th('New fund', 'label'), th('Net in export', 'num'), th('Legs', 'num'), th('Category'))));
      const body = el('tbody');
      for (const f of review.newFunds) {
        const sel = el('select');
        for (const opt of CATEGORY_NAMES) {
          sel.append(el('option', { value: opt, text: opt, ...(f.guess === opt ? { selected: '' } : {}) }));
        }
        sel.addEventListener('change', () => onFundChange(f.name, sel.value));
        body.append(el('tr', {},
          el('th', { class: 'label', scope: 'row', text: f.name }),
          num(f.net), el('td', { class: 'num', text: fmtInt(f.legs) }), el('td', {}, sel)));
      }
      table.append(body);
      mount.append(el('h3', { text: 'Funds added' }), table);
    }

    if (review.newAccounts.length) {
      const table = el('table', { class: 'cfg' });
      table.append(el('thead', {}, el('tr', {}, th('New troop account', 'label'), th('Classification'))));
      const body = el('tbody');
      for (const a of review.newAccounts) {
        const sel = el('select');
        for (const opt of ['cash', 'noncash', 'liability']) {
          sel.append(el('option', { value: opt, text: opt, ...(a.guess === opt ? { selected: '' } : {}) }));
        }
        sel.addEventListener('change', () => onAccountChange(a.name, sel.value));
        body.append(el('tr', {},
          el('th', { class: 'label', scope: 'row', text: a.name }), el('td', {}, sel)));
      }
      table.append(body);
      mount.append(el('h3', { text: 'Troop accounts added' }), table);
    }
  }

  if (unused || budgeted) {
    mount.append(el('h3', { text: 'Not used by this export' }));
    mount.append(el('p', { class: 'hint', text:
      `Your settings classify ${plural(review.unusedFunds.length, 'fund')} and `
      + `${plural(review.unusedAccounts.length, 'troop account')} that this export never mentions. `
      + 'Removing them tidies the chart of accounts and changes no figure — nothing in the '
      + 'reports refers to them. They come back, with a guessed classification, if they turn '
      + 'up in a later export.' }));
    mount.append(nameList('Funds', review.unusedFunds), nameList('Troop accounts', review.unusedAccounts));
    if (review.unusedBudgetedFunds?.length) {
      mount.append(el('p', { class: 'hint', text:
        `${plural(review.unusedBudgetedFunds.length, 'unused fund')} carr${review.unusedBudgetedFunds.length === 1 ? 'ies' : 'y'} a budget and `
        + `${review.unusedBudgetedFunds.length === 1 ? 'is' : 'are'} not in that list: `
        + `${review.unusedBudgetedFunds.join(', ')}. Remove those on the Settings tab, where the budget can be moved to another fund instead of vanishing with it.` }));
    }
    if (unused) {
      const remove = el('button', { class: 'danger', type: 'button',
        text: `Remove ${unused === 1 ? 'it' : `all ${fmtInt(unused)}`} from the settings` });
      remove.addEventListener('click', onRemoveUnused);
      mount.append(el('p', { class: 'actions' }, remove));
    }
  }

  const done = el('button', { type: 'button', text: 'Done — go to the reports' });
  done.addEventListener('click', onDone);
  mount.append(el('p', { class: 'actions' }, done));
}

const plural = (n, word) => `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * A short list is worth reading in place; a long one is a wall the eye skips, so
 * it collapses. Either way the names are all there — this is the list a
 * treasurer is deciding to delete from.
 */
function nameList(label, names, inlineLimit = 10) {
  if (!names.length) return null;
  const items = el('ul', { class: 'namelist' }, names.map(n => el('li', { text: n })));
  if (names.length <= inlineLimit) {
    return el('div', {}, el('p', { class: 'hint', text: `${label} (${fmtInt(names.length)}):` }), items);
  }
  return el('details', {}, el('summary', { text: `${label}: ${fmtInt(names.length)} — show them` }), items);
}

/**
 * The budget editor: one fiscal year, category by category.
 *
 * Laid out the way the income statement reads, so a figure typed here can be
 * found there. The section column shows what the two kinds of entry add up to,
 * because "category figure plus the funds you budgeted separately" is a rule
 * that is easier to see than to explain.
 */
export function renderBudget(cfg, { year, years, label }, mount, { onSetYear, onSet }) {
  mount.replaceChildren();

  if (!cfg.params.fiscalYearStart) {
    mount.append(el('p', { class: 'hint', text:
      'Choose a month above to budget. A budget covers a fiscal year, so with no fiscal '
      + 'year there is no period to compare it against.' }));
    return;
  }

  const budget = (cfg.budgets || {})[String(year)] || {};
  const picker = el('select');
  for (const y of years) {
    picker.append(el('option', { value: String(y), text: fiscalYearLabel(y, cfg.params.fiscalYearStart),
      ...(y === year ? { selected: '' } : {}) }));
  }
  picker.addEventListener('change', () => onSetYear(Number(picker.value)));
  mount.append(el('p', { class: 'actions' }, el('label', { class: 'inline', text: 'Fiscal year ' }), picker));

  const table = el('table', { class: 'cfg budget' });
  table.append(el('thead', {}, el('tr', {},
    th('Category / fund', 'label'), th('Budget', 'num'), th('Section total', 'num'))));
  const body = el('tbody');

  // Section totals are refreshed in place rather than by re-rendering the
  // table. A change event fires as the box loses focus; replacing the table
  // under it would tear out the element mid-blur — which the DOM refuses — and
  // would throw away the focus of anyone typing a budget line by line.
  const totalCells = new Map();
  const refreshTotals = () => {
    const now = (cfg.budgets || {})[String(year)] || {};
    for (const [cat, cell] of totalCells) {
      const funds = Object.keys(cfg.fundCategories).filter(f => cfg.fundCategories[f] === cat);
      const parts = funds.map(f => now[f]).filter(Number.isFinite);
      const set = Number.isFinite(now[cat]) || parts.length;
      cell.textContent = set
        ? fmtMoney((Number.isFinite(now[cat]) ? now[cat] : 0) + parts.reduce((s, v) => s + v, 0))
        : '';
    }
  };

  const input = name => {
    const box = el('input', { type: 'number', step: '0.01', min: '0',
      value: Number.isFinite(budget[name]) ? String(budget[name]) : '' });
    box.addEventListener('change', () => {
      const v = box.value.trim() === '' ? null : Number(box.value);
      onSet(name, v !== null && Number.isFinite(v) ? v : null);
      refreshTotals();
    });
    return box;
  };

  for (const cat of CATEGORY_NAMES) {
    const funds = Object.keys(cfg.fundCategories).filter(f => cfg.fundCategories[f] === cat).sort();
    const cell = el('td', { class: 'num' });
    totalCells.set(cat, cell);
    body.append(el('tr', { class: 'section' },
      el('th', { class: 'label', scope: 'row', text: cat }),
      el('td', { class: 'num' }, input(cat)),
      cell));
    for (const f of funds) {
      body.append(el('tr', { class: 'detail' },
        el('th', { class: 'label', scope: 'row', text: f }),
        el('td', { class: 'num' }, input(f)),
        el('td', {})));
    }
  }
  refreshTotals();
  table.append(body);
  mount.append(table);
  mount.append(el('p', { class: 'hint', text:
    `Blank is not zero: a blank line has no budget and prints blank on the statement. `
    + `Budgets for other years are kept in the settings file. Showing ${label}.` }));
}

/**
 * The chart of accounts, editable: classify, add, remove.
 *
 * Every fund and account this troop uses is a row here, and rows come and go —
 * TroopWebHost gains a fund, a bank account closes. Adding and removing is
 * therefore part of this table rather than an errand into a text editor, which
 * is what the settings file used to be for.
 *
 * The SIX CATEGORY NAMES are not editable and never will be: they drive the
 * income-statement sections and the program/fundraising split, so they are the
 * app's vocabulary rather than a troop's. What belongs to a troop is which
 * funds exist and which category each one is in.
 */
export function renderConfig(cfg, mount, { usage, onChange, onAdd, onRemove }) {
  mount.replaceChildren();
  const inUse = { funds: new Set(), accounts: new Set(), ...(usage || {}) };

  /**
   * The ✕ on a row, and what it is allowed to do.
   *
   * A name the loaded export uses cannot be removed at all — its transactions
   * are in the reports, and a chart with nothing to classify them by is not a
   * tidier chart, it is a broken report. Removing it is not offered rather than
   * offered and then punished.
   *
   * A fund carrying a budget can go, but its budget cannot simply go with it:
   * the row turns into a chooser for the fund to move that budget onto, so the
   * yearly totals come out where they went in.
   */
  const removeCell = (kind, name, row) => {
    const cell = el('td', { class: 'shrink' });
    if (inUse[kind === 'fund' ? 'funds' : 'accounts'].has(name)) {
      cell.append(el('button', {
        type: 'button', class: 'linkish remove', disabled: '',
        title: `"${name}" is used by the loaded export, so it cannot be removed. Its transactions would have nothing to classify them.`,
        text: '✕',
      }));
      return cell;
    }
    const years = kind === 'fund' ? budgetYearsFor(cfg.budgets, name) : [];
    const b = el('button', { type: 'button', class: 'linkish remove', title: `Remove ${name}`, text: '✕' });
    b.addEventListener('click', () => {
      if (!years.length) { onRemove(kind, name); return; }
      b.disabled = true;
      row.after(mergeRow(name, years, () => { b.disabled = false; }));
    });
    cell.append(b);
    return cell;
  };

  /** The inline "where does its budget go?" row. */
  const mergeRow = (name, years, onCancel) => {
    const sel = el('select');
    for (const other of Object.keys(cfg.fundCategories).filter(f => f !== name).sort()) {
      sel.append(el('option', { value: other, text: other }));
    }
    const figures = years
      .map(y => `${fiscalYearLabel(Number(y), cfg.params.fiscalYearStart)} ${fmtMoney(cfg.budgets[y][name])}`)
      .join(', ');
    const go = el('button', { type: 'button', class: 'danger', text: 'Move budget and remove' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    const tr = el('tr', { class: 'mergerow' }, el('td', { colspan: 3 },
      el('p', { class: 'hint', text: `"${name}" has a budget (${figures}). Removing it moves that budget to another fund, so every year's total stays what it was. Move it to:` }),
      el('p', { class: 'actions' }, sel, go, cancel)));
    go.addEventListener('click', () => onRemove('fund', name, sel.value));
    cancel.addEventListener('click', () => { tr.remove(); onCancel(); });
    return tr;
  };

  const accounts = el('table', { class: 'cfg' });
  accounts.append(el('thead', {}, el('tr', {},
    th('Troop account', 'label'), th('Classification'), th('', 'shrink'))));
  const abody = el('tbody');
  for (const name of Object.keys(cfg.accountClass).sort()) {
    const sel = el('select');
    for (const opt of ACCOUNT_CLASSES) {
      sel.append(el('option', { value: opt, text: opt, ...(cfg.accountClass[name] === opt ? { selected: '' } : {}) }));
    }
    sel.addEventListener('change', () => { cfg.accountClass[name] = sel.value; onChange(); });
    const row = el('tr', {},
      el('th', { class: 'label', scope: 'row', text: name }),
      el('td', {}, sel));
    row.append(removeCell('account', name, row));
    abody.append(row);
  }
  accounts.append(abody);

  const funds = el('table', { class: 'cfg' });
  funds.append(el('thead', {}, el('tr', {}, th('Fund', 'label'), th('Category'), th('', 'shrink'))));
  const fbody = el('tbody');
  for (const name of Object.keys(cfg.fundCategories).sort()) {
    const sel = el('select');
    for (const opt of CATEGORY_NAMES) {
      sel.append(el('option', { value: opt, text: opt, ...(cfg.fundCategories[name] === opt ? { selected: '' } : {}) }));
    }
    sel.addEventListener('change', () => { cfg.fundCategories[name] = sel.value; onChange(); });
    const row = el('tr', {},
      el('th', { class: 'label', scope: 'row', text: name }),
      el('td', {}, sel));
    row.append(removeCell('fund', name, row));
    fbody.append(row);
  }
  funds.append(fbody);

  /** name box + classification select + Add, as one row of controls. */
  const adder = (kind, options, placeholder) => {
    const box = el('input', { type: 'text', placeholder, maxlength: '80', class: 'addname' });
    const sel = el('select');
    for (const opt of options) sel.append(el('option', { value: opt, text: opt }));
    const go = el('button', { type: 'button', text: 'Add' });
    const submit = () => {
      const name = box.value.trim();
      if (!name) return;
      box.value = '';
      onAdd(kind, name, sel.value);
    };
    go.addEventListener('click', submit);
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('p', { class: 'actions' }, box, sel, go);
  };

  mount.append(
    el('h3', { text: 'Troop accounts' }),
    el('p', { class: 'hint', text: 'Cash and non-cash accounts both count toward Total Assets; non-cash is additionally deducted from Unrestricted Net Assets, since it cannot be spent. Liability is displayed under Liabilities with the sign inverted.' }),
    accounts,
    adder('account', ACCOUNT_CLASSES, 'New troop account, exactly as TroopWebHost spells it'),
    el('h3', { text: 'Funds' }),
    el('p', { class: 'hint', text: 'Your troop\'s funds, and the category each one reports under. The category drives both the income-statement section and whether an event counts as program or fundraising activity. Add or remove funds here as TroopWebHost gains and loses them; whatever is listed is what the settings file carries.' }),
    el('p', { class: 'hint', text: 'The category names are fixed — they are the sections of the income statement — but which funds exist, and where each one sits, is entirely yours. Importing an export adds anything missing with a guessed category and offers to remove what has gone; this table is the same list, edited by hand.' }),
    funds,
    adder('fund', CATEGORY_NAMES, 'New fund, exactly as TroopWebHost spells it'));
}
