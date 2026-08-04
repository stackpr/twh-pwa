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
