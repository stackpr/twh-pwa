// main.js — wiring.

import { parseCSV } from './csv.js';
import { loadConfig, saveConfig, clearConfig } from './config.js';
import { buildLedger, reconcile, resolveAsOf } from './ledger.js';
import { balanceSheet, eventIncome, monthlyIncome } from './reports.js';
import {
  loadSnapshots, saveSnapshots, clearSnapshots, snapshotFromReport,
  driftReport, isoDate, fmtMoney, download,
} from './snapshots.js';
import { settingsToText, settingsFromText, SETTINGS_FILENAME } from './settings.js';
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

function loadRecords(records) {
  const ledger = buildLedger(records, state.cfg);
  renderErrors(ledger.errors, $('#errors'));
  if (ledger.errors.length) {
    state.ledger = null;
    $('#reports').hidden = true;
    return;
  }
  state.ledger = ledger;
  state.asOf = resolveAsOf(ledger, state.cfg.params);
  $('#asOf').value = isoDate(state.asOf);
  $('#reports').hidden = false;
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
    location.reload();
  });
  $('#snap-clear').addEventListener('click', () => {
    if (!confirm('Delete all stored snapshots from this browser? Export the settings file first if you want to keep them.')) return;
    state.snapshots = {}; clearSnapshots(); rerender();
  });

  // config
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

  initInstall({ button: $('#install'), status: $('#install-status') });
}

document.addEventListener('DOMContentLoaded', () => {
  bind();
  renderConfig(state.cfg, $('#config'), () => { saveConfig(state.cfg); reloadFromLedger(); });
});
