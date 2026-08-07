// reconcile.test.mjs — regression test.
//
//   node test/reconcile.test.mjs                       # synthetic fixture (default)
//   node test/reconcile.test.mjs path/to/export.csv    # your own export, invariants only
//
// Two kinds of assertion:
//
//   INVARIANTS hold for any well-formed export. They are the properties the
//   reports must never violate — Other + columns == Total, net income equals
//   revenue minus expenses, liabilities equal the sum of their parts, totals
//   independent of the column limit, and the documented differences between
//   legacy and corrected mode. These run against whatever file you point at.
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
  guessFundCategory, guessAccountClass, fiscalYearOf, fiscalYearLabel,
  budgetYearsFor, mergeBudgetLine,
} from '../js/config.js';
import { parseYAML, stringifyYAML, YamlError } from '../js/yaml.js';
import { settingsToText, settingsFromText } from '../js/settings.js';
import { snapshotFromReport } from '../js/snapshots.js';
import { execFileSync } from 'node:child_process';
import { buildLedger, reconcile, resolveAsOf, isPseudoAccount, chartReview, classifyEvents, validateChart } from '../js/ledger.js';
import { balanceSheet, eventIncome, monthlyIncome } from '../js/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'sample-export.csv');
const csvPath = process.argv[2] || FIXTURE;
const isFixture = path.resolve(csvPath) === path.resolve(FIXTURE);

// The fixture's synthetic troop year is Sep 2023 – Aug 2024, as of 2024-08-03.
const FIXTURE_PARAMS = {
  asOf: '2024-08-03',
  activitySince: '2023-09-01',
  // The synthetic year runs Sep 2023 - Aug 2024, so a September fiscal year
  // covers exactly it. The monthly golden values are the same twelve months
  // either way, which is what keeps them comparable across this change.
  fiscalYearStart: 9,
  // Legacy mode needs the hand-maintained deduction list a predecessor
  // spreadsheet would have carried. Two of the fixture's troop-held accounts are
  // deliberately absent from it, which is what reproduces the double-count.
  legacyDeductedAccounts: [
    '_UNIT, Campership (Main)',
    '_UNIT, High Adventure (Main)',
    '_CREW, Venture Crew (Main)',
  ],
};

const records = parseCSV(fs.readFileSync(csvPath, 'utf8')).records;
console.log(`${isFixture ? 'fixture' : 'external'}: ${path.basename(csvPath)} — ${records.length} transactions\n`);

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
  fundCategories: { ...FUND_CATEGORIES },
  accountClass: { ...DEFAULT_ACCOUNT_CLASS },
  params: { ...DEFAULT_PARAMS, ...(isFixture ? FIXTURE_PARAMS : {}), ...over },
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
  const { cfg, ledger, asOf } = build({ legacyMode: false });
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

  eq('Event Income: Other + all columns == Total',
     ei.netTotal.other + ei.netTotal.cols.reduce((a, b) => a + b, 0), ei.netTotal.total);

  eq('Event Income: net total == program + fundraising + other',
     ei.netTotal.total, ei.netProgram.total + ei.netFundraising.total + ei.netOther.total);

  eq('Event Income: net program == revenue - expenses', ei.netProgram.total,
     ei.sections.find(s => s.key === 'Program Revenue').subtotal.total
     - ei.sections.find(s => s.key === 'Program Expenses').subtotal.total);

  eq('Monthly Income: net total == program + fundraising + other',
     mi.netTotal.total, mi.netProgram.total + mi.netFundraising.total + mi.netOther.total);

  eq('Monthly Income: total column == sum of month columns',
     mi.netTotal.total, mi.netTotal.cols.reduce((a, b) => a + b, 0));

  ok('No fundraising event appears as an Event Income column',
     ei.columns.every(c => c.kind === 'program'));

  // The column limit is a page-fit control, never an accounting change.
  const wide = build({ legacyMode: false, pastEventsShown: 30 });
  const eiWide = eventIncome(wide.ledger, wide.cfg, wide.asOf);
  eq('Totals independent of pastEventsShown', eiWide.netTotal.total, ei.netTotal.total);
  eq('Future total independent of pastEventsShown', eiWide.futureTotal, ei.futureTotal);

  // The balance sheet is not date-filtered: future pre-charges are already in it.
  const later = build({ legacyMode: false, asOf: '2030-01-01' });
  const bsLater = balanceSheet(later.ledger, later.cfg, later.asOf);
  eq('Total Assets unaffected by as-of date', bsLater.totalAssets, bs.totalAssets);
  ok('Future-event liability shrinks as events pass',
     bsLater.otherFutureEventsNet <= bs.otherFutureEventsNet + 0.005);
}

console.log('\n== FISCAL YEAR AND BUDGET ==');
{
  // The fixture's synthetic year runs Sep 2023 - Aug 2024, as of 2024-08-03,
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

  const base = build({ fiscalYearStart: SEP });
  const fy = monthlyIncome(base.ledger, base.cfg, base.asOf);
  eq('fiscal year to date spans Sep to Aug', fy.months.length, 12);
  ok('the window starts at the fiscal year start',
     fy.months[0].label.startsWith('Sep') && fy.months.at(-1).label.startsWith('Aug'));
  ok('the report knows which fiscal year it is', fy.fiscalYear === 2023);
  ok('no budget means no budget columns', fy.hasBudget === false);

  // Without a fiscal year nothing about the report may change.
  const rolling = monthlyIncome(build({}).ledger, mk({ fiscalYearStart: null }), base.asOf);
  eq('no fiscal year keeps the rolling window', rolling.months.length, DEFAULT_PARAMS.monthsShown);
  ok('no fiscal year means no fiscal framing', rolling.fiscalYear === null && rolling.hasBudget === false);

  // A budget on a category and on one fund inside it.
  const withBudget = {
    ...mk({ fiscalYearStart: SEP }),
    budgets: { 2023: { 'Program Expenses': 10000, 'Food Expense': 1500, 'Program Revenue': 40000 } },
  };
  const b = monthlyIncome(base.ledger, withBudget, base.asOf);
  ok('a budget for the year on show turns the columns on', b.hasBudget === true);
  const progExp = b.sections.find(s => s.key === 'Program Expenses');
  const food = progExp.funds.find(f => f.label === 'Food Expense');
  eq('a fund carries its own budget', food.budget, 1500);
  ok('an unbudgeted fund carries none',
     progExp.funds.filter(f => f.label !== 'Food Expense').every(f => f.budget === null));
  eq('the section adds the category figure to the funds budgeted inside it',
     progExp.subtotal.budget, 11500);
  eq('net program budget is budgeted revenue less budgeted expenses',
     b.netProgram.budget, 40000 - 11500);
  ok('a fully budgeted net line is not flagged partial', b.netProgram.budgetPartial === false);

  // Remaining is what the renderer prints; assert the arithmetic it relies on.
  eq('remaining is budget less the fiscal year to date',
     progExp.subtotal.budget - progExp.subtotal.total, 11500 - progExp.subtotal.total);

  // Half a budget must stay visibly half.
  const oneSided = { ...mk({ fiscalYearStart: SEP }), budgets: { 2023: { 'Other Income': 100 } } };
  const os = monthlyIncome(base.ledger, oneSided, base.asOf);
  ok('a net line budgeted on one side only is flagged', os.netOther.budgetPartial === true);
  eq('and counts only the side that was budgeted', os.netOther.budget, 100);
  ok('an unbudgeted section stays null',
     os.sections.find(s => s.key === 'Program Revenue').subtotal.budget === null);

  // A budget for another year must not leak into this one.
  const otherYear = { ...mk({ fiscalYearStart: SEP }), budgets: { 2030: { 'Program Revenue': 1 } } };
  ok('a budget for a different fiscal year is not shown',
     monthlyIncome(base.ledger, otherYear, base.asOf).hasBudget === false);

  // A budgeted fund with no activity still needs its line, or its budget is invisible.
  const dormant = {
    ...mk({ fiscalYearStart: SEP }),
    budgets: { 2023: { 'Crew Revenue (from Scout)': 750 } },
  };
  const d = monthlyIncome(base.ledger, dormant, base.asOf);
  const row = d.sections.flatMap(s => s.funds).find(f => f.label === 'Crew Revenue (from Scout)');
  ok('a budgeted fund with no activity still gets a row', !!row);
  ok('and shows its whole budget as remaining', row && row.budget === 750 && Math.abs(row.total) < 0.005);

  // The figures themselves must not move because a budget was entered.
  eq('a budget changes no actual', b.netTotal.total, fy.netTotal.total);
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

console.log('\n== CLASSIFICATION GUESSES ==');
{
  const g = (name, net = 0) => guessFundCategory(name, net);
  ok('"Expense" in the name means an expense', g('Camping (Weekend) Expense', 500) === 'Program Expenses');
  ok('"Revenue" in the name means revenue', g('Registration Revenue', -20) === 'Program Revenue');
  ok('a fundraiser word picks the fundraising section', g('Popcorn Revenue') === 'Fundraising Revenue');
  ok('fundraising expense too', g('Popcorn Expense') === 'Fundraising Expenses');
  ok('administrative words pick Other', g('Administrative Expenses') === 'Other Expenses');
  ok('interest is Other Income', g('Interest and Dividends', 12) === 'Other Income');
  // With no word to go on, the sign of the fund's net in the export decides.
  ok('unnamed positive net guesses revenue', g('Something New', 250) === 'Program Revenue');
  ok('unnamed negative net guesses an expense', g('Something New', -250) === 'Program Expenses');
  // A section word must not be read as a side word. Money donated by the troop
  // and money donated to it share the noun and point opposite ways.
  ok('a donation received is revenue', g('General Donation', 400) === 'Fundraising Revenue');
  ok('a donation made is an expense', g('Donations by Troop', -400) === 'Fundraising Expenses');

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
  const shipped = Object.entries(FUND_CATEGORIES);
  const agree = shipped.filter(([n, c]) => g(n, c.includes('Expense') ? -100 : 100) === c).length;
  ok(`guess agrees with ${agree}/${shipped.length} of the shipped example chart`,
     agree >= shipped.length * 0.75);
}

console.log('\n== EVENT RECLASSIFICATION ==');
{
  // A category change must not require re-reading the export. Reclassifying in
  // place has to land exactly where a fresh build would.
  const { ledger, cfg } = build({});
  const moved = {
    ...cfg,
    fundCategories: Object.fromEntries(Object.entries(cfg.fundCategories)
      .map(([f, c]) => [f, c === 'Program Revenue' ? 'Fundraising Revenue' : c])),
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
    '  legacyMode: false',
    '  asOf: null',
    '  legacyDeductedAccounts: []',
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
  ok('booleans stay booleans', doc.parameters.legacyMode === false);
  ok('null parses as null', doc.parameters.asOf === null);
  ok('empty list parses as []', Array.isArray(doc.parameters.legacyDeductedAccounts)
     && doc.parameters.legacyDeductedAccounts.length === 0);
  ok('empty quoted string stays a string', doc.parameters.hashSalt === '');
  ok('sequences parse', doc.list[0] === 'alpha' && doc.list[1] === 'quoted: with colon');
  ok('quoted key containing a colon parses', doc.funds['Odd: Name'] === 'Program Revenue');
  ok('slashes in keys need no quoting', doc.funds['Equipment/Merch Expense'] === 'Program Expenses');

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
  const snaps = { '2024-08-03': { total_assets: 1234.5, scout_arrears_count: 3, unrestricted_net_assets: -12 } };
  const text = settingsToText(cfg, snaps);
  const back = settingsFromText(text);

  ok('settings round-trip without error', back.errors.length === 0);
  eq('round-trip preserves fund count',
     Object.keys(back.config.fundCategories).length, Object.keys(cfg.fundCategories).length);
  eq('round-trip preserves account count',
     Object.keys(back.config.accountClass).length, Object.keys(cfg.accountClass).length);
  ok('round-trip preserves parameter types',
     back.config.params.pastEventsShown === cfg.params.pastEventsShown
     && back.config.params.legacyMode === cfg.params.legacyMode
     && Array.isArray(back.config.params.legacyDeductedAccounts));
  eq('round-trip preserves a snapshot figure', back.snapshots['2024-08-03'].total_assets, 1234.5);
  eq('round-trip preserves an integer count', back.snapshots['2024-08-03'].scout_arrears_count, 3);
  eq('round-trip preserves a negative figure', back.snapshots['2024-08-03'].unrestricted_net_assets, -12);
  ok('currency keeps two decimal places in the file', /total_assets: 1234\.50/.test(text));

  // Budgets and the fiscal year live in the settings file too — TroopWebHost
  // has no idea they exist, so this file is the only copy there is.
  const budgeted = { ...mk({ fiscalYearStart: 9 }), budgets: { 2023: { 'Program Revenue': 40000, 'Food Expense': 1500.5 } } };
  const bText = settingsToText(budgeted, {});
  const bBack = settingsFromText(bText);
  ok('budget round-trips without error', bBack.errors.length === 0);
  eq('round-trip preserves a budget figure', bBack.config.budgets['2023']['Program Revenue'], 40000);
  eq('round-trip preserves budget cents', bBack.config.budgets['2023']['Food Expense'], 1500.5);
  ok('round-trip preserves the fiscal year start', bBack.config.params.fiscalYearStart === 9);
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
  ok('a settings file with no budget has an empty budget section',
     settingsFromText(text).config.budgets && Object.keys(settingsFromText(text).config.budgets).length === 0);
  ok('the budget carries no scout identifiers', !/scout:[0-9a-f]{8}/.test(bText));
  ok('every shipped fund maps to a known category',
     Object.values(cfg.fundCategories).every(c => CATEGORY_NAMES.includes(c)));
  ok('settings file carries no scout identifiers', !/scout:[0-9a-f]{8}/.test(text));

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
       sample.snapshots['2024-08-03'].unrestricted_net_assets, Math.round(snap.unrestricted_net_assets * 100) / 100);
  }
}

console.log('\n== LEGACY vs CORRECTED ==');
{
  const c = build({ legacyMode: false });
  const l = build({ legacyMode: true });
  const bsC = balanceSheet(c.ledger, c.cfg, c.asOf);
  const bsL = balanceSheet(l.ledger, l.cfg, l.asOf);

  eq('Assets identical in both modes', bsL.totalAssets, bsC.totalAssets);
  eq('Liabilities identical in both modes', bsL.totalLiabilities, bsC.totalLiabilities);
  ok('Legacy counts more accounts in arrears (pseudo accounts included)',
     bsL.arrearsCount >= bsC.arrearsCount);
  ok('Legacy understates net scout balances (arrears double-counted)',
     bsL.netScout < bsC.netScout);
  ok('Legacy therefore overstates unrestricted net assets',
     bsL.unrestricted > bsC.unrestricted);
}

/* ================================================================== */
/* GOLDEN — pinned to the synthetic fixture                            */
/* ================================================================== */

if (isFixture) {
  console.log('\n== GOLDEN (synthetic fixture) ==');
  const { cfg, ledger, asOf } = build({ legacyMode: false });
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
  eq('Other Future Events (Net)', bs.otherFutureEventsNet, 4889.50);
  eq('Total Liabilities', bs.totalLiabilities, 11351.50);
  eq('Unrestricted Net Assets', bs.unrestricted, 51380.54);

  eq('EI future columns', ei.futureCount, 3);
  eq('EI past columns', ei.columns.length - ei.futureCount, 8);
  eq('EI past events omitted', ei.pastOmitted, 3);
  eq('EI Program Revenue', ei.sections.find(s => s.key === 'Program Revenue').subtotal.total, 35453.75);
  eq('EI Program Expenses', ei.sections.find(s => s.key === 'Program Expenses').subtotal.total, 31267.15);
  eq('EI Net Program', ei.netProgram.total, 4186.60);
  eq('EI Net Total', ei.netTotal.total, 12061.60);
  eq('EI Future total', ei.futureTotal, 4889.50);

  eq('MI months', mi.months.length, 12);
  eq('MI Program Revenue', mi.sections.find(s => s.key === 'Program Revenue').subtotal.total, 19647.75);
  eq('MI Program Expenses', mi.sections.find(s => s.key === 'Program Expenses').subtotal.total, 20379.65);
  eq('MI Net Program', mi.netProgram.total, -731.90);
  eq('MI Net Total', mi.netTotal.total, 7143.10);

  const l = build({ legacyMode: true });
  const bsL = balanceSheet(l.ledger, l.cfg, l.asOf);
  eq('legacy prepaid', bsL.prepaid, 12657.00);
  eq('legacy arrears count', bsL.arrearsCount, 9);
  eq('legacy net scout balances', bsL.netScout, 8628.35);
  eq('legacy unrestricted net assets', bsL.unrestricted, 54999.19);
} else {
  console.log('\n(golden values skipped — external export)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
