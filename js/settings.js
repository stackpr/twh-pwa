// settings.js — the settings file.
//
// One human-editable document holding everything except the transactions: the
// troop name, report parameters, the chart of accounts, and the balance-sheet
// snapshots. This file plus a fresh TroopWebHost export is enough to get a new
// treasurer running from nothing.
//
// It is YAML. The app offers it under two extensions holding byte-identical
// content: .yaml, which says what the file is and gets syntax highlighting in
// anything that knows the format, and .txt, which on Windows reliably opens in
// Notepad where a .yaml may open in whatever happens to be registered, or in
// nothing. The people inheriting this file are volunteers, not developers, so
// both routes stay open. Loading accepts either, and the extension is never
// read — the content decides.
//
// It contains NO personal data — no scout names, no per-account balances, no
// transactions. Only configuration and whole-troop totals. It is safe to email
// to a successor; a transaction export never is.

import { parseYAML, stringifyYAML, YamlError, raw } from './yaml.js';
import { CATEGORY_NAMES, DEFAULT_PARAMS } from './config.js';
import { BS_ROW_KEYS } from './snapshots.js';

export const SETTINGS_VERSION = 1;
export const SETTINGS_BASENAME = 'troop-settings';

/** Extension -> { filename, mime }. `yaml` is the default offered. */
export const SETTINGS_FORMATS = {
  yaml: { filename: `${SETTINGS_BASENAME}.yaml`, mime: 'application/yaml' },
  txt:  { filename: `${SETTINGS_BASENAME}.txt`,  mime: 'text/plain' },
};
export const SETTINGS_FILENAME = SETTINGS_FORMATS.yaml.filename;

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
export function settingsToText(cfg, snapshots = {}) {
  const params = { ...DEFAULT_PARAMS, ...cfg.params };
  const lines = [
    '# ---------------------------------------------------------------------',
    '# Troop Finance Reports — settings',
    '#',
    '# This is a YAML file. It may be named .yaml or .txt — the app reads',
    '# either, and the contents are the same. Edit it in any plain text editor',
    '# (Notepad, TextEdit, Notepad++). Keep the two-space indentation. Do not',
    '# use tabs. Lines starting with # are comments and are ignored.',
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
    '  monthsShown             months in the monthly income statement.',
    '  asOf                    report date (YYYY-MM-DD), or null for today.',
    '  legacyMode              reproduce spreadsheet-era defects, for comparing',
    '                          against an old workbook during a migration.',
    '  legacyDeductedAccounts  under legacyMode only: the troop-held accounts an',
    '                          old spreadsheet deducted by hand.',
    '  hashSalt                changes the anonymised scout identifiers. Leave',
    '                          empty unless you have a reason.',
  ], 'parameters', {
    activitySince: params.activitySince,
    pastEventsShown: params.pastEventsShown,
    monthsShown: params.monthsShown,
    asOf: params.asOf ?? null,
    legacyMode: params.legacyMode,
    legacyDeductedAccounts: params.legacyDeductedAccounts || [],
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
    'Allowed categories (these six names are fixed):',
    ...CATEGORY_NAMES.map(c => `  ${c}`),
    '',
    'This also decides which events get a column on the event income statement.',
    'An event whose activity is mostly Program-category is a program event; one',
    'that is mostly Fundraising-category is not, and rolls into Other.',
    '',
    'Every fund appearing in the export must be listed here, or the reports will',
    'refuse to run.',
  ], 'funds', sortedMap(cfg.fundCategories)));

  lines.push(...block([
    'Balance sheet figures as published, frozen by date. These are not',
    'recalculated — they are the record of what was actually reported, so a',
    'back-dated correction shows up as drift instead of quietly rewriting',
    'history. Only the balance sheet is snapshotted; the income statements are',
    'period reports and are always recomputed.',
    '',
    'Added by the app when you capture a snapshot. Safe to edit or delete a',
    'whole date, but there is rarely a reason to.',
  ], 'snapshots', roundSnapshots(snapshots)));

  return lines.join('\r\n').replace(/(\r\n)+$/, '\r\n');
}

const sortedMap = obj => Object.fromEntries(Object.keys(obj || {}).sort().map(k => [k, obj[k]]));

function roundSnapshots(snaps) {
  const out = {};
  for (const date of Object.keys(snaps || {}).sort()) {
    const row = {};
    for (const key of BS_ROW_KEYS) {
      const v = snaps[date][key];
      if (v === undefined) continue;
      row[key] = key.endsWith('_count') ? Math.round(v) : raw(v.toFixed(2));
    }
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
    if (e instanceof YamlError) return { errors: [`Could not read the settings file. ${e.message}`], warnings, config: null, snapshots: {} };
    throw e;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { errors: ['The settings file is empty or is not a set of "key: value" sections.'], warnings, config: null, snapshots: {} };
  }
  if (doc.version !== undefined && doc.version !== SETTINGS_VERSION) {
    warnings.push(`Settings file says version ${doc.version}; this app writes version ${SETTINGS_VERSION}. Reading it anyway.`);
  }

  const params = { ...DEFAULT_PARAMS };
  params.troopName = (doc.troop && typeof doc.troop === 'object' ? doc.troop.name : '') || '';

  const p = doc.parameters;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'troopName') continue; // lives under troop:
      if (!(k in DEFAULT_PARAMS)) { warnings.push(`Ignoring unknown parameter "${k}".`); continue; }
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
    for (const [name, cat] of Object.entries(doc.funds)) {
      if (!CATEGORY_NAMES.includes(cat)) {
        errors.push(`Fund "${name}" is set to category "${cat}", which is not one of: ${CATEGORY_NAMES.join(', ')}.`);
        continue;
      }
      fundCategories[name] = cat;
    }
  } else {
    errors.push('Missing a "funds:" section listing each fund and its category.');
  }
  if (!errors.length && !Object.keys(fundCategories).length) {
    errors.push('The "funds:" section is empty. Refusing to load a settings file with no chart of accounts.');
  }

  const snapshots = {};
  if (doc.snapshots && typeof doc.snapshots === 'object' && !Array.isArray(doc.snapshots)) {
    for (const [date, row] of Object.entries(doc.snapshots)) {
      if (!DATE_RE.test(date)) { errors.push(`Snapshot date "${date}" should look like YYYY-MM-DD.`); continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`Snapshot "${date}" has no figures under it.`); continue; }
      const clean = {};
      for (const [key, v] of Object.entries(row)) {
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
    config: errors.length ? null : { fundCategories, accountClass, params },
    snapshots,
  };
}
