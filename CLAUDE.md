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
  scout names, individual scout balances, and transactions — configuration,
  whole-troop totals, and the troop's own account lines. There is a test
  asserting this; do not weaken it.

  The account lines are the balance sheet's own rows: the troop's bank accounts,
  its card, and the `_` prefixed troop-held funds, frozen by date under
  `accounts` inside each snapshot. They are there because a balance sheet that
  can say Total Assets moved but not *which account* moved answers half the
  question. They are a deliberate widening of what this file carries, made on
  the owner's request, and the line they do not cross is a person: never
  `bs.scouts`, never a balance keyed by a scout hash. A treasurer forwarding
  this file is disclosing the troop's finances by institution, which is a real
  thing to know about it — say so when you hand one over.

**Never transmit anything.** This app makes zero network requests at runtime, and
that is load-bearing rather than incidental — a third-party script sharing an
origin with a parsed export is the exact failure this design exists to prevent.

- No CDN, no web fonts, no analytics, no telemetry, no error reporting service,
  no npm runtime dependency. If a task seems to need a library, vendor it and say
  so, or push back.
- The CSV is read through the File API and never becomes a `Request`. Do not add
  a fetch, upload, URL parameter, form post, or cache write that carries ledger
  content.
- `localStorage` holds configuration and balance-sheet snapshots only — the
  totals and the troop account lines described above. Never transactions, never
  a person's name or balance.
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

   The chart is also editable *after* an import — funds and accounts can be
   added and removed on the Settings tab — so the same check has to run against
   an already-built ledger: `validateChart` in `ledger.js`, called from
   `afterChartEdit`. A name the loaded export uses cannot be removed at all: the
   ✕ is disabled and `onRemove` refuses it, because a chart that cannot classify
   the transactions in front of it is not a tidier chart. `validateChart` stays
   as the backstop for the path the UI does not own — a settings file that
   removes a fund by hand — and stops the reports with the fund named rather
   than letting its legs quietly cease to be counted.

   A fund that is *not* in the export may be removed, but its budget may not
   vanish with it. Removal offers a fund to move the budget onto and
   `mergeBudgetLine` adds it in year by year, so every fiscal year's total is
   what it was before. For the same reason the import review's bulk "remove
   unused" offer skips budgeted funds and names them instead: where a budget
   goes is a decision per fund, not a side effect of a tidy-up.
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

```
index.html            markup and controls (Import/Reports/Settings/Cache/Help)
app.css               screen + print styles (one report per sheet)
manifest.webmanifest  PWA manifest
sw.js                 app-shell service worker
_config.yml           Pages build: keeps repo-only files unpublished
CNAME                 custom domain for the published site
js/package.json       marks js/ as ES modules so Node can import it
defaults.txt          starting settings file (generated)
tools/                regenerate the two committed generated files
test/reconcile.test.mjs            invariants + golden values
test/fixtures/generate.mjs         synthetic export generator (seeded)
test/fixtures/sample-export.csv    the fixture — synthetic, safe to commit
test/fixtures/sample-settings.txt  settings to pair with it (generated)
```

## Agents

Three subagents live in `.claude/agents/`, each pinning its own model and
effort. Use them; do not do their jobs inline.

- **`test-runner`** (sonnet, low) — runs `node test/reconcile.test.mjs` and
  reports. **Every test run goes through it**, including the routine green check
  after a small change. It is read-only by construction: it cannot edit a golden
  value, loosen a tolerance, or regenerate a file to make a run pass, which is
  exactly the pressure a failing run applies.
- **`browser-check`** (sonnet, medium) — drives headless Chromium. Use it
  whenever a change touches `index.html`, `app.css`, `main.js` or `render.js`;
  the Node suite has no DOM and cannot see a tab that does not switch, a print
  sheet that spills, or a `replaceChildren` thrown mid-blur.
- **`privacy-auditor`** (opus, high) — audits a change against Rules 1 and 2
  before a push that touches ingest, storage, the service worker, the fixtures,
  or anything that adds a request.

**Agents wrap skills; they do not replace them.** If a skill covers the task —
`/code-review`, `/security-review`, `run` — the agent invokes it and follows it,
then reports. Do not reimplement a skill's checklist in an agent definition, and
do not skip a skill because an agent exists.

Adding an agent means giving it a `model:` and an `effort:` explicitly. The
default is not a decision.

## Testing

```
node test/reconcile.test.mjs                    # synthetic fixture
node test/reconcile.test.mjs <path-to-export>   # invariants only
node test/reconcile.test.mjs <export> <settings.txt>   # ... against their chart
```

The third form is what makes the second one usable on a real troop's export: the
shipped example chart does not classify their funds, so the run halts before any
invariant is checked. A settings file disqualifies the golden values even when
the export is the fixture, because those are pinned to the shipped chart.

Run through the `test-runner` agent after **any** change to `ledger.js` or
`reports.js` — and before any push, since a push to `gh-pages` is a deployment.

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

To run it locally, open `index.html` directly — every report works, but service
workers do not run from `file://`, so offline install is not exercised. Serve
the directory over http (`python3 -m http.server 8080`) when the change touches
`sw.js` or `install.js`.

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
- **A budget is not data, and it is not TroopWebHost's.** It exists only in this
  app, so the settings file is the only copy — treat losing it as losing the
  budget. Budget keys are a fund *or* a category, and a category figure covers
  what was not budgeted by fund, so a section's budget is the category figure
  plus the fund figures inside it. Never spread a category figure across its
  funds: it would invent per-fund budgets nobody set.
- **Blank is not zero, on a budget line.** Zero says "we planned to spend
  nothing here" and a blank says nothing at all; the statement prints them
  differently, and `roundBudgets` drops zeros rather than writing them to the
  settings file. A net line budgeted on one side only is marked, not completed
  with an assumed zero.
- **The fiscal year drives the monthly window.** `fiscalYearStart` defaults to
  January, so Monthly Income normally runs from the fiscal year's first month to
  the as-of month rather than a rolling `monthsShown` — which is what makes the
  Total column comparable to an annual budget. Do not print a budget beside a
  total covering a different period. `null` restores the rolling window and
  disables budgets; that is the only case where `monthsShown` is read. A fiscal
  year is named by the calendar year it starts in. Both controls live on the
  Settings tab: the fiscal year cannot go in the Parameters block, which is
  inside `#reports` and hidden until an export loads — a budget has to be
  settable before there is any data.
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
  never enumerate specific accounts in report code. A troop-held fund that lost
  its underscore in TroopWebHost is read as a scout: it lands in prepaid fees
  and can show up in the arrears count.
- **Single-leg entries are legitimate.** `*`-prefixed adjustment types carry one
  leg, and so do opening-balance imports for scout accounts. Do not treat a row
  with one leg as malformed. The *count* is the signal — the reconciliation
  panel reports it because a jump month to month means someone posted something
  unusual.
- **Opening balances are usually booked through a fund**, with fiscal year
  `Opening`. That inflates all-time fund totals, which is why every income
  report is period-limited rather than an all-time roll-forward.
- **Nothing reads a transaction type.** `buildLedger` looks at whichever leg
  columns a row populates, so a type this codebase has never seen needs no code
  change. Do not add a type table or a switch on `Transaction Type`; the one
  place the type is kept is for the reconciliation panel's counts.
- **Columns present but never read**: Deposit Date, For Event, Budget, Budget
  Item Type, Group, Reconcile Debit/Credit, Added By User, and Fiscal Year.
  Fiscal Year is populated by TroopWebHost and still unused — the fiscal year
  the reports work in comes from `fiscalYearStart` and the transaction date, not
  from that column. Reaching for it is usually a mistake.

## Style

Vanilla ES modules, no transpiler, no bundler. Modern syntax is fine — the target
is current evergreen browsers plus iOS Safari. Comments should explain *why*,
especially where the code encodes a domain quirk; this will be read by a
volunteer treasurer's successor, possibly years from now.

Prefer failing loudly over degrading quietly. Every silent fallback in this
domain is a future misstated financial report.
