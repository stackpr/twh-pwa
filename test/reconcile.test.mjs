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
import { FUND_CATEGORIES, DEFAULT_ACCOUNT_CLASS, DEFAULT_PARAMS, CATEGORY_NAMES } from '../js/config.js';
import { parseYAML, stringifyYAML, YamlError } from '../js/yaml.js';
import { settingsToText, settingsFromText } from '../js/settings.js';
import { snapshotFromReport } from '../js/snapshots.js';
import { execFileSync } from 'node:child_process';
import { buildLedger, reconcile, resolveAsOf, isPseudoAccount } from '../js/ledger.js';
import { balanceSheet, eventIncome, monthlyIncome } from '../js/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'sample-export.csv');
const csvPath = process.argv[2] || FIXTURE;
const isFixture = path.resolve(csvPath) === path.resolve(FIXTURE);

// The fixture's synthetic troop year is Sep 2023 – Aug 2024, as of 2024-08-03.
const FIXTURE_PARAMS = {
  asOf: '2024-08-03',
  activitySince: '2023-09-01',
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
  check('defaults.yaml', 'defaults.yaml', 'tools/emit-defaults.mjs');
  if (isFixture) check('sample-settings.yaml', 'test/fixtures/sample-settings.yaml', 'tools/emit-sample-settings.mjs');

  // The shipped pair must actually work together.
  const sample = settingsFromText(fs.readFileSync(path.join(here, 'fixtures', 'sample-settings.yaml'), 'utf8'));
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
