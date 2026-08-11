// settings.js — the settings file.
//
// One human-editable document holding everything except the transactions: the
// troop name, report parameters, the chart of accounts, and the balance-sheet
// snapshots. This file plus a fresh TroopWebHost export is enough to get a new
// treasurer running from nothing.
//
// It is YAML, written with a .txt extension, and one extension is all the app
// offers. The choice is deliberate: on Windows a .yaml opens in whatever happens
// to be registered, or in nothing, while .txt reliably opens in Notepad. The
// people inheriting this file are volunteers, not developers, and the format is
// not something they should have to know about — nothing in the interface
// mentions YAML. The extension is never read on load either; the content decides.
//
// It contains NO personal data — no scout names, no per-account balances, no
// transactions. Only configuration and whole-troop totals. It is safe to email
// to a successor; a transaction export never is.

import { parseYAML, stringifyYAML, YamlError, raw } from './yaml.js';
import { CATEGORY_NAMES, DEFAULT_PARAMS, RENAMED_CATEGORIES } from './config.js';
import { BS_ROW_KEYS } from './snapshots.js';

export const SETTINGS_VERSION = 1;
export const SETTINGS_FILENAME = 'troop-settings.txt';

const ACCOUNT_CLASSES = ['cash', 'noncash', 'liability'];

/* ---------------------------- writing ---------------------------- */

const block = (comment, key, value) => [
  ...comment.map(c => (c ? `# ${c}` : '#')),
  ...stringifyYAML({ [key]: value }),
  '',
];

/**
 * Render the settings document. Section comments are written by hand rather than
 * generated, because they are instructions for a human editor and the emitter
 * has no business inventing prose.
 */
export function settingsToText(cfg, snapshots = {}, budgets = cfg.budgets || {}) {
  const params = { ...DEFAULT_PARAMS, ...cfg.params };
  const lines = [
    '# ---------------------------------------------------------------------',
    '# Troop Finance Reports — settings',
    '#',
    '# Edit this file in any plain text editor (Notepad, TextEdit, Notepad++).',
    '# Keep the two-space indentation. Do not use tabs. Lines starting with #',
    '# are comments and are ignored.',
    '#',
    '# This file plus a fresh TroopWebHost transaction export is everything',
    '# needed to produce the reports. It contains no scout names, no individual',
    '# balances, and no transactions — only settings and whole-troop totals, so',
    '# it is safe to hand to a successor. A transaction export is NOT.',
    '# ---------------------------------------------------------------------',
    '',
    `version: ${SETTINGS_VERSION}`,
    '',
  ];

  lines.push(...block(
    ['Printed above each report. Leave empty for none.'],
    'troop', { name: params.troopName || '' }));

  lines.push(...block([
    'Report parameters.',
    '',
    '  activitySince           start of the reporting period (YYYY-MM-DD).',
    '                          Activity before this date is reported on the',
    '                          Prior Period line rather than in the totals.',
    '  pastEventsShown         how many past events get a column on the event',
    '                          income statement. Purely a page-fit control —',
    '                          totals never change with it.',
    '  futureEventsShown       the same, for events still to come. The Future',
    '                          column counts every one of them regardless.',
    '  monthsShown             months in the monthly income statement, when no',
    '                          fiscal year is set.',
    '  fiscalYearStart         month your fiscal year begins, 1-12. Defaults to',
    '                          1, January. The monthly income statement covers',
    '                          the fiscal year to date, which is what a budget',
    '                          compares against. null instead gives a rolling',
    '                          window of monthsShown months, and no budget.',
    '  asOf                    report date (YYYY-MM-DD), or null for today.',
    '  earliestFiscalYear      first year on the year-on-year comparison, or',
    '                          null for every year in the export. Set it past',
    '                          the years your records were still being migrated.',
    '  showCents               true prints cents, false rounds to whole dollars.',
    '                          Display only \u2014 every figure is computed to the',
    '                          cent either way.',
    '  emergencyFund           a reserve you have decided not to treat as',
    '                          spendable. Reported under Liabilities so it comes',
    '                          off Available Unit Funds. 0 prints no line.',
    '  hashSalt                changes the anonymised scout identifiers. Leave',
    '                          empty unless you have a reason.',
  ], 'parameters', {
    activitySince: params.activitySince,
    pastEventsShown: params.pastEventsShown,
    futureEventsShown: params.futureEventsShown,
    monthsShown: params.monthsShown,
    fiscalYearStart: params.fiscalYearStart ?? null,
    asOf: params.asOf ?? null,
    earliestFiscalYear: params.earliestFiscalYear ?? null,
    showCents: params.showCents !== false,
    emergencyFund: Number(params.emergencyFund) || 0,
    hashSalt: params.hashSalt || '',
  }));

  lines.push(...block([
    'Troop accounts, and where each belongs on the balance sheet.',
    '',
    '  cash       counts toward Total Assets',
    '  noncash    counts toward Total Assets, but is deducted from Unrestricted',
    '             Net Assets because it cannot be spent (e.g. inventory)',
    '  liability  shown under Liabilities, sign inverted (e.g. a credit card)',
    '',
    'Every account appearing in the export must be listed here, or the reports',
    'will refuse to run. That is deliberate: an unlisted account would silently',
    'vanish from the balance sheet.',
  ], 'accounts', sortedMap(cfg.accountClass)));

  lines.push(...block([
    'Your chart of accounts: each TroopWebHost fund and its category.',
    '',
    'Allowed categories (this list is fixed):',
    ...CATEGORY_NAMES.map(c => `  ${c}`),
    '',
    'Scout Program Expenses is spending the scouts themselves direct; it gets',
    'its own budget line and still nets into Net Income - Scouting Program.',
    'Scout Fundraising is fundraising whose proceeds are credited to scout',
    'accounts rather than kept by the unit, so it nets to about nothing.',
    '',
    'This also decides which events get a column on the event income statement.',
    'An event whose activity is mostly program is a program event; one that is',
    'mostly fundraising, of either kind, is not, and rolls into Other.',
    '',
    'Every fund appearing in the export must be listed here, or the reports will',
    'refuse to run.',
  ], 'funds', sortedMap(cfg.fundCategories)));

  lines.push(...block([
    'Budgets, by the calendar year each fiscal year starts in. The year',
    'beginning September 2024 is 2024, whatever your troop calls it.',
    '',
    'Each line is a fund name or one of the category names above:',
    '',
    '  Program Expenses: 12000     the whole category',
    '  Food Expense: 3000          one fund inside it',
    '',
    'Use either, or both: a category figure covers whatever in that category',
    'you did not budget by fund, so the two add up on the section total.',
    'Enter every figure as a positive number — expenses are budgeted as',
    'spending, the same way they are printed on the income statement.',
    '',
    'Budgets exist only in this app. TroopWebHost has no record of them, so',
    'this file is the only copy. They appear on the monthly income statement',
    'as Budget and Remaining columns, for the fiscal year the report covers,',
    'and only when fiscalYearStart is set.',
  ], 'budgets', roundBudgets(budgets)));

  lines.push(...block([
    'Balance sheet figures as published, frozen by date. These are not',
    'recalculated — they are the record of what was actually reported, so a',
    'back-dated correction shows up as drift instead of quietly rewriting',
    'history. Only the balance sheet is snapshotted; the income statements are',
    'period reports and are always recomputed.',
    '',
    'Added by the app when you capture a snapshot. Safe to edit or delete a',
    'whole date, but there is rarely a reason to.',
    '',
    'Under "accounts" each date carries the troop accounts, the card and the',
    'troop-held funds as that balance sheet showed them. An account that has',
    'since closed keeps its figures here, though the reports no longer have a',
    'row to show them on. Scout balances are only ever the two whole-troop',
    'figures above — no individual balance is written here.',
  ], 'snapshots', roundSnapshots(snapshots)));

  return lines.join('\r\n').replace(/(\r\n)+$/, '\r\n');
}

const sortedMap = obj => Object.fromEntries(Object.keys(obj || {}).sort().map(k => [k, obj[k]]));

function roundBudgets(budgets) {
  const out = {};
  for (const year of Object.keys(budgets || {}).sort()) {
    const row = {};
    for (const name of Object.keys(budgets[year] || {}).sort()) {
      const v = Number(budgets[year][name]);
      if (!Number.isFinite(v) || v === 0) continue;   // an unset line is absent, not zero
      row[name] = raw(v.toFixed(2));
    }
    if (Object.keys(row).length) out[year] = row;
  }
  return out;
}

function roundSnapshots(snaps) {
  const out = {};
  for (const date of Object.keys(snaps || {}).sort()) {
    const row = {};
    for (const key of BS_ROW_KEYS) {
      const v = snaps[date][key];
      if (v === undefined) continue;
      row[key] = key.endsWith('_count') ? Math.round(v) : raw(v.toFixed(2));
    }
    // Account lines last, under their own heading: a reader scanning for Total
    // Assets should not have to walk past a bank account list to find it.
    const accounts = snaps[date].accounts || {};
    const named = {};
    for (const name of Object.keys(accounts).sort()) {
      const v = Number(accounts[name]);
      if (Number.isFinite(v)) named[name] = raw(v.toFixed(2));
    }
    if (Object.keys(named).length) row.accounts = named;
    out[date] = row;
  }
  return out;
}

/* ---------------------------- reading ---------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse and validate a settings file. Returns everything it could read plus a
 * list of problems; the caller decides whether to apply it. Validation is picky
 * on purpose — a typo in a category name would otherwise misfile a whole fund.
 */
export function settingsFromText(text) {
  const errors = [], warnings = [];
  let doc;
  try {
    doc = parseYAML(text);
  } catch (e) {
    if (e instanceof YamlError) return { errors: [`Could not read the settings file. ${e.message}`], warnings, config: null, providedParams: [], snapshots: {} };
    throw e;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { errors: ['The settings file is empty or is not a set of "key: value" sections.'], warnings, config: null, providedParams: [], snapshots: {} };
  }
  if (doc.version !== undefined && doc.version !== SETTINGS_VERSION) {
    warnings.push(`Settings file says version ${doc.version}; this app writes version ${SETTINGS_VERSION}. Reading it anyway.`);
  }

  const params = { ...DEFAULT_PARAMS };
  params.troopName = (doc.troop && typeof doc.troop === 'object' ? doc.troop.name : '') || '';

  // Which parameters the file actually SET, as opposed to which ones `params`
  // ends up carrying a value for. Every key is seeded from DEFAULT_PARAMS above
  // so the rest of this module can read a complete object, but a caller
  // applying the file to a live config must only apply what the file said.
  //
  // The difference is not academic. A settings file written before a parameter
  // existed does not mention it, and treating the seeded default as though the
  // file had asked for it silently resets the treasurer's choice every time
  // they load their own file — which is exactly how "show cents" kept turning
  // itself back on for anyone whose settings predated it.
  const provided = new Set();
  if (doc.troop && typeof doc.troop === 'object' && 'name' in doc.troop) provided.add('troopName');

  const p = doc.parameters;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'troopName') continue; // lives under troop:
      if (!(k in DEFAULT_PARAMS)) { warnings.push(`Ignoring unknown parameter "${k}".`); continue; }
      provided.add(k);
      // fiscalYearStart is a month number or nothing at all, so it fits neither
      // the numeric branch (null is legal) nor the string one (13 is not).
      // Null is a real value here — "every year" — so it cannot ride the generic
      // numeric branch, which would keep it and then String() it into "null".
      if (k === 'earliestFiscalYear') {
        if (v === null || v === '') { params[k] = null; continue; }
        const y = Number(v);
        if (!Number.isInteger(y) || y < 1900 || y > 2200) {
          errors.push(`Parameter "earliestFiscalYear" should be a four-digit year, or null, found "${v}".`);
          continue;
        }
        params[k] = y;
        continue;
      }
      if (k === 'fiscalYearStart') {
        if (v === null || v === '') { params[k] = null; continue; }
        const m = Number(v);
        if (!Number.isInteger(m) || m < 1 || m > 12) {
          errors.push(`Parameter "fiscalYearStart" should be a month number from 1 to 12, or null, found "${v}".`);
          continue;
        }
        params[k] = m;
        continue;
      }
      const def = DEFAULT_PARAMS[k];
      if (Array.isArray(def)) params[k] = Array.isArray(v) ? v.map(String) : (v == null ? [] : [String(v)]);
      else if (typeof def === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) { errors.push(`Parameter "${k}" should be a number, found "${v}".`); continue; }
        params[k] = n;
      } else if (typeof def === 'boolean') {
        if (typeof v !== 'boolean') { errors.push(`Parameter "${k}" should be true or false, found "${v}".`); continue; }
        params[k] = v;
      } else params[k] = v == null ? null : String(v);
    }
  } else if (p !== undefined && p !== null) {
    errors.push('The "parameters" section is not a set of "key: value" lines.');
  }
  for (const k of ['activitySince', 'asOf']) {
    if (params[k] && !DATE_RE.test(String(params[k]))) {
      errors.push(`Parameter "${k}" should look like YYYY-MM-DD, found "${params[k]}".`);
    }
  }

  const accountClass = {};
  if (doc.accounts && typeof doc.accounts === 'object' && !Array.isArray(doc.accounts)) {
    for (const [name, cls] of Object.entries(doc.accounts)) {
      if (!ACCOUNT_CLASSES.includes(cls)) {
        errors.push(`Account "${name}" is set to "${cls}". It must be one of: ${ACCOUNT_CLASSES.join(', ')}.`);
        continue;
      }
      accountClass[name] = cls;
    }
  } else {
    errors.push('Missing an "accounts:" section listing each troop account and its class.');
  }

  const fundCategories = {};
  if (doc.funds && typeof doc.funds === 'object' && !Array.isArray(doc.funds)) {
    const renamed = [];
    for (const [name, cat] of Object.entries(doc.funds)) {
      // A category this app used to have is moved rather than rejected: a
      // settings file is a treasurer's only copy of their chart, and refusing
      // to open it after a rename would strand them. The move is reported.
      const now = RENAMED_CATEGORIES[cat];
      if (now) { fundCategories[name] = now; renamed.push(name); continue; }
      if (!CATEGORY_NAMES.includes(cat)) {
        errors.push(`Fund "${name}" is set to category "${cat}", which is not one of: ${CATEGORY_NAMES.join(', ')}.`);
        continue;
      }
      fundCategories[name] = cat;
    }
    if (renamed.length) {
      const pairs = Object.entries(RENAMED_CATEGORIES).map(([a, b]) => `"${a}" is now "${b}"`).join('; ');
      warnings.push(`${pairs}. Moved ${renamed.length} fund(s): ${renamed.sort().join(', ')}. `
        + 'Check each one — fundraising whose proceeds go to scout accounts belongs under Scout Fundraising.');
    }
  } else {
    errors.push('Missing a "funds:" section listing each fund and its category.');
  }
  if (!errors.length && !Object.keys(fundCategories).length) {
    errors.push('The "funds:" section is empty. Refusing to load a settings file with no chart of accounts.');
  }

  const budgets = {};
  if (doc.budgets && typeof doc.budgets === 'object' && !Array.isArray(doc.budgets)) {
    for (const [year, row] of Object.entries(doc.budgets)) {
      if (!/^\d{4}$/.test(String(year))) {
        errors.push(`Budget year "${year}" should be the four-digit calendar year the fiscal year starts in.`);
        continue;
      }
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`Budget ${year} has no figures under it.`); continue;
      }
      const clean = {};
      for (const [name, v] of Object.entries(row)) {
        const n = Number(v);
        if (!Number.isFinite(n)) { errors.push(`Budget ${year}, line "${name}": "${v}" is not a number.`); continue; }
        // A name that is neither a category nor a fund in the chart is kept, not
        // dropped: a budget written before the fund's first transaction is a
        // normal thing to do, and silently discarding it is exactly the failure
        // this app exists to avoid. It is reported so it can be corrected.
        if (!CATEGORY_NAMES.includes(name) && !(name in fundCategories)) {
          warnings.push(`Budget ${year}: "${name}" is not a category or a fund in this settings file. Kept, but it will not appear on the income statement until the name matches.`);
        }
        clean[name] = n;
      }
      budgets[year] = clean;
    }
  } else if (doc.budgets !== undefined && doc.budgets !== null) {
    errors.push('The "budgets" section is not a set of years.');
  }

  const snapshots = {};
  if (doc.snapshots && typeof doc.snapshots === 'object' && !Array.isArray(doc.snapshots)) {
    for (const [date, row] of Object.entries(doc.snapshots)) {
      if (!DATE_RE.test(date)) { errors.push(`Snapshot date "${date}" should look like YYYY-MM-DD.`); continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`Snapshot "${date}" has no figures under it.`); continue; }
      const clean = {};
      for (const [key, v] of Object.entries(row)) {
        // The account lines are a nested block, and their names are the troop's
        // own — so unlike the total rows there is no list to check them against.
        // A name that no longer matches any account is kept rather than dropped,
        // because it is the record of what was published. It is not displayed:
        // the balance sheet iterates the accounts the CURRENT export has, so a
        // closed account has no row for its history to appear in. The figures
        // stay in the file for a reader who goes looking.
        if (key === 'accounts') {
          if (!v || typeof v !== 'object' || Array.isArray(v)) {
            errors.push(`Snapshot ${date}: "accounts" is not a set of "name: figure" lines.`);
            continue;
          }
          const accounts = {};
          for (const [name, av] of Object.entries(v)) {
            const n = Number(av);
            if (!Number.isFinite(n)) {
              errors.push(`Snapshot ${date}, account "${name}": "${av}" is not a number.`);
              continue;
            }
            accounts[name] = n;
          }
          clean.accounts = accounts;
          continue;
        }
        if (!BS_ROW_KEYS.includes(key)) { warnings.push(`Snapshot ${date}: ignoring unknown line "${key}".`); continue; }
        const n = Number(v);
        if (!Number.isFinite(n)) { errors.push(`Snapshot ${date}, line "${key}": "${v}" is not a number.`); continue; }
        clean[key] = n;
      }
      snapshots[date] = clean;
    }
  } else if (doc.snapshots !== undefined && doc.snapshots !== null) {
    errors.push('The "snapshots" section is not a set of dates.');
  }

  return {
    errors, warnings,
    config: errors.length ? null : { fundCategories, accountClass, params, budgets },
    // The parameter names the file actually carried. See `provided` above.
    providedParams: [...provided],
    snapshots,
  };
}
