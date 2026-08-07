# CLAUDE.md

Working notes for Claude Code sessions in this repo. Read `README.md` for the
domain conventions. Two rules come before everything else in this file.

---

## Rule 1 — Everything here is troop-agnostic

The app, the code, the fixtures, and all documentation must work for any troop
using TroopWebHost. No troop name, unit number, council, account nickname, user
ID, or other identifier belongs anywhere in this repository.

That includes places it is easy to let one slip:

- Report titles and page headings. The troop name is a runtime parameter
  (`params.troopName`), blank by default, entered by the user and stored only in
  their browser. Never hardcode one.
- `localStorage` keys, cache names, and downloaded filenames.
- The chart of accounts. `js/config.js` ships an **example** fund map and account
  classification, and every name in it is invented and generic on purpose
  (`Product Sale Revenue`, `Merchandise Inventory`, `Credit Card`) rather than
  copied from a real unit's TroopWebHost setup. It is a default, not a schema. A
  troop adopts their own through Settings → Load settings file, with no code
  change. Never write a report that assumes a specific fund, account, or
  pseudo-account name exists — derive from what the export contains, or halt with
  a named error.
- Event, fundraiser and vendor names, in fixtures and in prose alike. A named
  venue, sponsor or annual fundraiser identifies a unit as surely as its number
  does. The fixture's events are invented; keep them that way.
- Comments and documentation. Do not illustrate a point with a real balance, a
  real event, or a real cell reference from someone's spreadsheet. Those are that
  troop's financial records. Describe the shape of the problem instead.
- Test fixtures. See Rule 2.

The six category names in `CATEGORY_ORDER` are the one fixed vocabulary, because
they drive the income-statement sections and the program/fundraising split.
Everything else is configuration.

## Rule 2 — No personal data in the repo, and none on the wire

**Never commit real data.** TroopWebHost exports carry scout names, family
payment histories, and per-child arrears — financial records about minors.
`.gitignore` excludes every `.csv`, `.CSV`, `.xlsx` and `.xls` with one explicit
exception: `test/fixtures/sample-export.csv`, which is entirely synthetic.

- If a user pastes real transaction data into a session, do not write it to a
  file, do not echo it back at length, and do not include it in a commit. Work in
  memory, or have them run `node test/reconcile.test.mjs <path>` locally, which
  executes invariants without touching golden values.
- Need test data? Regenerate the fixture:
  `node test/fixtures/generate.mjs > test/fixtures/sample-export.csv`. It is
  seeded, so output is byte-for-byte reproducible. It invents scouts, events,
  amounts and dates. If you change the generator you must regenerate the fixture
  **and** re-derive the golden values in `test/reconcile.test.mjs`; never one
  without the other.
- Do not create a file whose name contains a person's name.
- The settings file is the one artefact meant to be shared. It must stay free of
  scout names, per-account balances, and transactions — configuration and
  whole-troop totals only. There is a test asserting this; do not weaken it.

**Never transmit anything.** This app makes zero network requests at runtime, and
that is load-bearing rather than incidental — a third-party script sharing an
origin with a parsed export is the exact failure this design exists to prevent.

- No CDN, no web fonts, no analytics, no telemetry, no error reporting service,
  no npm runtime dependency. If a task seems to need a library, vendor it and say
  so, or push back.
- The CSV is read through the File API and never becomes a `Request`. Do not add
  a fetch, upload, URL parameter, form post, or cache write that carries ledger
  content.
- `localStorage` holds configuration and balance-sheet snapshot totals only.
  Never transactions, never names.
- Scout names are hashed in `buildLedger()` and the originals discarded there.
  Never widen that scope. Never render a raw name. Accounts with a leading `_`
  are troop-held funds, not people, and are intentionally left unhashed.
- No URL-fragment state and no share links. Both leak through history and
  referrers.

If a requested change would weaken either rule, say so and propose an
alternative rather than implementing it quietly.

---

## Other invariants

3. **No fund or account is ever classified silently.** `ledger.js` still refuses
   to build a report from a name it cannot classify: unknown names go to
   `errors`, and nothing renders. What changed is what happens *before* that
   halt. `main.js` adopts each unknown name into the chart of accounts with a
   guess from `guessFundCategory` / `guessAccountClass`, saves it, and rebuilds —
   so a fund TroopWebHost added last week costs a glance, not a hand-edited
   settings file. The guess is then impossible to miss: every guessed name is
   listed with its evidence on the Import tab, and a warning naming the count
   rides above the reports.

   The invariant is the *silence*, not the halt. An unknown name may be guessed;
   it may never be dropped, defaulted without saying so, or counted as zero. If
   you add a path that classifies, it must also surface what it classified, and
   the halt in `ledger.js` must stay as the backstop for any path that does not.
   Skipping an unclassified account is still the specific failure that makes
   spreadsheet-era tooling untrustworthy.
4. **One sign convention.** Credit positive, debit negative, on every leg, set in
   `ledger.js`. The only place the sign flips for display is `sectionSign()` in
   `reports.js`. Do not introduce a second convention.
5. **Print is an allow-list.** `@media print` in `app.css` names each printable
   report explicitly. A new section stays hidden until named. Do not invert this.
   The same block reduces the page to the reports whatever tab is open, because
   Ctrl+P is as valid as the buttons: every panel is suppressed and
   `#panel-reports` forced back on even while `hidden`. Paper size lives in
   `#page-style`, written by `main.js` at print time — `@page` takes no selector,
   so the balance sheet's portrait and the statements' landscape cannot be
   expressed as rules. Do not move a version of it back into `app.css`.
6. **Tabs never touch the URL.** The tab strip in `index.html` — Import,
   Reports, Settings, Cache, Help — shows one panel and hides the others, and
   that is all it does: no hash, no `history.pushState`, no query string, no
   router. Rule 2 forbids fragment state, and the same reasoning covers a tab
   name. The active tab is remembered in `sessionStorage` (`troopfin.tab`),
   which holds a panel name and nothing else. Cross-references between panels
   are `[data-goto]` buttons rather than anchors, for the same reason.
7. **One file input, on the Import tab.** The export is dropped in exactly one
   place. A second drop target on another panel invites the question of which
   file the figures came from, which is the question this app exists to remove.
   Reports render only while an export is loaded; with none, the Reports panel
   points back at Import instead of offering a duplicate form.
8. **The settings file is `.txt`, and the interface never says "YAML".** One
   extension, chosen because `.txt` opens in Notepad on any Windows machine. The
   format is an implementation detail of `yaml.js`; the treasurer edits a
   settings file in a text editor. Do not add a second extension, a format
   picker, or the word YAML to the UI copy or the Help tab.
9. **Destructive actions live on the Cache tab.** Clearing configuration,
   snapshots or the offline shell is irreversible and the settings file is the
   only backup, so those buttons stay together with the explanation of what is
   held in the browser. Do not scatter them back across the other panels.

## Architecture

```
CSV → parseCSV() → buildLedger() → { legs, txns, events } → reports → render
                        ↑ hashing happens here
```

`legs` is the single canonical structure:
`{ i, date, kind, key, amount, event, txnType }`, where `kind` is
`asset` | `person` | `fund`. Every displayed figure is a filtered sum over
`legs`. Computing a number some other way is a sign the change belongs in
`reports.js` as another filter.

Module boundaries, in dependency order — keep it acyclic:

- `csv.js` — parser and MD5. No app knowledge.
- `config.js` — chart of accounts, parameters, localStorage persistence, and the
  name heuristics behind an import-time guess. A saved chart is authoritative:
  `loadConfig` does not merge the shipped example back in, or a removal would
  undo itself on the next visit.
- `yaml.js` — a small strict YAML subset. No app knowledge. Do not grow it into a
  general YAML implementation; if a feature is missing, ask whether the settings
  file really needs it.
- `settings.js` — the settings file: config plus snapshots in one document.
  Section comments are hand-written instructions for a human editor; keep them
  current when you add a parameter.
- `ledger.js` — imports `csv.js` and `config.js`. Ingest, hashing, validation,
  and the import-time comparison of the chart of accounts against the export
  (`chartReview`). `classifyEvents` is split out of `buildLedger` because each
  event's program/fundraising kind is the only part of the ledger that depends
  on the chart — which is what lets a classification be corrected without
  re-reading the export.
- `reports.js` — imports `config.js`, `ledger.js`. Pure computation, no DOM.
- `snapshots.js` — snapshot shape, drift comparison, number formatting.
- `render.js` — DOM only. No arithmetic beyond summing what it was handed.
- `install.js` — PWA lifecycle, independent of everything else.
- `main.js` — wiring. The only module that touches `document` events, the tab
  strip included.

`reports.js` must stay DOM-free so the test harness can import it under Node.

## Testing

```
node test/reconcile.test.mjs                    # synthetic fixture
node test/reconcile.test.mjs <path-to-export>   # invariants only
```

Run after **any** change to `ledger.js` or `reports.js`.

- **Invariants** hold for any well-formed export. Adding one is usually worth
  more than adding another golden value.
- **Golden values** are pinned to the synthetic fixture and skipped otherwise.

When a number moves, re-derive it deliberately and explain the change. Do not
loosen a tolerance or delete an assertion to get a green run. If a number moves
and you cannot explain why, that is the finding — report it rather than
accommodating it.

Load-bearing assertions: `Other + all columns == Total` on Event Income, totals
independent of `pastEventsShown`, Total Assets unaffected by the as-of date, the
settings-file round-trip, and the two generated-file freshness checks.

`defaults.txt` and `test/fixtures/sample-settings.txt` are generated. Never edit
them by hand — change the source and rerun:

```
node tools/emit-defaults.mjs        > defaults.txt
node tools/emit-sample-settings.mjs > test/fixtures/sample-settings.txt
```

## Deployment

**Branching: commit straight to `gh-pages`.** That is the branch Pages serves
and the branch this repo develops on; there is no separate default branch to
merge back into, and no long-lived feature branches. Work directly on it unless
the change is large enough that the owner asks for a branch.

Because the branch is the live site, a push *is* a deployment. Before pushing:

- run `node test/reconcile.test.mjs` and see it green,
- bump `CACHE_VERSION` in `sw.js`,
- regenerate `defaults.txt` and `test/fixtures/sample-settings.txt` if
  anything they derive from moved.

If a push to `gh-pages` is rejected — branch protection, or a permission the
session does not have — do not silently leave the work on a side branch. Push
the branch, open a pull request against `gh-pages`, and offer to merge it as the
closing step of the task rather than treating the PR as the finish line.

Static, no build step of our own. GitHub Pages serves the repo root of whichever
branch Pages is configured for, through its Jekyll build. All paths are relative
so a project subpath and a custom domain both work untouched — never introduce a
path beginning with `/`, and do not delete `CNAME`.

`_config.yml` is the only thing that build does: it excludes `README.md`,
`CLAUDE.md`, `tools/` and `test/` so developer documentation and fixtures are
not published. **Do not add `.nojekyll`** — it disables the build and with it
every exclusion. Adding a repo-only file means adding it to `_config.yml`.

`js/package.json` exists solely so Node treats `js/*.js` as ES modules when the
tests and the emit tools import them; browsers never fetch it, and it is
excluded from the published site.

`CACHE_VERSION` is shown in the page header ("v9"), asked of the running
service worker over a message channel rather than duplicated in the page — so it
reports the shell actually serving the page, which after a deployment may still
be the old one. Keep that the single source; do not add a version constant to
the page.

**Bump `CACHE_VERSION` in `sw.js` on every deployment**, or installed clients
keep serving the old shell. Adding or renaming a shell file means updating the
`SHELL` array in `sw.js` too.

## Domain gotchas that will bite

- **TroopWebHost is not strict double-entry.** "Credit Troop Account" and "Credit
  Person" both mean *money in*, so an asset and a liability can both rise on one
  transaction. There is no global zero-sum invariant; do not assert one.
- **The balance sheet is not date-filtered.** Event pre-charges are dated to the
  event, so a future-dated row has already moved a scout's balance. Filtering by
  as-of would understate liabilities. The deferred position is reported instead
  as the *Other Future Events (Net)* liability line. Historical figures come from
  snapshots, not recomputation. Explained at the top of `balanceSheet()`.
- **Only the balance sheet is snapshotted.** The income statements are period
  reports and are allowed to drift when back-dated entries land. Do not add them
  to `BS_ROW_KEYS` or the drift report.
- **Assets are one section.** `noncash` does not split a line out of Total
  Assets; it marks the amount for deduction from unrestricted net assets.
- **Event Income `Total` is period-scoped** to the activity-since date, not all
  time. Earlier activity is the Prior Period line.
- **Event dates come from the trailing `(MM/DD/YY)` in the event name.** Nothing
  else carries them.
- **Troop-held accounts are the `_` prefix, not a name list.** Match the prefix;
  never enumerate specific accounts in report code.

## Style

Vanilla ES modules, no transpiler, no bundler. Modern syntax is fine — the target
is current evergreen browsers plus iOS Safari. Comments should explain *why*,
especially where the code encodes a domain quirk; this will be read by a
volunteer treasurer's successor, possibly years from now.

Prefer failing loudly over degrading quietly. Every silent fallback in this
domain is a future misstated financial report.
