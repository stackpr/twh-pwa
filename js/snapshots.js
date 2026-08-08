// snapshots.js — freeze and re-present published balance sheet figures.
//
// Snapshots live in the settings file (js/settings.js) alongside the chart of
// accounts, so one document carries everything a successor needs. This module
// owns their shape, the drift comparison, and number formatting.

const LS_KEY = 'troopfin.snapshots.v1';

export const BS_ROW_KEYS = [
  'total_assets', 'total_noncash_assets',
  'scout_prepaid', 'scout_arrears_count', 'scout_arrears_total', 'scout_net',
  'liability_accounts', 'other_future_events', 'pseudo_accounts', 'total_liabilities',
  'unrestricted_net_assets', 'twh_comparison',
];

/**
 * The account lines of a snapshot, kept in a sub-map rather than beside the
 * totals above.
 *
 * The total rows are a fixed vocabulary and can be a list; account names are a
 * troop's own, and they arrive, close and get renamed over the years, so they
 * cannot be. Keeping them apart is also what makes the privacy boundary
 * checkable at a glance: the three sources below are troop bank accounts, the
 * troop's card, and troop-held funds — the `_` prefixed pseudo-accounts, which
 * are not people. Scout balances stay aggregated in scout_prepaid and
 * scout_arrears_total and are never itemised here. Do not widen this to
 * bs.scouts; a per-child balance in a file meant to be emailed to a successor
 * is the exact thing Rule 2 exists to prevent.
 *
 * Liability accounts are stored as displayed — already sign-inverted — so the
 * historical column reads the same way the Current one does.
 */
const accountLines = bs => Object.fromEntries([
  ...bs.assets,             // cash and non-cash together, as the section prints them
  ...bs.liabilityAccounts,  // sign already flipped for display
  ...bs.pseudo,             // troop-held funds
]);

export function snapshotFromReport(bs) {
  return {
    total_assets:            bs.totalAssets,
    total_noncash_assets:    bs.totalNoncash,
    scout_prepaid:           bs.prepaid,
    scout_arrears_count:     bs.arrearsCount,
    scout_arrears_total:     bs.arrearsTotal,
    scout_net:               bs.netScout,
    liability_accounts:      bs.liabilityAccounts.reduce((s, [, v]) => s + v, 0),
    other_future_events:     bs.otherFutureEventsNet,
    pseudo_accounts:         bs.pseudo.reduce((s, [, v]) => s + v, 0),
    total_liabilities:       bs.totalLiabilities,
    unrestricted_net_assets: bs.unrestricted,
    twh_comparison:          bs.twhComparison,
    accounts:                accountLines(bs),   // last, as the settings file writes it
  };
}

export function loadSnapshots() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
export function saveSnapshots(snaps) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(snaps)); } catch { /* private mode */ }
}
export function clearSnapshots() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

/**
 * Compare a snapshot against what the current ledger produces for the same
 * date. A non-empty result means a back-dated correction landed after the
 * figure was published.
 */
export function driftReport(snapshot, recomputed, tolerance = 0.005) {
  const drift = [];
  for (const key of BS_ROW_KEYS) {
    const was = snapshot[key], now = recomputed[key];
    if (was === undefined || now === undefined) continue;
    if (Math.abs(was - now) > tolerance) drift.push({ key, was, now, delta: now - was });
  }
  // Account lines drift too, and they are the ones that say WHERE a total moved
  // — a subtotal that is off by the same amount as one account has answered its
  // own question. A name present on one side only is skipped rather than
  // reported as a swing from nothing: an account opened since, or a snapshot
  // taken before the lines were captured, is not a back-dated correction.
  const wasAcc = snapshot.accounts || {}, nowAcc = recomputed.accounts || {};
  for (const name of Object.keys({ ...wasAcc, ...nowAcc }).sort()) {
    const was = wasAcc[name], now = nowAcc[name];
    if (was === undefined || now === undefined) continue;
    if (Math.abs(was - now) > tolerance) drift.push({ key: name, was, now, delta: now - was });
  }
  return drift;
}

/* ---- formatting ---- */

export function fmtMoney(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (Math.abs(v) < 0.005) return '–';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

export function fmtInt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return Math.round(v).toLocaleString('en-US');
}

export function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function download(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
