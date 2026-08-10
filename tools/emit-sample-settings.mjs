// emit-sample-settings.mjs — regenerate the sample settings file.
//
//   node tools/emit-sample-settings.mjs > test/fixtures/sample-settings.txt
//
// Pairs with test/fixtures/sample-export.csv. Load both into the app and every
// report renders immediately, snapshots included — the fastest way to see what
// the thing does without touching real troop data.
//
// Generated, not hand-maintained. The test suite fails if it has drifted.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../js/csv.js';
import { FUND_CATEGORIES, DEFAULT_ACCOUNT_CLASS, DEFAULT_PARAMS } from '../js/config.js';
import { buildLedger, resolveAsOf } from '../js/ledger.js';
import { balanceSheet } from '../js/reports.js';
import { snapshotFromReport } from '../js/snapshots.js';
import { settingsToText } from '../js/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const records = parseCSV(fs.readFileSync(path.join(here, '..', 'test', 'fixtures', 'sample-export.csv'), 'utf8')).records;

const params = {
  ...DEFAULT_PARAMS,
  troopName: 'Example Troop',
  activitySince: '2023-09-01',
  asOf: '2024-08-31',
  // The synthetic year runs Sep 2023 - Aug 2024, so the sample shows the
  // fiscal-year statement and the budget columns without any setting up.
  fiscalYearStart: 9,
};
// Invented round figures, budgeted by category to show the coarser of the two
// ways in: enough for the Budget and Remaining columns to appear.
const budgets = {
  2023: {
    'Program Revenue': 32000,
    'Program Expenses': 26000,
    // Budgeted separately from Program Expenses and still inside Net Income —
    // Scouting Program, which is what the category exists to show.
    'Scout Program Expenses': 500,
    'Unit Fundraising Revenue': 4000,
    'Unit Fundraising Expenses': 500,
    'Scout Fundraising Revenue': 30000,
    'Scout Fundraising Expenses': 22000,
    'Other Expenses': 1500,
  },
};

const base = { fundCategories: FUND_CATEGORIES, accountClass: DEFAULT_ACCOUNT_CLASS, params, budgets };

const snapshots = {};
for (const d of ['2024-03-01', '2024-06-01', '2024-08-31']) {
  const cfg = { ...base, params: { ...params, asOf: d } };
  const ledger = buildLedger(records, cfg);
  snapshots[d] = snapshotFromReport(balanceSheet(ledger, cfg, resolveAsOf(ledger, cfg.params)));
}

process.stdout.write(settingsToText(base, snapshots));
