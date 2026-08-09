// ledger.js — CSV records -> canonical ledger.
//
// SIGN CONVENTION, stated once: CREDIT POSITIVE, DEBIT NEGATIVE, on every leg.
// Revenue funds are therefore positive and expense funds negative. Reports flip
// the sign at presentation only, in exactly one place (reports.js:sectionSign).

import { md5 } from './csv.js';
import {
  guessFundCategory, guessAccountClass, budgetYearsFor, CATEGORY_NAMES, categoriesInGroup,
} from './config.js';

// An event is a program event or a fundraiser, and nothing else — the event
// income statement has one Other column, not one per fundraising group. Derived
// from CATEGORY_ORDER rather than from the category names, which stopped sharing
// a prefix when unit and scout fundraising were split apart.
const PROGRAM_CATEGORIES = new Set(categoriesInGroup('program'));
const FUNDRAISING_CATEGORIES = new Set([
  ...categoriesInGroup('unitFundraising'), ...categoriesInGroup('scoutFundraising'),
]);

export const REQUIRED_COLUMNS = [
  'Transaction Type', 'Date', 'Amount',
  'Debit Troop Account', 'Credit Troop Account',
  'Debit Person', 'Credit Person',
  'Debit Event', 'Credit Event',
  'Debit Fund', 'Credit Fund',
];

const EVENT_DATE_RE = /\((\d{2})\/(\d{2})\/(\d{2})\)\s*$/;

export function parseEventDate(name) {
  if (!name) return null;
  const m = EVENT_DATE_RE.exec(name);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  // TWH emits 2-digit years; the ledger starts in 2020, so 70..99 -> 19xx is safe.
  const year = Number(yy) >= 70 ? 1900 + Number(yy) : 2000 + Number(yy);
  return new Date(year, Number(mm) - 1, Number(dd));
}

function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function parseAmount(s) {
  if (s === null || s === undefined || s === '') return 0;
  const v = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
}

export const isPseudoAccount = name => !!name && name.startsWith('_');

function hashPerson(name, salt) {
  if (isPseudoAccount(name)) return name;   // troop-held fund, not a person
  return 'scout:' + md5(salt + name).slice(0, 8);
}

/**
 * Build the canonical ledger. Person names are hashed here and the originals
 * are never retained past this function's stack frame.
 */
export function buildLedger(records, cfg) {
  const errors = [], warnings = [];
  const params = cfg.params;

  const missing = REQUIRED_COLUMNS.filter(c => records.length && !(c in records[0]));
  if (missing.length) {
    errors.push(`Export is missing required column(s): ${missing.join(', ')}`);
    // Same shape as a successful build, so callers never have to test for this
    // early return. An empty ledger says nothing about the chart of accounts.
    return { errors, warnings, legs: [], txns: [], events: [], latestTxn: null, unknownFunds: [], unknownAccounts: [] };
  }

  const legs = [];   // {i, date, kind, key, amount, event, fund, txnType}
  const txns = [];
  const eventNames = new Set();
  const unknownFunds = new Set();
  const unknownAccounts = new Set();

  records.forEach((r, i) => {
    const date = parseDate(r['Date']);
    if (!date) { warnings.push(`Row ${i + 2}: unparseable date "${r['Date']}" — row skipped.`); return; }
    const amount = parseAmount(r['Amount']);
    const debitEvent = r['Debit Event'], creditEvent = r['Credit Event'];

    // Event attribution: prefer the debit side; fall back to credit. When both
    // are present they are always the same event in practice, so the
    // transaction is attributed to it rather than to neither — leaving it
    // unattributed would drop the row from the by-event report entirely.
    const event = debitEvent || creditEvent || null;
    if (event) eventNames.add(event);

    const txn = {
      i, date, amount, event,
      type: r['Transaction Type'],
      description: r['Description'] || null,
      fiscalYear: r['Fiscal Year'] || null,
    };
    txns.push(txn);

    const push = (kind, key, amt) => {
      if (!key) return;
      legs.push({ i, date, kind, key, amount: amt, event, txnType: txn.type });
    };

    // --- asset legs ---
    push('asset', r['Credit Troop Account'],  amount);
    push('asset', r['Debit Troop Account'],  -amount);
    for (const a of [r['Credit Troop Account'], r['Debit Troop Account']]) {
      if (a && !(a in cfg.accountClass)) unknownAccounts.add(a);
    }

    // --- person legs (hashed) ---
    if (r['Credit Person']) push('person', hashPerson(r['Credit Person'], params.hashSalt),  amount);
    if (r['Debit Person'])  push('person', hashPerson(r['Debit Person'],  params.hashSalt), -amount);

    // --- fund legs ---
    if (r['Credit Fund']) { push('fund', r['Credit Fund'],  amount); if (!(r['Credit Fund'] in cfg.fundCategories)) unknownFunds.add(r['Credit Fund']); }
    if (r['Debit Fund'])  { push('fund', r['Debit Fund'],  -amount); if (!(r['Debit Fund']  in cfg.fundCategories)) unknownFunds.add(r['Debit Fund']); }
  });

  // Hard stops. A silently-dropped account or fund is the failure mode that
  // makes spreadsheet-era tooling untrustworthy: a figure quietly counted as
  // zero reads exactly like a figure that is zero. Refuse to render instead.
  if (unknownFunds.size)
    errors.push(`Fund(s) not present in the category map: ${[...unknownFunds].join(', ')}. Add them under Configuration before the reports can be produced.`);
  if (unknownAccounts.size)
    errors.push(`Troop account(s) not classified: ${[...unknownAccounts].join(', ')}. Classify each as cash / noncash / liability under Configuration.`);

  // Event catalogue
  const events = [...eventNames].map(name => {
    const date = parseEventDate(name);
    if (!date) warnings.push(`Event "${name}" has no trailing (MM/DD/YY) date — it cannot be placed on the timeline and will fall into Other.`);
    const fundLegs = legs.filter(l => l.kind === 'fund' && l.event === name);
    return {
      name, date,
      kind: 'program',   // set by classifyEvents below
      allTimeNet: fundLegs.reduce((s, l) => s + l.amount, 0),
    };
  });

  const latestTxn = txns.reduce((m, t) => (!m || t.date > m ? t.date : m), null);

  const ledger = {
    errors, warnings, legs, txns, events, latestTxn,
    unknownFunds: [...unknownFunds].sort(),
    unknownAccounts: [...unknownAccounts].sort(),
  };
  classifyEvents(ledger, cfg);
  return ledger;
}

/**
 * Decide program vs fundraising for each event, by majority of its fund legs.
 *
 * Split out of buildLedger because it is the ONLY part of the ledger that
 * depends on the chart of accounts. Everything else — legs, amounts, hashed
 * person keys, dates — is a function of the export alone. That is what lets a
 * classification be corrected without re-reading the file: the ledger stays,
 * this runs again. The export itself is never retained, so a change that needed
 * the raw rows would cost the treasurer another trip to TroopWebHost.
 */
export function classifyEvents(ledger, cfg) {
  for (const e of ledger.events) {
    let program = 0, fundraising = 0;
    for (const l of ledger.legs) {
      if (l.kind !== 'fund' || l.event !== e.name) continue;
      const cat = cfg.fundCategories[l.key] || '';
      if (PROGRAM_CATEGORIES.has(cat)) program++;
      else if (FUNDRAISING_CATEGORIES.has(cat)) fundraising++;
    }
    e.kind = program >= fundraising ? 'program' : 'fundraising';
  }
  return ledger;
}

/**
 * Names in the loaded export that the chart of accounts no longer classifies.
 *
 * buildLedger checks this as it reads the rows; this checks the same thing
 * against a ledger already built, which is what a chart edited after the import
 * needs. Removing a fund that the export uses has to stop the reports the same
 * way an unknown fund at import time does — otherwise its legs would simply
 * stop being counted, which is the silent under-reporting this app exists to
 * prevent.
 */
export function validateChart(ledger, cfg) {
  const unknownFunds = new Set(), unknownAccounts = new Set(), badCategories = new Map();
  for (const l of ledger.legs) {
    if (l.kind === 'fund') {
      if (!(l.key in cfg.fundCategories)) { unknownFunds.add(l.key); continue; }
      // A fund mapped to a category no section claims is worse than an
      // unclassified one: it looks configured, and its legs are counted into
      // nothing. This is what a hand-edited settings file written against an
      // older category list produces, so it halts the same way.
      const cat = cfg.fundCategories[l.key];
      if (!CATEGORY_NAMES.includes(cat)) badCategories.set(l.key, cat);
    } else if (l.kind === 'asset' && !(l.key in cfg.accountClass)) unknownAccounts.add(l.key);
  }
  return {
    unknownFunds: [...unknownFunds].sort(),
    unknownAccounts: [...unknownAccounts].sort(),
    badCategories: [...badCategories.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}

/**
 * Compare the chart of accounts against what this export actually contains.
 *
 * Two directions, both worth knowing at import time. Names in the export that
 * the settings do not classify would otherwise halt the load, so each comes with
 * a guessed classification and the evidence behind it — the fund's net and how
 * many legs it appears on — for a treasurer to confirm or correct. Names in the
 * settings with no activity in the export are the opposite problem: last year's
 * chart accumulating entries nobody removed.
 *
 * Only the second direction is destructive, and it is only ever offered, never
 * applied. An export covering a short period would list most of the chart as
 * unused; the TroopWebHost export this app expects covers all transactions.
 */
export function chartReview(ledger, cfg) {
  const fundNet = new Map(), fundLegCount = new Map(), accountsSeen = new Set();
  for (const l of ledger.legs) {
    if (l.kind === 'fund') {
      fundNet.set(l.key, (fundNet.get(l.key) || 0) + l.amount);
      fundLegCount.set(l.key, (fundLegCount.get(l.key) || 0) + 1);
    } else if (l.kind === 'asset') {
      accountsSeen.add(l.key);
    }
  }

  return {
    newFunds: ledger.unknownFunds.map(name => ({
      name,
      net: fundNet.get(name) || 0,
      legs: fundLegCount.get(name) || 0,
      guess: guessFundCategory(name, fundNet.get(name) || 0),
    })),
    newAccounts: ledger.unknownAccounts.map(name => ({
      name,
      guess: guessAccountClass(name),
    })),
    // A budgeted fund is deliberately not offered for bulk removal: its budget
    // has to go somewhere, and choosing where is a decision per fund. It is
    // named instead, so it is not simply missing from the list.
    unusedFunds: Object.keys(cfg.fundCategories)
      .filter(n => !fundNet.has(n) && !budgetYearsFor(cfg.budgets, n).length).sort(),
    unusedBudgetedFunds: Object.keys(cfg.fundCategories)
      .filter(n => !fundNet.has(n) && budgetYearsFor(cfg.budgets, n).length).sort(),
    unusedAccounts: Object.keys(cfg.accountClass).filter(n => !accountsSeen.has(n)).sort(),
  };
}

/** min(latest transaction date, today) unless explicitly overridden. */
export function resolveAsOf(ledger, params) {
  if (params.asOf) return new Date(params.asOf + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return ledger.latestTxn && ledger.latestTxn < today ? ledger.latestTxn : today;
}

/**
 * Reconciliation panel data, surfaced before any report renders.
 *
 * Note there is deliberately NO "all legs net to zero" assertion. TWH is not a
 * strict double-entry system: "Credit Troop Account" and "Credit Person" both
 * mean "money in", so an asset and a liability can both increase on the same
 * transaction. Opening balances are also typically booked through a fund account
 * with fiscal year "Opening", which inflates all-time fund totals. Both are why
 * the reports use period-limited views rather than an all-time roll-forward.
 */
export function reconcile(ledger, cfg) {
  const sum = pred => ledger.legs.filter(pred).reduce((s, l) => s + l.amount, 0);
  const legCount = new Map();
  for (const l of ledger.legs) legCount.set(l.i, (legCount.get(l.i) || 0) + 1);
  const singleLeg = ledger.txns.filter(t => (legCount.get(t.i) || 0) < 2);

  return {
    rows: ledger.txns.length,
    legs: ledger.legs.length,
    assetTotal:  sum(l => l.kind === 'asset'),
    personTotal: sum(l => l.kind === 'person'),
    fundTotal:   sum(l => l.kind === 'fund'),
    // Unbalanced entries are legitimate here (opening-balance imports and
    // *-prefixed adjustment types), but the count should be stable month to
    // month. A jump means someone posted something unusual.
    singleLegCount: singleLeg.length,
    singleLegTypes: [...new Set(singleLeg.map(t => t.type))].sort(),
    accounts: [...new Set(ledger.legs.filter(l => l.kind === 'asset').map(l => l.key))].sort(),
    fundsSeen: [...new Set(ledger.legs.filter(l => l.kind === 'fund').map(l => l.key))].sort(),
    txnTypes: [...new Set(ledger.txns.map(t => t.type))].sort(),
    eventCount: ledger.events.length,
    undatedEvents: ledger.events.filter(e => !e.date).map(e => e.name),
    scoutAccounts: new Set(ledger.legs.filter(l => l.kind === 'person' && !isPseudoAccount(l.key)).map(l => l.key)).size,
    pseudoAccounts: [...new Set(ledger.legs.filter(l => l.kind === 'person' && isPseudoAccount(l.key)).map(l => l.key))].sort(),
  };
}
