// emit-sample-settings.mjs — regenerate the sample settings file.
//
//   node tools/emit-sample-settings.mjs > test/fixtures/sample-settings.yaml
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
  asOf: '2024-08-03',
  legacyDeductedAccounts: [
    '_UNIT, Campership (Main)',
    '_UNIT, High Adventure (Main)',
    '_CREW, Venture Crew (Main)',
  ],
};
const base = { fundCategories: FUND_CATEGORIES, accountClass: DEFAULT_ACCOUNT_CLASS, params };

const snapshots = {};
for (const d of ['2024-03-01', '2024-06-01', '2024-08-03']) {
  const cfg = { ...base, params: { ...params, asOf: d } };
  const ledger = buildLedger(records, cfg);
  snapshots[d] = snapshotFromReport(balanceSheet(ledger, cfg, resolveAsOf(ledger, cfg.params)));
}

process.stdout.write(settingsToText(base, snapshots));
