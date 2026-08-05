// main.js — wiring.

import { parseCSV } from './csv.js';
import { loadConfig, saveConfig, clearConfig } from './config.js';
import { buildLedger, reconcile, resolveAsOf } from './ledger.js';
import { balanceSheet, eventIncome, monthlyIncome } from './reports.js';
import {
  loadSnapshots, saveSnapshots, clearSnapshots, snapshotFromReport,
  driftReport, isoDate, fmtMoney, download,
} from './snapshots.js';
import { settingsToText, settingsFromText, SETTINGS_FORMATS } from './settings.js';
import {
  renderBalanceSheet, renderEventIncome, renderMonthlyIncome,
  renderReconciliation, renderErrors, renderConfig,
} from './render.js';
import { initInstall, purgeAppCache } from './install.js';

const $ = sel => document.querySelector(sel);

const state = {
  cfg: loadConfig(),
  snapshots: loadSnapshots(),
  ledger: null,
  asOf: null,
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
  const ledger = buildLedger(records, state.cfg);
  renderErrors(ledger.errors, $('#errors'));
  $('#import-done').hidden = true;
  if (ledger.errors.length) {
    // Errors are rendered on the Import tab, next to the file that caused them.
    state.ledger = null;
    setReportsShown(false);
    return;
  }
  state.ledger = ledger;
  state.asOf = resolveAsOf(ledger, state.cfg.params);
  $('#asOf').value = isoDate(state.asOf);
  setReportsShown(true);
  $('#import-done').textContent =
    `Loaded ${records.length} transactions. The reports are on the Reports tab.`;
  $('#import-done').hidden = false;
  showTab('reports');
  renderReconciliation(reconcile(ledger, state.cfg), ledger, $('#reconciliation'));
  rerender();
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
  renderConfig(cfg, $('#config'), () => { saveConfig(cfg); reloadFromLedger(); });
}

function reloadFromLedger() {
  // Config changes alter classification, so the ledger must be rebuilt. The
  // source records are not retained, so ask for the file again.
  $('#config-note').textContent =
    'Configuration saved. Re-drop the export to apply it — transaction data is never kept in memory between loads.';
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
    btn.addEventListener('click', () => {
      document.body.dataset.printTarget = btn.dataset.print;
      window.print();
    });
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

  // settings file — one document carrying config and snapshots together.
  // Identical YAML under either extension; only the filename differs.
  const exportSettings = fmt => () => {
    const { filename, mime } = SETTINGS_FORMATS[fmt];
    download(filename, settingsToText(state.cfg, state.snapshots), mime);
  };
  $('#settings-export').addEventListener('click', exportSettings('yaml'));
  $('#settings-export-txt').addEventListener('click', exportSettings('txt'));
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

  initInstall({ button: $('#install'), status: $('#install-status') });
}

document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bind();
  renderConfig(state.cfg, $('#config'), () => { saveConfig(state.cfg); reloadFromLedger(); });
});
