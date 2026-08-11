// reconcile.test.mjs — regression test.
//
//   node test/reconcile.test.mjs                       # synthetic fixture (default)
//   node test/reconcile.test.mjs path/to/export.csv    # your own export, invariants only
//   node test/reconcile.test.mjs export.csv settings.txt   # ... with your own chart
//
// The third form matters once a troop has adopted its own chart of accounts: the
// shipped example does not classify their funds, so without it the run stops at
// "fund not present in the category map" before a single invariant is checked.
// Pass the settings file and the invariants run against the same configuration
// the app uses. Golden values are skipped, exactly as for any external export.
//
// Both of those forms print your own fund and account names to the terminal, and
// the settings file's name is usually the unit's. There are no scout names in
// the output, but a chart of accounts still identifies a troop: do not paste a
// run into an issue, a pull request, or a chat log.
//
// Two kinds of assertion:
//
//   INVARIANTS hold for any well-formed export. They are the properties the
//   reports must never violate — Other + columns == Total, net income equals
//   revenue minus expenses, liabilities equal the sum of their parts, totals
//   independent of the column limit. These run against whatever file you point
//   at.
//
//   GOLDEN values are pinned to test/fixtures/sample-export.csv, which is
//   SYNTHETIC — invented scouts, events, amounts and dates. Real troop data is
//   never committed to this repo. Regenerate the fixture with
//   `node test/fixtures/generate.mjs > test/fixtures/sample-export.csv` and
//   re-derive these numbers deliberately if you change the generator.
//
// When a number moves and you cannot explain why, that is the finding. Do not
// loosen a tolerance or delete an assertion to get a green run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../js/csv.js';
import {
  FUND_CATEGORIES, DEFAULT_ACCOUNT_CLASS, DEFAULT_PARAMS, CATEGORY_NAMES,
  CATEGORY_ORDER, REPORTED_CATEGORIES, HIDDEN_CATEGORY, NET_LINES, categoriesInGroup, RENAMED_CATEGORIES, migrateCategories,
  guessFundCategory, guessAccountClass, fiscalYearOf, fiscalYearLabel,
  budgetYearsFor, mergeBudgetLine,
} from '../js/config.js';
import { parseYAML, stringifyYAML, YamlError } from '../js/yaml.js';
import { settingsToText, settingsFromText } from '../js/settings.js';
import { snapshotFromReport, driftReport, fmtMoney, fmtShortDate } from '../js/snapshots.js';
import { execFileSync } from 'node:child_process';
import { buildLedger, reconcile, resolveAsOf, isPseudoAccount, chartReview, classifyEvents, validateChart, compareImports } from '../js/ledger.js';
import { balanceSheet, eventIncome, monthlyIncome, fiscalYearComparison } from '../js/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'sample-export.csv');
const csvPath = process.argv[2] || FIXTURE;
const settingsPath = process.argv[3] || null;
// Golden values are pinned to the fixture read through the SHIPPED chart. A
// settings file replaces that chart, so it disqualifies the goldens even when
// the export is the fixture — the same rule as any external export.
const isFixture = path.resolve(csvPath) === path.resolve(FIXTURE) && !settingsPath;

// The fixture's synthetic troop year is Sep 2023 – Aug 2024. The as-of date is
// the last day of it: the monthly statement counts COMPLETED months, so a date
// mid-August would report eleven of the twelve and the golden values would be
// about a different period than the year the fixture describes.
const FIXTURE_PARAMS = {
  asOf: '2024-08-31',
  activitySince: '2023-09-01',
  // The synthetic year runs Sep 2023 - Aug 2024, so a September fiscal year
  // covers exactly it. The monthly golden values are the same twelve months
  // either way, which is what keeps them comparable across this change.
  fiscalYearStart: 9,
};

// A troop's own chart of accounts, when one was handed in. Refusing a settings
// file the app itself would reject is the point: a run that quietly fell back to
// the shipped example would report invariants about a configuration nobody uses.
let external = null;
if (settingsPath) {
  const parsed = settingsFromText(fs.readFileSync(settingsPath, 'utf8'));
  if (parsed.errors.length) {
    console.error(`Could not read ${path.basename(settingsPath)}:\n  ` + parsed.errors.join('\n  '));
    process.exit(1);
  }
  for (const w of parsed.warnings) console.log(`note: ${w}`);
  external = parsed.config;
}

const records = parseCSV(fs.readFileSync(csvPath, 'utf8')).records;
console.log(`${isFixture ? 'fixture' : 'external'}: ${path.basename(csvPath)} — ${records.length} transactions`
  + (settingsPath ? `\nchart: ${path.basename(settingsPath)} — `
     + `${Object.keys(external.fundCategories).length} funds, `
     + `${Object.keys(external.accountClass).length} accounts` : '') + '\n');

let fail = 0, pass = 0;
const fmt = n => (typeof n === 'number' ? n.toFixed(2).padStart(12) : String(n).padStart(12));
const eq = (label, got, want, tol = 0.005) => {
  const good = Math.abs(got - want) <= tol;
  good ? pass++ : fail++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${fmt(got)} ${good ? '==' : '!='} ${fmt(want)}`);
};
const ok = (label, cond) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

const mk = over => ({
  fundCategories: { ...(external ? external.fundCategories : FUND_CATEGORIES) },
  accountClass: { ...(external ? external.accountClass : DEFAULT_ACCOUNT_CLASS) },
  params: {
    ...DEFAULT_PARAMS,
    ...(isFixture ? FIXTURE_PARAMS : {}),
    ...(external ? external.params : {}),
    ...over,
  },
  budgets: external ? external.budgets : {},
});

function build(over) {
  const cfg = mk(over);
  const ledger = buildLedger(records, cfg);
  if (ledger.errors.length) {
    console.error('Load halted:\n  ' + ledger.errors.join('\n  '));
    process.exit(1);
  }
  return { cfg, ledger, asOf: resolveAsOf(ledger, cfg.params) };
}

/* ================================================================== */
/* INVARIANTS — must hold for any export                              */
/* ================================================================== */

console.log('== INVARIANTS ==');
{
  const { cfg, ledger, asOf } = build({});
  const bs = balanceSheet(ledger, cfg, asOf);
  const ei = eventIncome(ledger, cfg, asOf);
  const mi = monthlyIncome(ledger, cfg, asOf);

  eq('Total Assets == sum of asset lines',
     bs.totalAssets, bs.assets.reduce((s, [, v]) => s + v, 0));

  eq('Total Liabilities == card + future events + pseudo',
     bs.totalLiabilities,
     bs.liabilityAccounts.reduce((s, [, v]) => s + v, 0)
     + bs.otherFutureEventsNet
     + bs.pseudo.reduce((s, [, v]) => s + v, 0));

  eq('Unrestricted == assets - scouts - liabilities - non-cash',
     bs.unrestricted, bs.totalAssets - bs.netScout - bs.totalLiabilities - bs.totalNoncash);

  eq('Net Scout Balances == prepaid + arrears', bs.netScout, bs.prepaid + bs.arrearsTotal);

  ok('Liability section lists only troop-held (_ prefixed) person accounts',
     bs.pseudo.every(([k]) => isPseudoAccount(k)));

  // Rule 2, asserted rather than assumed, and asserted against whatever export
  // and chart the harness was pointed at rather than only the fixture — this is
  // the check most worth having when a treasurer runs it on their own data. A
  // snapshot's account lines are troop bank accounts, the troop card and
  // troop-held funds. A scout's balance is never one of them.
  {
    const lines = Object.keys(snapshotFromReport(bs).accounts || {});
    ok('no snapshot account line is a scout',
       lines.length > 0 && lines.every(k => !/^scout:/.test(k)));
    ok('every snapshot account line is a troop account or a troop-held fund',
       lines.every(k => k in cfg.accountClass || isPseudoAccount(k)));

    // A snapshot has to be complete or a historical column goes blank the year
    // an account sat idle, and a blank there means "not captured". Every account
    // in the chart gets a figure, zero included.
    ok('every account in the chart appears on the balance sheet',
       Object.keys(cfg.accountClass).every(k =>
         bs.assets.some(([n]) => n === k) || bs.liabilityAccounts.some(([n]) => n === k)));
    ok('every account in the chart is captured in a snapshot',
       Object.keys(cfg.accountClass).every(k => lines.includes(k)));
    ok('an account the export never touches is carried as zero, not dropped',
       (() => {
         const idle = { ...cfg, accountClass: { ...cfg.accountClass, 'Dormant Savings': 'cash' } };
         const b = balanceSheet(ledger, idle, asOf);
         const row = b.assets.find(([n]) => n === 'Dormant Savings');
         return !!row && row[1] === 0
           && snapshotFromReport(b).accounts['Dormant Savings'] === 0
           && Math.abs(b.totalAssets - bs.totalAssets) < 0.005;   // and it moves no total
       })());
  }

  // Total splits three ways and only three ways: the future events, the past
  // events with a column, and Other. Trimming columns is a page-fit control, so
  // it may move a PAST event into Other and may never move a future one — the
  // Future column counts every event still to come, column or no column.
  eq('Event Income: Other + shown past columns + Future == Total',
     ei.netTotal.other
     + ei.netTotal.cols.slice(ei.futureCount).reduce((a, b) => a + b, 0)
     + ei.netTotal.future,
     ei.netTotal.total);
  eq('Event Income: YTD == Total less the future events',
     ei.exclFuture, ei.netTotal.total - ei.netTotal.future);
  // With nothing omitted the shown future columns ARE the Future column; with
  // something omitted they are a strict part of it. Asserting the first case
  // where it applies is the check that has teeth.
  ok('Event Income: the shown future columns account for Future when none are omitted',
     ei.futureOmitted > 0
     || Math.abs(ei.netTotal.cols.slice(0, ei.futureCount).reduce((a, b) => a + b, 0)
                 - ei.netTotal.future) < 0.005);

  // With every column trimmed away, Total is unmoved and the whole period is
  // Other plus Future. This is the assertion that catches a page-fit control
  // quietly becoming a filter.
  {
    const none = eventIncome(ledger, mk({ pastEventsShown: 0, futureEventsShown: 0 }), asOf);
    eq('trimming every column moves no total', none.netTotal.total, ei.netTotal.total);
    eq('and Future still counts every future event', none.netTotal.future, ei.netTotal.future);
    eq('and the period is then just Other plus Future',
       none.netTotal.other + none.netTotal.future, none.netTotal.total);
    eq('and every past event is reported as omitted', none.futureOmitted + none.pastOmitted,
       ei.futureCount + (ei.columns.length - ei.futureCount) + ei.pastOmitted + ei.futureOmitted);
  }

  eq('Event Income: net total == program + fundraising + other',
     ei.netTotal.total, ei.nets.reduce((s, n) => s + n.total, 0));

  // Each net line is the signed sum of its own group's sections, and every
  // section belongs to exactly one net line — so nothing can be counted twice
  // or fall between two of them, whatever the category list grows into.
  for (const n of ei.nets) {
    eq(`Event Income: net ${n.label} == its sections`, n.total,
       categoriesInGroup(n.group).reduce((s, key) => {
         const sec = ei.sections.find(x => x.key === key);
         return s + (sec.isRevenue ? 1 : -1) * sec.subtotal.total;
       }, 0));
  }
  eq('Event Income: every reported section belongs to exactly one net line',
     NET_LINES.reduce((s, l) => s + categoriesInGroup(l.group).length, 0), REPORTED_CATEGORIES.length);
  // The hidden category is the one that belongs to NO net line, and it must
  // stay that way: give it a group a net line names and it would start
  // contributing to a figure while still having no section to show for it.
  ok('the hidden category is in no net line',
     NET_LINES.every(l => !categoriesInGroup(l.group).includes(HIDDEN_CATEGORY)));
  ok('and has no section on any income statement',
     ![ei, mi].some(r => r.sections.some(s => s.key === HIDDEN_CATEGORY)));

  eq('Monthly Income: net total == program + fundraising + other',
     mi.netTotal.total, mi.nets.reduce((s, n) => s + n.total, 0));

  eq('Monthly Income: total column == sum of month columns',
     mi.netTotal.total, mi.netTotal.cols.reduce((a, b) => a + b, 0));

  ok('No fundraising event appears as an Event Income column',
     ei.columns.every(c => c.kind === 'program'));

  // The column limit is a page-fit control, never an accounting change.
  const wide = build({ pastEventsShown: 30 });
  const eiWide = eventIncome(wide.ledger, wide.cfg, wide.asOf);
  eq('Totals independent of pastEventsShown', eiWide.netTotal.total, ei.netTotal.total);
  eq('Future total independent of pastEventsShown', eiWide.futureTotal, ei.futureTotal);

  // The balance sheet is not date-filtered: future pre-charges are already in it.
  const later = build({ asOf: '2030-01-01' });
  const bsLater = balanceSheet(later.ledger, later.cfg, later.asOf);
  eq('Total Assets unaffected by as-of date', bsLater.totalAssets, bs.totalAssets);
  ok('Future-event liability shrinks as events pass',
     bsLater.otherFutureEventsNet <= bs.otherFutureEventsNet + 0.005);
}

console.log('\n== FISCAL YEAR AND BUDGET ==');
{
  // The fixture's synthetic year runs Sep 2023 - Aug 2024, as of 2024-08-31,
  // so a September fiscal year puts the whole of it in FY 2023.
  const SEP = 9;
  ok('a date after the start month is in that fiscal year',
     fiscalYearOf(new Date(2024, 8, 15), SEP) === 2024);
  ok('a date before it belongs to the year before',
     fiscalYearOf(new Date(2024, 7, 31), SEP) === 2023);
  ok('a January fiscal year is the calendar year', fiscalYearOf(new Date(2024, 5, 1), 1) === 2024);
  ok('no fiscal year configured means none', fiscalYearOf(new Date(2024, 5, 1), null) === null);
  ok('a straddling year is labelled with both', fiscalYearLabel(2023, SEP) === 'FY 2023–24');
  ok('a calendar fiscal year is labelled with one', fiscalYearLabel(2023, 1) === 'FY 2023');

  // Everything below is written against the export in front of it rather than
  // against the fixture's calendar: the fiscal year comes from the as-of date,
  // and the budgeted fund names are picked out of whatever chart was loaded.
  // A budget invariant that only holds in one synthetic year is not an
  // invariant, and it is the run against a real export that most needs these.
  const noBudget = { ...mk({ fiscalYearStart: SEP }), budgets: {} };
  const base = build({ fiscalYearStart: SEP });
  const fy = monthlyIncome(base.ledger, noBudget, base.asOf);
  const FY = fiscalYearOf(base.asOf, SEP);
  // Sep through the as-of month, capped at a full year.
  const expectedMonths = Math.min(((base.asOf.getMonth() + 12 - (SEP - 1)) % 12) + 1, 12);
  eq('the window runs from the fiscal year start to the as-of month', fy.months.length, expectedMonths);
  ok('the window starts at the fiscal year start', fy.months[0].label.startsWith('Sep'));
  ok('the report knows which fiscal year it is', fy.fiscalYear === FY);
  ok('no budget means no budget columns', fy.hasBudget === false);

  // Without a fiscal year nothing about the report may change.
  const rolling = monthlyIncome(build({}).ledger, { ...mk({ fiscalYearStart: null }), budgets: {} }, base.asOf);
  eq('no fiscal year keeps the rolling window', rolling.months.length, DEFAULT_PARAMS.monthsShown);
  ok('no fiscal year means no fiscal framing', rolling.fiscalYear === null && rolling.hasBudget === false);

  // Completed months only. A month still running would put a part-month inside
  // a total that Prior YTD compares against whole ones.
  {
    const midAug = monthlyIncome(build({ asOf: '2024-08-14' }).ledger,
                                 mk({ fiscalYearStart: SEP }), new Date(2024, 7, 14));
    const endAug = monthlyIncome(base.ledger, noBudget, base.asOf);
    eq('a month still running is left out', midAug.months.length, endAug.months.length - 1);
    ok('and the last column shown is the month before it',
       midAug.months.at(-1).label.startsWith('Jul'));
    ok('a month ending exactly on the as-of date is in', endAug.months.at(-1).label.startsWith('Aug'));
    ok('the total covers only what is shown',
       Math.abs(midAug.netTotal.total - midAug.netTotal.cols.reduce((s, v) => s + v, 0)) < 0.005);
  }

  // Prior YTD is the same span one fiscal year earlier, and Change is the
  // difference. Both are null without a fiscal year — there is no "same span
  // last year" for a rolling window.
  {
    const fyMi = monthlyIncome(base.ledger, noBudget, base.asOf);
    ok('a fiscal year gives a prior-year comparison', fyMi.hasPrior === true);
    ok('every row carries a prior figure',
       fyMi.sections.flatMap(s => s.funds).every(f => f.prior !== null && f.prior !== undefined));
    eq('the prior total is the sum of its sections',
       fyMi.netTotal.prior, fyMi.nets.reduce((s, n) => s + n.prior, 0));
    const rolling = monthlyIncome(base.ledger, { ...mk({ fiscalYearStart: null }), budgets: {} }, base.asOf);
    ok('a rolling window has no prior-year comparison',
       rolling.hasPrior === false && rolling.netTotal.prior === null);
  }

  // A budget on a category and on one fund inside it. The fund is whichever one
  // the export actually spent under; naming one would tie this to a chart.
  const anExpenseFund = fy.sections.find(s => s.key === 'Program Expenses').funds[0].label;
  // Every category in the program group, or the net line is partially budgeted
  // — which is its own assertion further down. The extra ones are budgeted at
  // zero so the arithmetic below stays about Program Revenue and Expenses.
  const restOfProgram = Object.fromEntries(categoriesInGroup('program')
    .filter(k => k !== 'Program Revenue' && k !== 'Program Expenses').map(k => [k, 0]));
  const withBudget = {
    ...noBudget,
    budgets: { [FY]: { 'Program Expenses': 10000, [anExpenseFund]: 1500, 'Program Revenue': 40000, ...restOfProgram } },
  };
  const b = monthlyIncome(base.ledger, withBudget, base.asOf);
  ok('a budget for the year on show turns the columns on', b.hasBudget === true);
  const progExp = b.sections.find(s => s.key === 'Program Expenses');
  const budgetedFund = progExp.funds.find(f => f.label === anExpenseFund);
  eq('a fund carries its own budget', budgetedFund.budget, 1500);
  ok('an unbudgeted fund carries none',
     progExp.funds.filter(f => f.label !== anExpenseFund).every(f => f.budget === null));
  eq('the section adds the category figure to the funds budgeted inside it',
     progExp.subtotal.budget, 11500);
  const netProgram = b.nets.find(n => n.group === 'program');
  eq('net program budget is budgeted revenue less budgeted expenses',
     netProgram.budget, 40000 - 11500);
  ok('a fully budgeted net line is not flagged partial', netProgram.budgetPartial === false);
  ok('leaving one category of a group unbudgeted flags the net line partial',
     monthlyIncome(base.ledger, { ...noBudget, budgets: { [FY]: { 'Program Revenue': 40000, 'Program Expenses': 10000 } } },
       base.asOf).nets.find(n => n.group === 'program').budgetPartial
     === (categoriesInGroup('program').length > 2));

  // Remaining is what the renderer prints; assert the arithmetic it relies on.
  eq('remaining is budget less the fiscal year to date',
     progExp.subtotal.budget - progExp.subtotal.total, 11500 - progExp.subtotal.total);

  // Half a budget must stay visibly half.
  const oneSided = { ...noBudget, budgets: { [FY]: { 'Other Income': 100 } } };
  const os = monthlyIncome(base.ledger, oneSided, base.asOf);
  const osOther = os.nets.find(n => n.group === 'other');
  ok('a net line budgeted on one side only is flagged', osOther.budgetPartial === true);
  eq('and counts only the side that was budgeted', osOther.budget, 100);
  ok('an unbudgeted section stays null',
     os.sections.find(s => s.key === 'Program Revenue').subtotal.budget === null);

  // A budget for another year must not leak into this one.
  const otherYear = { ...noBudget, budgets: { [FY + 7]: { 'Program Revenue': 1 } } };
  ok('a budget for a different fiscal year is not shown',
     monthlyIncome(base.ledger, otherYear, base.asOf).hasBudget === false);

  // A budgeted fund with no activity still needs its line, or its budget is
  // invisible. "No activity" is again read off the report rather than named.
  const shown = new Set(fy.sections.flatMap(s => s.funds).map(f => f.label));
  const idleFund = Object.keys(noBudget.fundCategories).find(f => !shown.has(f));
  const dormant = { ...noBudget, budgets: { [FY]: { [idleFund]: 750 } } };
  const d = monthlyIncome(base.ledger, dormant, base.asOf);
  const row = d.sections.flatMap(s => s.funds).find(f => f.label === idleFund);
  ok('a budgeted fund with no activity still gets a row', !!row);
  ok('and shows its whole budget as remaining', row && row.budget === 750 && Math.abs(row.total) < 0.005);

  // The figures themselves must not move because a budget was entered.
  eq('a budget changes no actual', b.netTotal.total, fy.netTotal.total);
}

console.log('\n== NUMBER AND DATE FORMAT ==');
{
  ok('cents print two places', fmtMoney(1234.56) === '1,234.56');
  ok('negatives print in parentheses', fmtMoney(-1234.56) === '(1,234.56)');
  ok('nothing prints as a dash', fmtMoney(0) === '\u2013');
  ok('whole dollars round', fmtMoney(1234.56, false) === '1,235');
  ok('whole dollars keep the parentheses', fmtMoney(-1234.56, false) === '(1,235)');
  ok('under half a dollar is nothing when rounding', fmtMoney(0.4, false) === '\u2013');
  ok('but is a figure when showing cents', fmtMoney(0.4) === '0.40');

  // Rounding is display only, so the two formats must never disagree about
  // which side of zero a figure is on, nor about its dollars.
  for (const v of [0.6, -0.6, 99.5, -99.5, 12345.49]) {
    ok(`rounding ${v} keeps its sign`,
       (fmtMoney(v, false).startsWith('(')) === (v < 0) || Math.abs(v) < 0.5);
  }

  ok('a snapshot date prints the way event dates do', fmtShortDate('2026-08-03') === '08/03/26');
  ok('and a date it cannot read is passed through', fmtShortDate('whenever') === 'whenever');

  // The disclosure exists because rounded parts need not add to a rounded
  // total. This is that case, constructed: three rows of .4 print as nothing
  // each while their total prints as 1.
  const parts = [0.4, 0.4, 0.4];
  const whole = parts.reduce((s, v) => s + v, 0);
  ok('rounded parts can genuinely miss their rounded total',
     parts.reduce((s, v) => s + Math.round(v), 0) !== Math.round(whole));
  ok('and with cents they never do',
     Math.abs(parts.reduce((s, v) => s + v, 0) - whole) < 0.005);
}

console.log('\n== FISCAL YEAR COMPARISON ==');
{
  const SEP = 9;
  const base = build({ fiscalYearStart: SEP });
  const fy = fiscalYearComparison(base.ledger, base.cfg, base.asOf);

  ok('years run newest first', fy.years.every((y, i) => i === 0 || y < fy.years[i - 1]));
  ok('the leftmost year is the one the as-of date falls in',
     fy.years[0] === fiscalYearOf(base.asOf, SEP));
  ok('the year in progress is marked as partial', fy.partialYear === true);
  ok('a label is given for every column', fy.labels.length === fy.years.length);

  // The same arithmetic the monthly statement satisfies, one column at a time.
  for (let i = 0; i < fy.years.length; i++) {
    eq(`FY ${fy.years[i]}: net total == the four net lines`,
       fy.netTotal.cols[i], fy.nets.reduce((s, n) => s + n.cols[i], 0));
    eq(`FY ${fy.years[i]}: each section total == its funds`,
       fy.sections.reduce((s, sec) => s + sec.subtotal.cols[i], 0),
       fy.sections.reduce((s, sec) => s + sec.funds.reduce((t, f) => t + f.cols[i], 0), 0));
  }

  // The column for the fiscal year the monthly statement covers must agree with
  // it: same ledger, same year, same definition of a fiscal year.
  const mi = monthlyIncome(base.ledger, base.cfg, base.asOf);
  eq('the current year column agrees with the monthly statement',
     fy.netTotal.cols[0], mi.netTotal.total);

  // earliestFiscalYear drops columns and says how many it dropped. It must not
  // change any figure in the columns that remain — it is a display window, not
  // a filter on the ledger.
  const cut = fy.years.length > 1 ? fy.years[0] : fy.years[0];
  const limited = fiscalYearComparison(base.ledger, mk({ fiscalYearStart: SEP, earliestFiscalYear: cut }), base.asOf);
  eq('setting the earliest year drops the years before it',
     limited.years.length, fy.years.filter(y => y >= cut).length);
  eq('and reports how many it dropped', limited.omitted, fy.years.length - limited.years.length);
  eq('and moves no figure in the years kept', limited.netTotal.cols[0], fy.netTotal.cols[0]);

  ok('with no fiscal year configured there is nothing to compare',
     fiscalYearComparison(base.ledger, mk({ fiscalYearStart: null }), base.asOf).years.length === 0);

  // A budget column beside a year, but only where a budget was kept. A column
  // of blanks for the years before anyone budgeted is a column of nothing.
  {
    const FY = fiscalYearOf(base.asOf, SEP);
    const withB = { ...mk({ fiscalYearStart: SEP }), budgets: { [FY]: { 'Program Revenue': 40000, 'Program Expenses': 10000 } } };
    const b = fiscalYearComparison(base.ledger, withB, base.asOf);
    ok('a year with a budget gets a budget column', b.budgetYears[0] === true);
    ok('a year without one does not',
       b.budgetYears.slice(1).every(v => v === false));
    eq('the section budget is the one that was entered',
       b.sections.find(s => s.key === 'Program Revenue').subtotal.budgets[0], 40000);
    ok('an unbudgeted section carries none',
       b.sections.find(s => s.key === 'Other Income').subtotal.budgets[0] === null);
    eq('the net line is budgeted revenue less budgeted expenses',
       b.nets.find(n => n.group === 'program').budgets[0], 40000 - 10000);
    ok('a year with no budget carries none on any row',
       b.nets.every(n => n.budgets.slice(1).every(v => v === null)));

    // The budget never touches an actual.
    const plain = fiscalYearComparison(base.ledger, mk({ fiscalYearStart: SEP }), base.asOf);
    eq('adding a budget moves no figure', b.netTotal.cols[0], plain.netTotal.cols[0]);
    ok('with no budgets at all there are no budget columns',
       plain.budgetYears.every(v => v === false));
  }
}

console.log('\n== CHART REVIEW (new and unused names) ==');
{
  // A chart of accounts missing one fund and one account, and carrying two
  // entries the export never mentions — the state a real settings file drifts
  // into as TroopWebHost gains funds and loses others.
  const full = mk({});
  const firstFund = Object.keys(full.fundCategories).find(f =>
    parseCSV(fs.readFileSync(FIXTURE, 'utf8')).records.some(r => r['Credit Fund'] === f || r['Debit Fund'] === f));
  const partial = {
    fundCategories: { ...full.fundCategories, 'Stale Fund Expense': 'Program Expenses' },
    accountClass: { ...full.accountClass, 'Stale Account': 'cash' },
    params: { ...full.params },
  };
  delete partial.fundCategories[firstFund];
  delete partial.accountClass['Checking'];

  const led = buildLedger(records, partial);
  ok('unclassified names still halt the load', led.errors.length > 0);
  ok('the ledger names them structurally',
     led.unknownFunds.includes(firstFund) && led.unknownAccounts.includes('Checking'));

  const review = chartReview(led, partial);
  eq('review finds the new fund', review.newFunds.length, 1);
  eq('review finds the new account', review.newAccounts.length, 1);
  ok('new fund carries its evidence',
     review.newFunds[0].name === firstFund && review.newFunds[0].legs > 0);
  ok('new fund carries a guess', CATEGORY_NAMES.includes(review.newFunds[0].guess));
  ok('review finds the unused fund', review.unusedFunds.includes('Stale Fund Expense'));
  ok('review finds the unused account', review.unusedAccounts.includes('Stale Account'));
  ok('a fund with activity is never called unused', !review.unusedFunds.includes(firstFund));

  // Adopting the guesses is what lets the load proceed. It must not move a
  // figure that has nothing to do with classification.
  const adopted = {
    fundCategories: { ...partial.fundCategories, [firstFund]: review.newFunds[0].guess },
    accountClass: { ...partial.accountClass, Checking: review.newAccounts[0].guess },
    params: { ...partial.params },
  };
  const ledB = buildLedger(records, adopted);
  ok('adopting the guesses clears the halt', ledB.errors.length === 0);
  const bsFull = balanceSheet(...(() => { const b = build({}); return [b.ledger, b.cfg, b.asOf]; })());
  const bsAdopted = balanceSheet(ledB, adopted, resolveAsOf(ledB, adopted.params));
  eq('guessing a fund category does not move Total Assets', bsAdopted.totalAssets, bsFull.totalAssets);

  // Removing unused names is presented as tidying, so it must be exactly that.
  const tidied = { ...adopted, fundCategories: { ...adopted.fundCategories }, accountClass: { ...adopted.accountClass } };
  delete tidied.fundCategories['Stale Fund Expense'];
  delete tidied.accountClass['Stale Account'];
  const ledC = buildLedger(records, tidied);
  ok('removing unused names does not halt the load', ledC.errors.length === 0);
  const bsTidied = balanceSheet(ledC, tidied, resolveAsOf(ledC, tidied.params));
  eq('removing unused names moves no figure', bsTidied.unrestricted, bsAdopted.unrestricted);
}

console.log('\n== EDITING THE CHART AFTER AN IMPORT ==');
{
  // The chart is editable while an export is loaded, so a name can be removed
  // out from under a ledger. That must halt the reports, not quietly drop the
  // fund's legs — the same rule as an unknown name at import time.
  const { ledger, cfg } = build({});
  ok('a complete chart validates clean',
     validateChart(ledger, cfg).unknownFunds.length === 0
     && validateChart(ledger, cfg).unknownAccounts.length === 0);

  const usedFund = reconcile(ledger, cfg).fundsSeen[0];
  const without = { ...cfg, fundCategories: { ...cfg.fundCategories } };
  delete without.fundCategories[usedFund];
  eq('removing a fund the export uses is caught',
     validateChart(ledger, without).unknownFunds.length, 1);
  ok('and names it', validateChart(ledger, without).unknownFunds[0] === usedFund);

  const usedAccount = reconcile(ledger, cfg).accounts[0];
  const noAccount = { ...cfg, accountClass: { ...cfg.accountClass } };
  delete noAccount.accountClass[usedAccount];
  eq('removing an account the export uses is caught',
     validateChart(ledger, noAccount).unknownAccounts.length, 1);

  // Removing something the export never mentions is the tidy-up case and must
  // stay silent — that is what the import review offers to do.
  const spare = { ...cfg, fundCategories: { ...cfg.fundCategories, 'Never Used Fund': 'Other Income' } };
  ok('an unused name added or removed changes nothing',
     validateChart(ledger, spare).unknownFunds.length === 0);

  // A fund pointed at a category no section claims is the hazard a rename
  // creates: it looks configured, so nothing asks about it, and its legs are
  // counted into nothing. It halts like an unclassified fund does.
  const miscategorised = { ...cfg, fundCategories: { ...cfg.fundCategories, [usedFund]: 'Retired Category' } };
  const bad = validateChart(ledger, miscategorised);
  eq('a fund set to a category that does not exist is caught', bad.badCategories.length, 1);
  ok('and both the fund and the category are named',
     bad.badCategories[0][0] === usedFund && bad.badCategories[0][1] === 'Retired Category');
  ok('a correctly categorised chart reports none', validateChart(ledger, cfg).badCategories.length === 0);

  // A fund the export uses cannot be removed through the UI at all; the check
  // above is the backstop for a settings file that removes one by hand.
  // A fund that is NOT in the export can go, but its budget may not go with it.
  const budgets = {
    2023: { 'Old Fund': 400, 'Keeper Fund': 100, 'Program Revenue': 5000 },
    2024: { 'Old Fund': 250 },
    2025: { 'Keeper Fund': 75 },
  };
  const yearTotal = (b, y) => Object.values(b[y] || {}).reduce((s, v) => s + v, 0);
  const merged = mergeBudgetLine(budgets, 'Old Fund', 'Keeper Fund');

  eq('merging sums into the target where both exist', merged['2023']['Keeper Fund'], 500);
  eq('and creates the target where only the source existed', merged['2024']['Keeper Fund'], 250);
  ok('the merged-away fund is gone from every year',
     Object.values(merged).every(row => !('Old Fund' in row)));
  ok('a year that never mentioned it is untouched',
     merged['2025']['Keeper Fund'] === 75 && Object.keys(merged['2025']).length === 1);
  for (const y of ['2023', '2024', '2025']) {
    eq(`FY ${y} total unchanged by the merge`, yearTotal(merged, y), yearTotal(budgets, y));
  }
  ok('other lines in the year are left alone', merged['2023']['Program Revenue'] === 5000);
  ok('merging a fund into itself is a no-op on the total',
     yearTotal(mergeBudgetLine(budgets, 'Old Fund', 'Old Fund'), '2023') === yearTotal(budgets, '2023'));
  eq('budget years are found for a fund', budgetYearsFor(budgets, 'Old Fund').length, 2);
  eq('and none for a fund with no budget', budgetYearsFor(budgets, 'Keeper Fund').length, 2);
  eq('none at all for an unbudgeted name', budgetYearsFor(budgets, 'Nothing Here').length, 0);

  // A budgeted fund is kept out of the bulk "remove unused" offer, because its
  // budget needs somewhere to go, and named instead so it is not just missing.
  const withBudget = { ...cfg, budgets: { 2023: { 'Never Used Fund': 90 } },
    fundCategories: { ...cfg.fundCategories, 'Never Used Fund': 'Other Income' } };
  const rev = chartReview(ledger, withBudget);
  ok('a budgeted unused fund is not offered for bulk removal',
     !rev.unusedFunds.includes('Never Used Fund'));
  ok('but it is named', rev.unusedBudgetedFunds.includes('Never Used Fund'));

  // Adding a fund by hand is just a chart entry until an export mentions it.
  ok('a hand-added fund does not disturb the reports',
     Math.abs(monthlyIncome(ledger, spare, resolveAsOf(ledger, spare.params)).netTotal.total
              - monthlyIncome(ledger, cfg, resolveAsOf(ledger, cfg.params)).netTotal.total) < 0.005);
}

console.log('\n== SETTINGS FILE APPLIES ONLY WHAT IT SAYS ==');
{
  const text = fs.readFileSync(path.join(here, 'fixtures', 'sample-settings.txt'), 'utf8');
  const full = settingsFromText(text);
  ok('the fixture settings file parses', full.errors.length === 0);
  ok('and reports the parameters it carries', full.providedParams.includes('showCents'));

  // A settings file written before a parameter existed simply has no line for
  // it. The parsed config still carries a value — every key is seeded from the
  // shipped defaults so the rest of the app can read a complete object — but
  // the file did not ask for it, and a caller applying the file must be able to
  // tell the difference. Without that, loading your own file silently resets
  // every setting added since you wrote it.
  const older = text.replace(/^\s*showCents:.*\r?$/m, '');
  const old = settingsFromText(older);
  ok('a file predating a parameter still loads', old.errors.length === 0);
  ok('and does not claim to have set it', !old.providedParams.includes('showCents'));
  ok('while still parsing to a complete params object', 'showCents' in old.config.params);

  // The bug this pins: applying the whole parsed params block would turn the
  // treasurer's choice back on every time they loaded their own file.
  const live = { ...DEFAULT_PARAMS, showCents: false };
  for (const k of old.providedParams) live[k] = old.config.params[k];
  eq('a setting the file never mentions survives the load', live.showCents, false);
  eq('and one it does mention is applied', live.pastEventsShown, old.config.params.pastEventsShown);

  // Every parameter in a file the app itself wrote must come back as provided,
  // or a round-trip would start losing settings.
  const written = settingsFromText(settingsToText(mk({}), {}));
  ok('a file this app wrote reports every parameter it holds',
     Object.keys(DEFAULT_PARAMS).every(k => written.providedParams.includes(k)));
}

console.log('\n== HIDE FROM REPORTS ==');
{
  const base = build({});
  const fund = Object.keys(base.cfg.fundCategories)
    .find(f => base.ledger.legs.some(l => l.kind === 'fund' && l.key === f));
  ok('the fixture has a fund with activity to hide', !!fund);

  const hide = over => {
    const cfg = { ...mk(over), fundCategories: { ...base.cfg.fundCategories, [fund]: HIDDEN_CATEGORY } };
    const ledger = buildLedger(records, cfg);
    if (ledger.errors.length) { console.error('hidden build halted:\n  ' + ledger.errors.join('\n  ')); process.exit(1); }
    return { cfg, ledger, asOf: resolveAsOf(ledger, cfg.params) };
  };
  const h = hide({});

  ok('hiding a fund does not halt the load', h.ledger.errors.length === 0);

  const before = eventIncome(base.ledger, base.cfg, base.asOf);
  const after = eventIncome(h.ledger, h.cfg, h.asOf);

  // The fund's own figure is what leaves, and nothing else. Its sign decides
  // which way the net moves, so the assertion is stated as an identity rather
  // than a direction.
  const wasRow = before.sections.flatMap(s => s.funds.map(r => ({ ...r, isRevenue: s.isRevenue })))
    .find(r => r.label === fund);
  ok('the fund was reported before hiding', !!wasRow);
  ok('and is on no section after', !after.sections.some(s => s.funds.some(r => r.label === fund)));
  eq('net moves by exactly the fund\'s own contribution',
     Number((after.netTotal.total - before.netTotal.total).toFixed(2)),
     Number((-(wasRow.isRevenue ? 1 : -1) * wasRow.total).toFixed(2)));

  // The disclosure is the whole reason hiding is allowed. A hidden fund with
  // activity is named on every statement that left it out.
  const mAfter = monthlyIncome(h.ledger, h.cfg, h.asOf);
  const fAfter = fiscalYearComparison(h.ledger, h.cfg, h.asOf);
  ok('event income names what it excluded', after.hiddenFunds.includes(fund));
  ok('monthly income names it too', mAfter.hiddenFunds.includes(fund));
  ok('and the year comparison', fAfter.hiddenFunds.includes(fund));
  eq('nothing else is claimed as hidden', after.hiddenFunds.length, 1);
  eq('and nothing is claimed when nothing is hidden', before.hiddenFunds.length, 0);

  // A hidden fund that the export never mentions is not worth a note.
  {
    const cfg = { ...mk({}), fundCategories: { ...base.cfg.fundCategories, 'Unused Hidden Fund': HIDDEN_CATEGORY } };
    const led = buildLedger(records, cfg);
    eq('an unused hidden fund is not named', eventIncome(led, cfg, resolveAsOf(led, cfg.params)).hiddenFunds.length, 0);
  }

  // THE BOUNDARY. Hiding a fund is a reporting decision about the income
  // statements. It may not move the balance sheet: money the troop holds is
  // money the troop holds, and a fund's category cannot make a liability cease
  // to exist.
  const bBefore = balanceSheet(base.ledger, base.cfg, base.asOf);
  const bAfter = balanceSheet(h.ledger, h.cfg, h.asOf);
  eq('Total Assets is unaffected by hiding a fund', bAfter.totalAssets, bBefore.totalAssets);
  eq('Total Liabilities is unaffected', bAfter.totalLiabilities, bBefore.totalLiabilities);
  eq('Other Future Events (Net) is unaffected', bAfter.otherFutureEventsNet, bBefore.otherFutureEventsNet);
  eq('Net Scout Balances is unaffected', bAfter.netScout, bBefore.netScout);
  eq('Unrestricted Net Assets is unaffected', bAfter.unrestricted, bBefore.unrestricted);

  // Hiding every fund is the degenerate case, and it must produce an empty
  // statement rather than a broken one.
  {
    const allHidden = Object.fromEntries(Object.keys(base.cfg.fundCategories).map(f => [f, HIDDEN_CATEGORY]));
    const cfg = { ...mk({}), fundCategories: allHidden };
    const led = buildLedger(records, cfg);
    const ei2 = eventIncome(led, cfg, resolveAsOf(led, cfg.params));
    eq('hiding everything nets to zero', Number(ei2.netTotal.total.toFixed(2)), 0);
    eq('and the balance sheet still stands',
       balanceSheet(led, cfg, resolveAsOf(led, cfg.params)).totalAssets, bBefore.totalAssets);
  }

  // A settings file written under the two versions that shipped the crew pair
  // still loads, and says what it moved.
  {
    const { fundCategories, moved } = migrateCategories({
      'A Fund': 'Crew Program Revenue', 'B Fund': 'Crew Program Expenses', 'C Fund': 'Program Expenses',
    });
    eq('both withdrawn crew categories migrate', moved.length, 2);
    ok('to categories that still exist',
       Object.values(fundCategories).every(c => CATEGORY_NAMES.includes(c)));
    ok('and stay inside the program group',
       ['A Fund', 'B Fund'].every(f => categoriesInGroup('program').includes(fundCategories[f])));
  }
}

console.log('\n== CLOSED BOOKS ==');
{
  // The comparison works on raw records rather than on the ledger, so it can be
  // driven entirely from the fixture by mutating copies of it.
  const clone = rows => rows.map(r => ({ ...r }));
  const dated = s => { const [m, d, y] = s.split('/'); return new Date(+y, +m - 1, +d); };

  // A cutoff late enough that every row in the fixture is inside the closed
  // period, so a change anywhere is a change to closed books.
  const late = { records: clone(records), importedOn: new Date(2100, 0, 1) };

  eq('no previous export means nothing to say', compareImports(null, records), null);
  eq('an empty previous export is the same',
     compareImports({ records: [], importedOn: new Date(2100, 0, 1) }, records), null);

  eq('the same export twice reports nothing',
     compareImports(late, clone(records)).count, 0);

  // Being ticked as reconciled is the normal course of business, not a
  // restatement — the whole reason the reconcile columns are excluded.
  {
    const after = clone(records);
    let touched = 0;
    for (const r of after) {
      if ('Reconcile Debit' in r && !r['Reconcile Debit']) { r['Reconcile Debit'] = 'Y'; touched++; }
    }
    ok('the fixture has rows to reconcile', touched > 0);
    eq('reconciling old entries is not a change', compareImports(late, after).count, 0);
  }

  // An edit to an amount, on a row identified by its Ref.
  {
    const after = clone(records);
    const row = after.find(r => r['Ref'] && Number(String(r['Amount']).replace(/[$,]/g, '')));
    row['Amount'] = '999999.00';
    const diff = compareImports(late, after);
    eq('an edited amount is one change', diff.count, 1);
    eq('and it is reported as an edit', diff.changed.length, 1);
    ok('naming the column and both values',
       diff.changed[0].fields.some(f => f.field === 'Amount' && f.to === '999999.00'));
    eq('the entry keeps its Ref', diff.changed[0].ref, row['Ref']);
  }

  // A deletion.
  {
    const gone = records.find(r => r['Ref']);
    const after = clone(records).filter(r => r['Ref'] !== gone['Ref']);
    const diff = compareImports(late, after);
    eq('a deleted entry is one change', diff.count, 1);
    eq('and it is reported as a deletion', diff.removed.length, 1);
    eq('naming the entry that went', diff.removed[0].ref, gone['Ref']);
  }

  // An entry back-dated into a period already reported.
  {
    const after = clone(records);
    after.push({ ...after[0], Ref: 'ZZZ-NEW', Date: '01/02/2024', Amount: '5.00' });
    const diff = compareImports(late, after);
    eq('a back-dated entry is one change', diff.count, 1);
    eq('and it is reported as an addition', diff.added.length, 1);
  }

  // The cutoff is what makes this a *closed books* check rather than a diff.
  // Nothing dated after the previous import was closed, so editing it is
  // ordinary bookkeeping and must be silent.
  {
    const early = { records: clone(records), importedOn: new Date(2000, 0, 1) };
    const after = clone(records);
    const row = after.find(r => r['Ref']);
    row['Amount'] = '999999.00';
    eq('a change after the cutoff is not reported', compareImports(early, after).count, 0);

    // ... and a genuinely new entry dated after the cutoff is just activity.
    const withNew = clone(records);
    withNew.push({ ...withNew[0], Ref: 'ZZZ-NEW', Date: '01/02/2024', Amount: '5.00' });
    eq('a new entry after the cutoff is not reported',
       compareImports(early, withNew).count, 0);
  }

  // A row with no Ref cannot be recognised across an edit, so its edit reads as
  // a deletion plus an addition. Both are flagged; only the wording is coarser.
  {
    const after = clone(records);
    const row = after.find(r => !r['Ref']);
    ok('the fixture has Ref-less rows', !!row);
    row['Amount'] = '888888.00';
    const diff = compareImports(late, after);
    eq('an edited Ref-less row still surfaces, as two lines', diff.count, 2);
    ok('one gone and one arrived', diff.removed.length === 1 && diff.added.length === 1);
  }

  // Rule 2, on the one structure built here that touches raw records: nothing
  // this returns may carry a person's name. It reports *that* a scout account
  // was on the entry, never which.
  {
    const after = clone(records);
    const row = after.find(r => r['Ref'] && (r['Credit Person'] || r['Debit Person']));
    row['Amount'] = '777777.00';
    row['Description'] = 'edited';
    const diff = compareImports(late, after);
    // Troop-held accounts carry the person columns but are not people, and they
    // are named freely elsewhere in the app; a leak means a real scout name.
    const names = new Set();
    for (const r of records) {
      for (const c of ['Credit Person', 'Debit Person']) {
        if (r[c] && !isPseudoAccount(r[c])) names.add(r[c]);
      }
    }
    const blob = JSON.stringify(diff);
    ok('the fixture has person names to leak', names.size > 0);
    ok('and the comparison carries none of them', [...names].every(n => !blob.includes(n)));
    ok('nor any free-text description', !blob.includes('edited'));
    ok('but it does say a scout account was involved',
       diff.changed.length === 1 && diff.changed[0].person === true);
  }

  // The cutoff is exclusive: the closed period ends the day *before* the
  // previous import, because a day you are still in is not a day you closed.
  // Import in the morning, post something dated today, import again after
  // lunch, and that entry must not come back as back-dated.
  {
    const row = records.find(r => r['Ref'] && r['Date']);
    const day = dated(row['Date']);
    const bump = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const edit = at => {
      const after = clone(records);
      after.find(r => r['Ref'] === row['Ref'])['Amount'] = '111111.00';
      return compareImports({ records: clone(records), importedOn: at }, after).count;
    };
    eq('an entry dated on the cutoff day is still open', edit(day), 0);
    eq('and closed once the cutoff moves past it', edit(bump(day, 1)), 1);
  }
}

console.log('\n== CLASSIFICATION GUESSES ==');
{
  const g = (name, net = 0) => guessFundCategory(name, net);
  // Categories that record a decision a troop made rather than something a
  // fund's name says. They divide in two, and the difference matters.
  //
  // Scout fundraising is guessable, but only from an explicit marker someone
  // put in the name ("… (to Scout)"). The other two are not guessable at all:
  // who controls a fund is a fact about how a unit is organised, and Hide from
  // Reports would delete a fund from the statements on the strength of its name.
  const NEVER_GUESSED = new Set([
    'Scout Program Expenses', HIDDEN_CATEGORY,
  ]);
  // Both kinds are excluded from the agreement rate below, which measures the
  // heuristic only against names it is actually given enough to read.
  const POLICY_CATEGORIES = new Set([
    ...NEVER_GUESSED, 'Scout Fundraising Revenue', 'Scout Fundraising Expenses',
  ]);
  ok('"Expense" in the name means an expense', g('Camping (Weekend) Expense', 500) === 'Program Expenses');
  ok('"Revenue" in the name means revenue', g('Registration Revenue', -20) === 'Program Revenue');
  ok('a fundraiser word picks the fundraising section', g('Popcorn Revenue') === 'Unit Fundraising Revenue');
  ok('fundraising expense too', g('Popcorn Expense') === 'Unit Fundraising Expenses');
  ok('proceeds named for the seller go to scout fundraising',
     g('Concessions Fundraising (to Scout)', -100) === 'Scout Fundraising Expenses');
  ok('and its revenue side too', g('Individual Fundraising', 100) === 'Scout Fundraising Revenue');
  // A name is never enough to reach either. "Hidden Fund" is the pointed case:
  // a fund whose name says hidden must still be reported until someone says
  // otherwise, because the alternative is a heuristic deleting a line.
  ok('the never-guessed categories are never guessed',
     [['Crew Expense', -100], ['Scout Managed Expense', -100],
      ['Hidden Fund', -100], ['Hide This', 100], ['Suspense/Hidden Expense', -100],
      ['Anything', -1], ['Anything', 1]]
       .every(([n, v]) => !NEVER_GUESSED.has(g(n, v))));
  ok('administrative words pick Other', g('Administrative Expenses') === 'Other Expenses');
  ok('interest is Other Income', g('Interest and Dividends', 12) === 'Other Income');
  // With no word to go on, the sign of the fund's net in the export decides.
  ok('unnamed positive net guesses revenue', g('Something New', 250) === 'Program Revenue');
  ok('unnamed negative net guesses an expense', g('Something New', -250) === 'Program Expenses');
  // A section word must not be read as a side word. Money donated by the troop
  // and money donated to it share the noun and point opposite ways.
  ok('a donation received is revenue', g('General Donation', 400) === 'Unit Fundraising Revenue');
  ok('a donation made is an expense', g('Donations by Troop', -400) === 'Unit Fundraising Expenses');

  ok('a card is a liability', guessAccountClass('Credit Card') === 'liability');
  ok('inventory is non-cash', guessAccountClass('Merchandise Inventory') === 'noncash');
  ok('anything else is cash', guessAccountClass('Checking') === 'cash');

  // Every guess must be a value the settings file will accept back.
  const names = ['Anything', 'Fund Expense', 'Popcorn', 'Bank Interest', 'Misc'];
  ok('every fund guess is a real category',
     names.every(n => CATEGORY_NAMES.includes(g(n)) && CATEGORY_NAMES.includes(g(n, -1))));
  ok('every account guess is a real class',
     names.every(n => ['cash', 'noncash', 'liability'].includes(guessAccountClass(n))));

  // The shipped example chart is the closest thing to a labelled set: the guess
  // should agree with most of it. Pinned low — this is a heuristic, not a rule.
  // Measuring the heuristic against POLICY_CATEGORIES would be measuring it
  // against information it is never given, so the agreement rate is taken over
  // the names it can actually read. Those categories get their own assertion
  // above, which is the stronger claim anyway.
  const guessOf = ([n, c]) => g(n, c.includes('Expense') ? -100 : 100);
  const shipped = Object.entries(FUND_CATEGORIES);
  const readable = shipped.filter(([, c]) => !POLICY_CATEGORIES.has(c));
  const agree = readable.filter(e => guessOf(e) === e[1]).length;
  ok(`guess agrees with ${agree}/${readable.length} of the names it can read`,
     agree >= readable.length * 0.8);

  ok('no shipped example name guesses its way into an unguessable category',
     shipped.every(e => !NEVER_GUESSED.has(guessOf(e))));
  ok('scout fundraising is guessed only from an explicit marker in the name',
     shipped.filter(e => guessOf(e).startsWith('Scout Fundraising'))
       .every(([n]) => /to scout|scout share|scout portion|scout credit|scout account|individual/i.test(n)));
  ok('every guess is a real category', shipped.every(e => CATEGORY_NAMES.includes(guessOf(e))));
}

console.log('\n== EVENT RECLASSIFICATION ==');
{
  // A category change must not require re-reading the export. Reclassifying in
  // place has to land exactly where a fresh build would.
  const { ledger, cfg } = build({});
  const moved = {
    ...cfg,
    fundCategories: Object.fromEntries(Object.entries(cfg.fundCategories)
      .map(([f, c]) => [f, c === 'Program Revenue' ? 'Unit Fundraising Revenue' : c])),
  };
  const fresh = buildLedger(records, moved);
  classifyEvents(ledger, moved);
  const kinds = l => l.events.map(e => `${e.name}:${e.kind}`).sort().join('|');
  ok('reclassify in place == a fresh build', kinds(ledger) === kinds(fresh));
  ok('the change actually moved something', kinds(fresh) !== kinds(buildLedger(records, cfg)));
}

console.log('\n== YAML SUBSET ==');
{
  const doc = parseYAML([
    '# leading comment',
    'version: 1',
    'troop:',
    '  name: "Troop 000"',
    'parameters:',
    '  pastEventsShown: 8      # trailing comment',
    '  aFlag: false',
    '  asOf: null',
    '  anEmptyList: []',
    '  hashSalt: ""',
    'list:',
    '  - alpha',
    '  - "quoted: with colon"',
    'funds:',
    '  "Odd: Name": Program Revenue',
    '  Equipment/Merch Expense: Program Expenses',
  ].join('\n'));
  ok('nested maps parse', doc.troop.name === 'Troop 000');
  ok('integers stay integers', doc.parameters.pastEventsShown === 8);
  ok('booleans stay booleans', doc.parameters.aFlag === false);
  ok('null parses as null', doc.parameters.asOf === null);
  ok('empty list parses as []', Array.isArray(doc.parameters.anEmptyList)
     && doc.parameters.anEmptyList.length === 0);
  ok('empty quoted string stays a string', doc.parameters.hashSalt === '');
  ok('sequences parse', doc.list[0] === 'alpha' && doc.list[1] === 'quoted: with colon');
  ok('quoted key containing a colon parses', doc.funds['Odd: Name'] === 'Program Revenue');
  ok('slashes in keys need no quoting', doc.funds['Equipment/Merch Expense'] === 'Program Expenses');

  // An apostrophe is ordinary punctuation in the middle of a name, and troop
  // account and fund names are full of it — a possessive in a store card, a
  // shortened year. A quote mark only opens a quoted scalar at the start of the
  // token; treated as opening anywhere, it eats the rest of the line hunting a
  // partner and the whole settings file stops loading.
  const apos = parseYAML([
    'accounts:',
    "  Ranger's Card: liability",
    "  Quartermaster's Fund: cash",
    'funds:',
    '  Two 6" Signs: Program Expenses',
  ].join('\n'));
  ok('an apostrophe inside a key needs no quoting', apos.accounts["Ranger's Card"] === 'liability');
  ok('two apostrophes on one line stay literal', apos.accounts["Quartermaster's Fund"] === 'cash');
  ok('an inch mark inside a key needs no quoting', apos.funds['Two 6" Signs'] === 'Program Expenses');
  ok('a trailing comment is still stripped after an apostrophe',
     parseYAML("a: it's fine # not this").a === "it's fine");
  ok("a doubled '' inside a single-quoted scalar is one quote",
     parseYAML("a: 'it''s fine # not this'").a === "it's fine # not this");

  // Once a scalar IS quoted, its escapes have to be honoured all the way to the
  // closing quote. A name truncated at an escaped quote would come back subtly
  // altered rather than rejected, and the budget filed under it would be
  // orphaned by a settings file that never said it changed anything.
  for (const name of ['He said "hi" # ok', '6" x 4" # sign', 'Odd: Name', 'back\\slash']) {
    const line = stringifyYAML({ [name]: 'cash' }).join('\n');
    ok(`a key needing escapes round-trips: ${name}`, Object.keys(parseYAML(line))[0] === name);
  }

  const rt = parseYAML(stringifyYAML({
    a: 'plain', b: 'has: colon', c: 12, d: 1.5, e: true, f: null,
    g: [], h: {}, i: ['x', 'y'], j: { k: 'v' }, l: '007', m: 'true',
  }).join('\n'));
  ok('emitter round-trips ambiguous scalars',
     rt.a === 'plain' && rt.b === 'has: colon' && rt.c === 12 && rt.d === 1.5
     && rt.e === true && rt.f === null && Array.isArray(rt.g) && rt.g.length === 0
     && rt.i.join() === 'x,y' && rt.j.k === 'v' && rt.l === '007' && rt.m === 'true');

  const rejects = [
    ['tabs', 'a:\n\tb: 1'],
    ['odd indentation', 'a:\n   b: 1'],
    ['duplicate keys', 'a: 1\na: 2'],
    ['missing colon', 'just some text'],
    ['unterminated quote', 'a: "oops'],
    ['inline collections with content', 'a: [1, 2]'],
  ];
  for (const [label, src] of rejects) {
    let threw = false;
    try { parseYAML(src); } catch (e) { threw = e instanceof YamlError; }
    ok(`rejects ${label}`, threw);
  }
}

console.log('\n== SETTINGS FILE ==');
{
  const cfg = mk({});
  const snaps = { '2024-08-03': {
    total_assets: 1234.5, scout_arrears_count: 3, unrestricted_net_assets: -12,
    accounts: { 'Checking': 900.25, '_UNIT, Campership (Main)': -40 },
  } };
  const text = settingsToText(cfg, snaps);
  const back = settingsFromText(text);

  ok('settings round-trip without error', back.errors.length === 0);
  eq('round-trip preserves fund count',
     Object.keys(back.config.fundCategories).length, Object.keys(cfg.fundCategories).length);
  eq('round-trip preserves account count',
     Object.keys(back.config.accountClass).length, Object.keys(cfg.accountClass).length);
  ok('round-trip preserves parameter types',
     back.config.params.pastEventsShown === cfg.params.pastEventsShown
     && typeof back.config.params.pastEventsShown === 'number'
     && typeof back.config.params.hashSalt === 'string'
     && back.config.params.asOf === cfg.params.asOf);
  eq('round-trip preserves a snapshot figure', back.snapshots['2024-08-03'].total_assets, 1234.5);
  eq('round-trip preserves a per-account snapshot figure',
     back.snapshots['2024-08-03'].accounts['Checking'], 900.25);
  eq('round-trip preserves a troop-held account line',
     back.snapshots['2024-08-03'].accounts['_UNIT, Campership (Main)'], -40);
  ok('an account line with a non-numeric figure is rejected',
     settingsFromText(text.replace('Checking: 900.25', 'Checking: about 900')).errors.length > 0);
  eq('round-trip preserves an integer count', back.snapshots['2024-08-03'].scout_arrears_count, 3);
  eq('round-trip preserves a negative figure', back.snapshots['2024-08-03'].unrestricted_net_assets, -12);
  ok('currency keeps two decimal places in the file', /total_assets: 1234\.50/.test(text));

  // The file the app writes must be a file the app can read. An account named
  // after a shop is the ordinary case that broke this: written out bare and
  // correct, then rejected on the way back in.
  {
    const punct = mk({});
    punct.accountClass = { ...punct.accountClass, "Ranger's Card": 'liability' };
    punct.fundCategories = { ...punct.fundCategories, "Ranger's Rebate": 'Other Income' };
    const pBack = settingsFromText(settingsToText(punct, {}));
    ok('a settings file with an apostrophe in a name round-trips',
       pBack.errors.length === 0
       && pBack.config.accountClass["Ranger's Card"] === 'liability'
       && pBack.config.fundCategories["Ranger's Rebate"] === 'Other Income');
  }

  // Budgets and the fiscal year live in the settings file too — TroopWebHost
  // has no idea they exist, so this file is the only copy there is.
  const budgeted = { ...mk({ fiscalYearStart: 9 }), budgets: { 2023: { 'Program Revenue': 40000, 'Food Expense': 1500.5 } } };
  const bText = settingsToText(budgeted, {});
  const bBack = settingsFromText(bText);
  ok('budget round-trips without error', bBack.errors.length === 0);
  eq('round-trip preserves a budget figure', bBack.config.budgets['2023']['Program Revenue'], 40000);
  eq('round-trip preserves budget cents', bBack.config.budgets['2023']['Food Expense'], 1500.5);
  ok('round-trip preserves the fiscal year start', bBack.config.params.fiscalYearStart === 9);
  ok('round-trip preserves showCents',
     settingsFromText(settingsToText(mk({ showCents: false }), {})).config.params.showCents === false
     && settingsFromText(settingsToText(mk({ showCents: true }), {})).config.params.showCents === true);
  ok('round-trip preserves the future event limit',
     settingsFromText(settingsToText(mk({ futureEventsShown: 2 }), {})).config.params.futureEventsShown === 2);
  ok('round-trip preserves the earliest year',
     settingsFromText(settingsToText(mk({ earliestFiscalYear: 2021 }), {})).config.params.earliestFiscalYear === 2021);
  ok('a fiscal year start outside 1-12 is rejected',
     settingsFromText(bText.replace('fiscalYearStart: 9', 'fiscalYearStart: 13')).errors.length > 0);
  ok('a non-numeric budget figure is rejected',
     settingsFromText(bText.replace('Program Revenue: 40000.00', 'Program Revenue: lots')).errors.length > 0);
  ok('a budget year that is not a year is rejected',
     settingsFromText(bText.replace('"2023":', '"next year":')).errors.length > 0);
  ok('a budget naming something unknown is kept, with a warning',
     (() => { const r = settingsFromText(bText.replace('Food Expense: 1500.50', 'Not A Fund: 10.00'));
              return r.errors.length === 0 && r.warnings.some(w => /Not A Fund/.test(w))
                && r.config.budgets['2023']['Not A Fund'] === 10; })());
  ok('no fiscal year round-trips as none',
     settingsFromText(settingsToText(mk({ fiscalYearStart: null }), {})).config.params.fiscalYearStart === null);
  // Written against an explicitly budget-free config rather than whatever mk()
  // happens to carry: with a settings file on the command line, mk() inherits
  // that file's budget and the premise silently stops being true.
  ok('a settings file with no budget has an empty budget section',
     (() => {
       const r = settingsFromText(settingsToText({ ...mk({}), budgets: {} }, {}));
       return r.config.budgets && Object.keys(r.config.budgets).length === 0;
     })());
  ok('the budget carries no scout identifiers', !/scout:[0-9a-f]{8}/.test(bText));
  ok('every shipped fund maps to a known category',
     Object.values(cfg.fundCategories).every(c => CATEGORY_NAMES.includes(c)));
  ok('settings file carries no scout identifiers', !/scout:[0-9a-f]{8}/.test(text));

  // A settings file written before a category was renamed is the case every
  // existing user meets exactly once. It must open, move the funds, and say so
  // — refusing would strand a treasurer whose only copy of the chart this is,
  // and moving silently would put spending under a heading nobody chose.
  {
    const [oldName, newName] = Object.entries(RENAMED_CATEGORIES)[0];
    const older = text.replace(`Registration Revenue: Program Revenue`,
                               `Registration Revenue: ${oldName}`);
    const r = settingsFromText(older);
    ok('a settings file using a renamed category still loads', r.errors.length === 0);
    ok('and the fund lands in the category that replaced it',
       r.config.fundCategories['Registration Revenue'] === newName);
    ok('and the move is reported, naming the fund',
       r.warnings.some(w => w.includes(oldName) && w.includes(newName) && w.includes('Registration Revenue')));

    // The same rewrite happens to a chart coming back out of localStorage,
    // where there is no settings file to warn about.
    const m = migrateCategories({ 'A Fund': oldName, 'B Fund': 'Other Income' });
    ok('migrateCategories rewrites only what was renamed',
       m.fundCategories['A Fund'] === newName && m.fundCategories['B Fund'] === 'Other Income');
    ok('and reports what it moved',
       m.moved.length === 1 && m.moved[0].fund === 'A Fund' && m.moved[0].to === newName);
    ok('a category it has never heard of is left alone for validation to name',
       migrateCategories({ 'C Fund': 'Not A Category' }).fundCategories['C Fund'] === 'Not A Category');
  }

  const bad = k => settingsFromText(text.replace('Registration Revenue: Program Revenue', k));
  ok('unknown fund category is rejected',
     bad('Registration Revenue: Not A Category').errors.length > 0);
  ok('unknown account class is rejected',
     settingsFromText(text.replace('Checking: cash', 'Checking: piggybank')).errors.length > 0);
  ok('malformed date is rejected',
     settingsFromText(text.replace(/activitySince: [^\r\n]*/, 'activitySince: last September')).errors.length > 0);
  ok('missing funds section is rejected',
     settingsFromText('version: 1\naccounts:\n  Checking: cash').errors.length > 0);
  ok('unreadable file reports a line number',
     /Line \d+/.test(settingsFromText('a:\n\tb: 1').errors[0] || ''));
}

console.log('\n== GENERATED FILES ARE CURRENT ==');
{
  const check = (label, file, tool) => {
    const onDisk = fs.readFileSync(path.join(here, '..', file), 'utf8');
    const fresh = execFileSync(process.execPath, [path.join(here, '..', tool)], { encoding: 'utf8' });
    ok(`${label} matches ${tool}`, onDisk === fresh);
  };
  check('defaults.txt', 'defaults.txt', 'tools/emit-defaults.mjs');
  if (isFixture) check('sample-settings.txt', 'test/fixtures/sample-settings.txt', 'tools/emit-sample-settings.mjs');

  // The shipped pair must actually work together.
  const sample = settingsFromText(fs.readFileSync(path.join(here, 'fixtures', 'sample-settings.txt'), 'utf8'));
  ok('sample settings file loads cleanly', sample.errors.length === 0);
  if (isFixture) {
    const ledger = buildLedger(records, sample.config);
    ok('sample settings + sample export produce reports', ledger.errors.length === 0);
    const bs = balanceSheet(ledger, sample.config, resolveAsOf(ledger, sample.config.params));
    const snap = snapshotFromReport(bs);
    eq('sample snapshot matches a fresh run',
       sample.snapshots['2024-08-31'].unrestricted_net_assets, Math.round(snap.unrestricted_net_assets * 100) / 100);

    // A snapshot has to hold the account lines, or the historical columns on
    // the balance sheet are blank for every row except the subtotals — the
    // report says Total Assets moved and cannot say which account moved.
    const names = Object.keys(snap.accounts || {});
    ok('a snapshot captures every asset line',
       bs.assets.every(([k]) => names.includes(k)));
    ok('a snapshot captures the liability accounts and troop-held funds',
       [...bs.liabilityAccounts, ...bs.pseudo].every(([k]) => names.includes(k)));
    eq('an account line equals its figure on the balance sheet',
       snap.accounts[bs.assets[0][0]], bs.assets[0][1]);
    eq('the asset lines add up to Total Assets',
       bs.assets.reduce((s, [k]) => s + snap.accounts[k], 0), snap.total_assets);

    // Drift is what makes a snapshot worth keeping: it says a published figure
    // and the recomputed one disagree. Now that account lines are captured it
    // has to name the account, not just the subtotal that moved with it.
    const first = bs.assets[0][0];
    const moved = { ...snap, accounts: { ...snap.accounts, [first]: snap.accounts[first] + 10 } };
    const d = driftReport(moved, snap);
    ok('drift names the account line that moved',
       d.some(x => x.key === first && Math.abs(x.delta - -10) < 0.005));
    ok('an unchanged account line is not reported as drift',
       !d.some(x => x.key !== first && names.includes(x.key)));

    // A blank is not a zero here either. A date captured before the account
    // lines were recorded, or before the account existed, has no figure to
    // compare — reporting that as a swing from nothing would bury the real
    // corrections under noise the first time anyone loads an older file.
    const partial = { ...snap, accounts: { ...snap.accounts } };
    delete partial.accounts[first];
    ok('an account missing from one side is not drift',
       !driftReport(partial, snap).some(x => x.key === first));
    ok('a snapshot with no account lines at all still compares its totals',
       driftReport({ ...snap, accounts: undefined }, { ...snap, total_assets: snap.total_assets + 5 })
         .some(x => x.key === 'total_assets'));
  }
}

/* ================================================================== */
/* GOLDEN — pinned to the synthetic fixture                            */
/* ================================================================== */

if (isFixture) {
  console.log('\n== GOLDEN (synthetic fixture) ==');
  const { cfg, ledger, asOf } = build({});
  const rec = reconcile(ledger, cfg);
  const bs = balanceSheet(ledger, cfg, asOf);
  const ei = eventIncome(ledger, cfg, asOf);
  const mi = monthlyIncome(ledger, cfg, asOf);

  eq('transactions', rec.rows, 751);
  eq('ledger legs', rec.legs, 1526);
  eq('transaction types', rec.txnTypes.length, 28);
  eq('troop accounts seen', rec.accounts.length, 9);
  eq('funds seen', rec.fundsSeen.length, 33);
  eq('events', rec.eventCount, 19);
  eq('scout accounts', rec.scoutAccounts, 38);
  eq('troop-held (pseudo) accounts', rec.pseudoAccounts.length, 5);
  eq('single-leg entries', rec.singleLegCount, 23);
  ok('undated event is flagged',
     rec.undatedEvents.length === 1 && rec.undatedEvents[0] === 'Council Merit Badge Midway');

  eq('Total Assets', bs.totalAssets, 79904.54);
  eq('Non-cash (Merchandise Inventory)', bs.totalNoncash, 4925.50);
  eq('Scout prepaid', bs.prepaid, 16118.40);
  eq('Arrears count', bs.arrearsCount, 8);
  eq('Arrears total', bs.arrearsTotal, -3871.40);
  eq('Net scout balances', bs.netScout, 12247.00);
  // These six moved when the fixture's as-of went from 2024-08-03 to the
  // month end, 2024-08-31 — required because Monthly Income now reports only
  // completed months, and a mid-month as-of would have dropped August from a
  // window the golden values below assume is the full twelve. The move carries
  // one event, Cedar Gap Biking Campout (08/16/24), across the boundary from
  // future to past. That event nets -29.00, so dropping it out of the future
  // block *raises* the block by 29.00: Other Future Events (Net) and Total
  // Liabilities each go up 29.00 and Unrestricted Net Assets falls by the same.
  // No money was created or lost — one event changed sides.
  eq('Other Future Events (Net)', bs.otherFutureEventsNet, 4918.50);
  eq('Total Liabilities', bs.totalLiabilities, 11380.50);
  eq('Unrestricted Net Assets', bs.unrestricted, 51351.54);

  eq('EI future columns', ei.futureCount, 2);
  eq('EI past columns', ei.columns.length - ei.futureCount, 8);
  eq('EI past events omitted', ei.pastOmitted, 4);
  eq('EI Program Revenue', ei.sections.find(s => s.key === 'Program Revenue').subtotal.total, 35453.75);
  // 148.00 of what used to sit in Program Expenses is reported as Scout Program
  // Expenses. Net Scouting Program is unchanged, which is the whole point of the
  // split: a separate budget line, the same total.
  eq('EI Program Expenses', ei.sections.find(s => s.key === 'Program Expenses').subtotal.total, 31119.15);
  eq('EI Scout Program Expenses', ei.sections.find(s => s.key === 'Scout Program Expenses').subtotal.total, 148.00);
  eq('EI Net Program', ei.nets.find(n => n.group === 'program').total, 4186.60);
  eq('EI Net Unit Fundraising', ei.nets.find(n => n.group === 'unitFundraising').total, 3211.50);
  eq('EI Net Scout Fundraising', ei.nets.find(n => n.group === 'scoutFundraising').total, 6639.50);
  eq('EI Net Total', ei.netTotal.total, 12061.60);
  eq('EI Future total', ei.futureTotal, 4918.50);

  eq('MI months', mi.months.length, 12);
  eq('MI Program Revenue', mi.sections.find(s => s.key === 'Program Revenue').subtotal.total, 19647.75);
  eq('MI Program Expenses', mi.sections.find(s => s.key === 'Program Expenses').subtotal.total, 20231.65);
  eq('MI Scout Program Expenses', mi.sections.find(s => s.key === 'Scout Program Expenses').subtotal.total, 148.00);
  eq('MI Net Program', mi.nets.find(n => n.group === 'program').total, -731.90);
  eq('MI Net Unit Fundraising', mi.nets.find(n => n.group === 'unitFundraising').total, 3211.50);
  eq('MI Net Scout Fundraising', mi.nets.find(n => n.group === 'scoutFundraising').total, 6639.50);
  eq('MI Net Total', mi.netTotal.total, 7143.10);
} else {
  console.log('\n(golden values skipped — external export)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
