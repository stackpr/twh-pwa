// main.js — wiring.

import { parseCSV } from './csv.js';
import { loadConfig, saveConfig, clearConfig } from './config.js';
import { buildLedger, reconcile, resolveAsOf, chartReview, classifyEvents } from './ledger.js';
import { balanceSheet, eventIncome, monthlyIncome } from './reports.js';
import {
  loadSnapshots, saveSnapshots, clearSnapshots, snapshotFromReport,
  driftReport, isoDate, fmtMoney, download,
} from './snapshots.js';
import { settingsToText, settingsFromText, SETTINGS_FILENAME } from './settings.js';
import {
  renderBalanceSheet, renderEventIncome, renderMonthlyIncome,
  renderReconciliation, renderErrors, renderConfig, renderChartReview,
} from './render.js';
import { initInstall, purgeAppCache } from './install.js';

const $ = sel => document.querySelector(sel);

const state = {
  cfg: loadConfig(),
  snapshots: loadSnapshots(),
  ledger: null,
  asOf: null,
  review: null,   // what the last import added to, or found stale in, the chart
};

/* ---- file intake ------------------------------------------------- */

async function handleFile(file) {
  $('#filename').textContent = file.name;
  const text = await file.text();
  const { records } = parseCSV(text);
  loadRecords(records);
}

/** Reports exist only while an export is loaded; otherwise point at the Import tab. */
function setReportsShown(on) {
  $('#reports').hidden = !on;
  $('#reports-empty').hidden = on;
}

function loadRecords(records) {
  let ledger = buildLedger(records, state.cfg);
  $('#import-done').hidden = true;

  // A name the chart of accounts has never seen is added with a guess rather
  // than turned away — see adoptNewNames. The rebuild is what makes the guess
  // take effect; it happens here, while the export is still in this function's
  // stack frame, because it is never retained beyond it.
  state.review = chartReview(ledger, state.cfg);
  if (adoptNewNames(state.review)) {
    saveConfig(state.cfg);
    ledger = buildLedger(records, state.cfg);
  }

  renderErrors(ledger.errors, $('#errors'));
  if (ledger.errors.length) {
    // Errors are rendered on the Import tab, next to the file that caused them.
    // The review is dropped rather than shown: a halted load produces no legs —
    // a missing column halts before the first row is read — and against no legs
    // every name in the chart of accounts looks unused. Offering to delete the
    // whole chart because the export was malformed is not a tidy-up.
    state.ledger = null;
    state.review = null;
    setReportsShown(false);
    renderReview();
    return;
  }
  state.ledger = ledger;
  state.asOf = resolveAsOf(ledger, state.cfg.params);
  $('#asOf').value = isoDate(state.asOf);
  setReportsShown(true);
  $('#import-done').textContent =
    `Loaded ${records.length} transactions. The reports are on the Reports tab.`;
  $('#import-done').hidden = false;
  renderReconciliation(reconcile(ledger, state.cfg), ledger, $('#reconciliation'));
  rerender();
  renderReview();
  // A review is the one thing worth reading before the figures. With nothing to
  // review the reports are what was asked for, so go straight there.
  if (!hasReview()) showTab('reports');
}

/* ---- printing ----------------------------------------------------- */

// Which way up each report wants the paper. The two statements carry a column
// per event or per month and are unreadable squeezed into portrait; the balance
// sheet is one narrow column of figures and would waste half a landscape sheet.
const ORIENTATION = { balance: 'portrait', event: 'landscape', monthly: 'landscape' };

/**
 * Set the paper for the next print job.
 *
 * @page takes no selector, so orientation cannot be expressed as a rule keyed to
 * the report being printed — it has to be written just before printing. Letter
 * is named explicitly because Chrome otherwise keeps whatever paper the print
 * dialog last used, and the margins are asymmetric to match the orientation.
 */
function setPageSize(orientation) {
  $('#page-style').textContent = `@page { size: Letter ${orientation}; margin: `
    + (orientation === 'landscape' ? '10mm 12mm' : '12mm 10mm') + '; }';
}

function printReport(target) {
  document.body.dataset.printTarget = target;
  setPageSize(ORIENTATION[target] || 'portrait');
  window.print();
}

/* ---- chart of accounts review ------------------------------------ */

const hasReview = () => {
  const r = state.review;
  return !!r && (r.newFunds.length + r.newAccounts.length
    + r.unusedFunds.length + r.unusedAccounts.length > 0);
};

/**
 * Take the guesses into the settings, so the load can proceed.
 *
 * This is the one place the app assigns a classification nobody chose, and it is
 * deliberately not silent: every guessed name is listed on the Import tab, and
 * the reports carry a warning naming the count until the treasurer has been
 * through them. The alternative — halting on a fund TroopWebHost added last
 * week — sent a volunteer to hand-edit a settings file to see any figure at all.
 */
function adoptNewNames(review) {
  for (const f of review.newFunds) state.cfg.fundCategories[f.name] = f.guess;
  for (const a of review.newAccounts) state.cfg.accountClass[a.name] = a.guess;
  return review.newFunds.length + review.newAccounts.length > 0;
}

function renderReview() {
  const section = $('#import-review-section');
  section.hidden = !hasReview();
  renderChartReview(state.review || { newFunds: [], newAccounts: [], unusedFunds: [], unusedAccounts: [] },
    $('#import-review'), {
      // The review row holds the classification currently in force, seeded from
      // the guess; correcting one edits the settings and the row together, so a
      // later re-render shows what the treasurer chose rather than the guess.
      onFundChange: (name, cat) => {
        state.cfg.fundCategories[name] = cat;
        state.review.newFunds.find(f => f.name === name).guess = cat;
        afterChartEdit();
      },
      onAccountChange: (name, cls) => {
        state.cfg.accountClass[name] = cls;
        state.review.newAccounts.find(a => a.name === name).guess = cls;
        afterChartEdit();
      },
      onRemoveUnused: () => {
        const { unusedFunds, unusedAccounts } = state.review;
        const n = unusedFunds.length + unusedAccounts.length;
        if (!confirm(`Remove ${n} unused name${n === 1 ? '' : 's'} from the settings?\n\n`
          + `${n === 1 ? 'It has' : 'They have'} no activity in this export, so no figure `
          + 'changes. Download the settings file first if you want to keep them.')) return;
        for (const name of unusedFunds) delete state.cfg.fundCategories[name];
        for (const name of unusedAccounts) delete state.cfg.accountClass[name];
        state.review = { ...state.review, unusedFunds: [], unusedAccounts: [] };
        afterChartEdit();
        renderReview();   // the removed names leave the panel
      },
      onDone: () => showTab('reports'),
    });
  renderGuessNote();
}

/** Guessed classifications follow the reports until someone has looked at them. */
function renderGuessNote() {
  const note = $('#guess-note');
  const n = state.review ? state.review.newFunds.length + state.review.newAccounts.length : 0;
  note.replaceChildren();
  note.hidden = !n;
  if (!n) return;
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'linkish';
  link.textContent = 'Import tab';
  link.addEventListener('click', () => showTab('import'));
  note.append(
    `${n} name${n === 1 ? '' : 's'} in this export ${n === 1 ? 'was' : 'were'} classified by guess `
    + `when it loaded. Check ${n === 1 ? 'it' : 'them'} on the `,
    link,
    ' before publishing these figures.');
}

/**
 * A chart-of-accounts change needs no re-read of the export: the only part of
 * the ledger that depends on the chart is each event's program/fundraising kind,
 * and that is recomputed from the legs already in memory.
 */
function afterChartEdit() {
  saveConfig(state.cfg);
  if (state.ledger) {
    classifyEvents(state.ledger, state.cfg);
    renderReconciliation(reconcile(state.ledger, state.cfg), state.ledger, $('#reconciliation'));
  }
  rerender();
  renderGuessNote();
}

function rerender() {
  if (!state.ledger) return;
  const { cfg } = state;
  state.asOf = resolveAsOf(state.ledger, cfg.params);

  const org = cfg.params.troopName || '';
  const bs = balanceSheet(state.ledger, cfg, state.asOf);
  renderBalanceSheet(bs, state.snapshots, $('#report-balance'), org);
  renderEventIncome(eventIncome(state.ledger, cfg, state.asOf), $('#report-event'), org);
  renderMonthlyIncome(monthlyIncome(state.ledger, cfg, state.asOf), $('#report-monthly'), org);

  renderDrift(bs);
  renderConfig(cfg, $('#config'), onConfigEdit);
}

function onConfigEdit() {
  afterChartEdit();
  $('#config-note').textContent = state.ledger
    ? 'Configuration saved, and the reports have been recomputed.'
    : 'Configuration saved. It applies to the next export you import.';
}

function reloadFromLedger() {
  // Some parameters — legacy mode, the hash salt — change how the ledger itself
  // is built, and the export is not retained, so those need the file again.
  // A chart-of-accounts change does not: see afterChartEdit.
  $('#config-note').textContent =
    'Saved. Re-drop the export to apply it — transaction data is never kept in memory between loads.';
}

function renderDrift(bs) {
  const mount = $('#drift');
  mount.replaceChildren();
  const key = isoDate(state.asOf);
  const snap = state.snapshots[key];
  if (!snap) { mount.hidden = true; return; }
  const drift = driftReport(snap, snapshotFromReport(bs));
  mount.hidden = false;
  if (!drift.length) {
    mount.textContent = `Snapshot for ${key} matches the recomputed figures.`;
    mount.className = 'ok';
    return;
  }
  mount.className = 'warn';
  const ul = document.createElement('ul');
  for (const d of drift) {
    const li = document.createElement('li');
    li.textContent = `${d.key}: published ${fmtMoney(d.was)}, now ${fmtMoney(d.now)} (${fmtMoney(d.delta)})`;
    ul.append(li);
  }
  mount.append(Object.assign(document.createElement('p'), {
    textContent: `Recomputed figures differ from the snapshot published for ${key}. A back-dated correction landed after publication:`,
  }), ul);
}

/* ---- tabs -------------------------------------------------------- */

// A tab shows one panel and hides the others. That is the whole mechanism: no
// hash, no history entry, no address-bar change. Fragment state leaks through
// history and referrers, which is why this app has none — and a treasurer who
// bookmarks the page should land where they started, not in whatever section
// happened to be open. The choice is remembered for the browser tab's lifetime
// only, in sessionStorage, and holds nothing but a panel name.
const TAB_KEY = 'troopfin.tab';
const tabButtons = () => [...document.querySelectorAll('[role="tab"]')];

function showTab(name) {
  const tabs = tabButtons();
  const target = tabs.find(t => t.dataset.tab === name) || tabs[0];
  if (!target) return;
  for (const t of tabs) {
    const on = t === target;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
  try { sessionStorage.setItem(TAB_KEY, target.dataset.tab); } catch { /* private mode */ }
}

function bindTabs() {
  const tabs = tabButtons();
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
    tab.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
      if (step === undefined) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      showTab(next.dataset.tab);
      next.focus();
    });
  });
  // Cross-references elsewhere in the page ("see the Cache tab") are buttons, not
  // links, so that following one still leaves the address bar alone.
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.goto);
      $(`#tab-${btn.dataset.goto}`)?.focus();
    });
  });

  let saved = null;
  try { saved = sessionStorage.getItem(TAB_KEY); } catch { /* private mode */ }
  // Import first: with no export loaded there is nothing else to do, and the
  // export is not retained between visits.
  showTab(saved || 'import');
}

/* ---- controls ---------------------------------------------------- */

function bind() {
  const drop = $('#drop');
  const input = $('#file');

  input.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

  const p = state.cfg.params;
  const bindParam = (sel, key, cast = Number) => {
    const node = $(sel);
    if (!node) return;
    node.value = p[key];
    node.addEventListener('change', () => {
      p[key] = node.type === 'checkbox' ? node.checked : cast(node.value);
      saveConfig(state.cfg);
      rerender();
    });
  };
  bindParam('#troopName', 'troopName', String);
  bindParam('#activitySince', 'activitySince', String);
  bindParam('#pastEvents', 'pastEventsShown');
  bindParam('#months', 'monthsShown');
  bindParam('#asOf', 'asOf', String);

  const legacy = $('#legacyMode');
  legacy.checked = p.legacyMode;
  legacy.addEventListener('change', () => {
    p.legacyMode = legacy.checked;
    saveConfig(state.cfg);
    $('#legacy-note').hidden = !legacy.checked;
    reloadFromLedger();
    rerender();
  });
  $('#legacy-note').hidden = !p.legacyMode;

  // printing
  document.querySelectorAll('[data-print]').forEach(btn => {
    btn.addEventListener('click', () => printReport(btn.dataset.print));
  });
  // Ctrl+P is as valid as the buttons, and can be pressed on any tab. The
  // stylesheet already reduces the page to the reports; this gives that job a
  // paper size too, since no button chose one.
  window.addEventListener('beforeprint', () => {
    if (!document.body.dataset.printTarget) setPageSize('landscape');
  });
  window.addEventListener('afterprint', () => { delete document.body.dataset.printTarget; });

  // snapshot capture
  $('#snap-capture').addEventListener('click', () => {
    if (!state.ledger) return;
    const bs = balanceSheet(state.ledger, state.cfg, state.asOf);
    state.snapshots[isoDate(state.asOf)] = snapshotFromReport(bs);
    saveSnapshots(state.snapshots);
    rerender();
  });

  // settings file — one document carrying config and snapshots together
  $('#settings-export').addEventListener('click', () => {
    download(SETTINGS_FILENAME, settingsToText(state.cfg, state.snapshots), 'text/plain');
  });
  $('#settings-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    const { config, snapshots, errors, warnings } = settingsFromText(await f.text());
    if (errors.length) {
      alert('Settings not loaded:\n\n' + errors.slice(0, 12).join('\n')
        + (errors.length > 12 ? `\n\n(+${errors.length - 12} more)` : ''));
      return;
    }
    state.cfg = config;
    state.snapshots = snapshots;
    saveConfig(state.cfg);
    saveSnapshots(state.snapshots);
    const counts = `${Object.keys(config.fundCategories).length} funds, `
      + `${Object.keys(config.accountClass).length} accounts, `
      + `${Object.keys(snapshots).length} snapshot(s)`;
    alert(`Settings loaded: ${counts}.`
      + (warnings.length ? `\n\nNotes:\n${warnings.slice(0, 8).join('\n')}` : '')
      + '\n\nDrop the transaction export to produce the reports.');
    showTab('import'); // the export is dropped there, and the reload lands on it
    location.reload();
  });
  // cache — every destructive action lives on one tab, so a treasurer on a
  // shared computer has a single place to go before walking away.
  $('#snap-clear').addEventListener('click', () => {
    if (!confirm('Delete all stored snapshots from this browser? Download the settings file first if you want to keep them.')) return;
    state.snapshots = {}; clearSnapshots(); rerender();
  });
  $('#cfg-reset').addEventListener('click', async () => {
    if (!confirm('Clear cached settings (chart of accounts, parameters)? Snapshots are kept.')) return;
    clearConfig();
    state.cfg = loadConfig();
    reloadFromLedger();
    location.reload();
  });
  $('#app-reset').addEventListener('click', async () => {
    if (!confirm('Purge the offline app cache and unregister the service worker? Settings and snapshots are kept.')) return;
    await purgeAppCache();
    location.reload();
  });
  $('#clear-all').addEventListener('click', async () => {
    if (!confirm(
      'Clear everything this app has stored in this browser?\n\n'
      + '  • troop name and report parameters\n'
      + '  • the chart of accounts\n'
      + '  • all balance-sheet snapshots\n'
      + '  • the offline copy of the app\n\n'
      + 'None of it is held anywhere else, so it cannot be recovered. Download the '
      + 'settings file first if you want to keep the chart of accounts and snapshots.')) return;
    clearSnapshots();
    clearConfig();
    try { sessionStorage.removeItem(TAB_KEY); } catch { /* private mode */ }
    await purgeAppCache();
    location.reload();
  });

  initInstall({ button: $('#install'), status: $('#install-status'), version: $('#app-version') });
}

document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bind();
  renderConfig(state.cfg, $('#config'), onConfigEdit);
});
