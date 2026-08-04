# Troop Finance Reports

Offline reporting for TroopWebHost transaction exports. Produces three printable
reports — **Balance Sheet**, **Event Income**, **Monthly Income** — replacing the
spreadsheet pipeline of pivot tables and hand-maintained `SUMIF` columns.

Everything runs in the browser. The CSV is read through the File API and is never
uploaded, never fetched over the network, and never written to storage.

---

## Quick start

**Hosted (GitHub Pages).** Push the branch Pages is set to serve (Settings →
Pages → Deploy from branch, root). All paths are relative, so a
`https://<user>.github.io/<repo>/` project subpath and a custom domain both work
without configuration; a `CNAME` file, if present, is what points the custom
domain here — don't delete it. `_config.yml` keeps the docs and the test suite
out of the published site, so **do not add a `.nojekyll` file**: it would
disable the build and publish them.

**Local.** Open `index.html` directly. Service workers don't run from `file://`,
so you lose offline install, but every report works. To exercise the service
worker, serve the directory over http: `python3 -m http.server 8080`.

**First run.** Load `defaults.txt` as your settings file, edit the `accounts:` and
`funds:` sections to match your troop's TroopWebHost setup, and load it back. Or,
from a checkout of this repo, load `test/fixtures/sample-settings.txt` with
`test/fixtures/sample-export.csv` to see every report with no setup at all —
both are synthetic.

**Install.** On Chrome/Edge/Android an *Install for offline use* button appears
once the browser decides the app is installable. On iOS, use Share → Add to Home
Screen; Safari never fires the install event.

## Monthly runbook

1. TroopWebHost → **Export All Transactions to Excel** (it emits CSV despite the name).
2. Open the app, drop the file on the target.
3. Read the **Reconciliation** panel. Account count, fund count and transaction-type
   count should match last month. A jump in *single-leg entries* means someone
   posted something unusual.
4. Set **Past events shown** so Event Income fits one page.
5. Print each report. Browser print → Save as PDF.
6. **Capture snapshot at this date**, then **Download settings file** and keep it
   with the PDFs. That file is the handover artefact.

---

## Conventions

### Sign convention

**Credit positive, debit negative, on every leg.** Stated once in `js/ledger.js`
and never restated. Revenue funds accumulate positive, expense funds negative.
The sign is flipped for display in exactly one place — `sectionSign()` in
`js/reports.js` — so expenses print positive under expense headings.

Spreadsheet-era workbooks characteristically carry *two* conventions in
different blocks and mix them inside single formulas. That is a large part of why
their printed figures drift from the ledger.

### Fund categories

Every fund maps to one of six categories, set in `js/config.js`:

| Category | Sign | Feeds |
|---|---|---|
| Program Revenue | revenue | Net Income — Scouting Program |
| Program Expenses | expense | Net Income — Scouting Program |
| Fundraising Revenue | revenue | Net Income — Fundraising |
| Fundraising Expenses | expense | Net Income — Fundraising |
| Other Income | revenue | Net Income — Other |
| Other Expenses | expense | Net Income — Other |

The map does double duty. Besides placing a fund in an income-statement section,
it classifies **events**: an event whose fund activity is mostly Program-category
is a program event and gets a column on Event Income; one that is mostly
Fundraising-category (a concessions shift, a product sale) is excluded from the
columns and rolls into *Other*. In practice the split is unambiguous: an event
mixes categories rarely, and when it does the majority decides.

**A fund in the export that is missing from the map halts the load.** It does not
silently contribute zero — silently contributing zero is how a spreadsheet loses
a renamed event without anyone noticing.

Three funds are deliberate pass-throughs whose revenue and expense should cancel
over a full cycle: `Member Fees (Passthru)`, `Custom Order (Passthru)`, and the
`Concessions Fundraising (from Venue)` / `(to Scout)` pair. A large residual on any of
them means money was booked on one side only.

`Crew Funds Utilized` and `Crew Expense` map to Program Revenue and Program
Expenses respectively, so the Venture Crew appears inside the program sections
rather than as its own block. Change the map if you want it broken out.

### Troop account classification

Troop accounts do not appear in the fund map, so they carry their own
classification (editable in the app, defaults in `js/config.js`):

| Class | Meaning |
|---|---|
| `cash` | Current asset. Counts toward Total Assets. |
| `noncash` | Included in Total Assets, deducted from unrestricted net assets — inventory, for example, whose carrying value is a manual judgement maintained in TWH. |
| `liability` | Shown under Liabilities with the sign inverted — a credit card, for example. |

**An account in the export that is not classified halts the load.** The failure
this prevents is a spreadsheet row whose hand-typed label no longer matches any
account name: it contributes zero regardless of the account's true balance, and
nothing tells you.

### Person accounts and the `_` prefix

An account name beginning with `_` — by convention `_<PREFIX>, Label (Main)`, e.g.
`_UNIT, Campership (Main)` or `_CREW, Venture Crew (Main)` — is a **troop-held
fund**, not a person. These are:

- excluded from Scout Accounts (Prepaid Fees),
- listed individually under Liabilities,
- excluded from the arrears count,
- **not hashed**, because the balance sheet names them.

This one rule replaces a set of hand-written `SUMIF`s and covers any
pseudo-account created later without a code change.

Everything else is a scout account, hashed on parse (below).

### Event naming

The trailing `(MM/DD/YY)` in a TWH event name is **load-bearing** — it is the only
source of the event date. Renaming an event is safe; the report follows the name
in the current export. Removing the date suffix is not safe: the event can't be
placed on the timeline and falls into *Other*, and the reconciliation panel says so.

### Anonymization

Scout names are MD5-hashed at parse time and the original column is discarded
before any other code reads it. Names exist for the duration of one loop over the
rows and never reach storage, the DOM, or a printed report. Display form is the
first 8 hex characters.

Unsalted MD5 over a known roster is reversible by brute force. This is
pseudonymization, not anonymization — it protects against casual disclosure and
localStorage leakage, not against someone who already holds the roster. Set
`hashSalt` in `js/config.js` if you want that changed.

---

## Report definitions

### Balance Sheet

Reflects **every recorded transaction**, not only those dated on or before the
"as of" date. TWH dates an event pre-charge to the *event* date, so a scout
charged today for a September campout produces a future-dated row that has
already moved their balance. Filtering those out would understate liabilities and
contradict the *Other Future Events (Net)* line, which is by definition about
future dates.

The consequence: a true historical balance sheet cannot be recomputed from the
ledger, because a future-dated pre-charge is indistinguishable from a back-dated
correction. That is what **snapshots** are for. The "as of" date labels the report
and drives the future/past event split; it does not filter legs.

```
Unrestricted Net Assets = Total Assets
                        − Net Scout Balances
                        − Total Liabilities
                        − Non-Cash Assets
```

Assets are one section. Cash accounts and non-cash accounts are listed together
and total to **Total Assets**; a dagger marks the non-cash lines. The `noncash`
classification does not move a line out of the section, it only marks the amount
for deduction from unrestricted net assets, since inventory can't be spent.

*Other Future Events (Net)* is the all-time net position of every event dated
after the as-of date — money collected for things that haven't happened.

### Event Income

Columns are derived, never typed. Future events first (all future program events
with activity), then the most recent **N** past program events. Events beyond N
still roll into *Other*, so **totals do not change with N** — the column limit is
purely a page-fit control.

`Total` is the **period** total: activity on or after the *activity since* date.
Earlier activity for a shown event appears on the *Prior Period Net Income* line.
`Other / Non-Event` is `Total` minus every displayed column, so
`Other + columns = Total` exactly. That identity is asserted in the test.

### Monthly Income

Rolling **N** months ending at the as-of month, derived rather than hand-rolled.
The `Total` column sums the months shown, not all time; the footnote states the
difference, which includes future-dated pre-charges and the opening-balance
import.

### Snapshots

**The balance sheet is snapshotted; the income statements are not.** Event Income
and Monthly Income are always recomputed and are allowed to move if a back-dated
entry is added — that is correct behaviour for a period report. The balance sheet
is the one thing published as a point-in-time position, so it is the one thing
frozen.

Snapshots live in the settings file (below). When one exists for the current
as-of date, the app compares it against the recomputed figures and reports any
**drift** — a back-dated correction that landed after publication. Surfacing that
is the point; a spreadsheet buries it.

## The settings file

One plain-text document holds everything except the transactions: troop name,
report parameters, the chart of accounts, and the snapshots. **That file plus a
fresh TroopWebHost export is all a new treasurer needs.**

It is YAML with a `.txt` extension. The extension is deliberate — on Windows a
`.yml` opens in whatever happens to be registered, or in nothing, while `.txt`
reliably opens in Notepad. The people inheriting this are volunteers.

```yaml
version: 1

troop:
  name: "Example Troop"

parameters:
  activitySince: 2023-09-01
  pastEventsShown: 8
  monthsShown: 12
  asOf: null
  legacyMode: false
  legacyDeductedAccounts: []
  hashSalt: ""

accounts:
  Checking: cash
  Merchandise Inventory: noncash
  Credit Card: liability

funds:
  Registration Revenue: Program Revenue
  Camping (Weekend) Expense: Program Expenses

snapshots:
  2024-08-03:
    total_assets: 79904.54
    scout_arrears_count: 8
    unrestricted_net_assets: 51380.54
```

The figures above are the synthetic fixture's, not any troop's.

**It contains no personal data** — no scout names, no per-account balances, no
transactions. Only configuration and whole-troop totals. Safe to email to a
successor; a transaction export never is.

The parser is a deliberately small YAML subset (`js/yaml.js`): mappings,
sequences, quoted and typed scalars, comments. It rejects tabs, odd indentation,
duplicate keys, unterminated quotes, and inline collections **with a line
number**, because silently mis-parsing a financial settings file is far worse
than refusing to open it. Currency is written with two decimal places and still
parses back as a number.

Two generated files ship with the repo, both regenerated by tools rather than
hand-maintained. The test suite fails if either has drifted:

```
node tools/emit-defaults.mjs        > defaults.txt
node tools/emit-sample-settings.mjs > test/fixtures/sample-settings.txt
```

`defaults.txt` is the starting template: the example chart of accounts, ready to
edit. `test/fixtures/sample-settings.txt` pairs with `sample-export.csv` — load
both and every report renders immediately, snapshots included.

---

## Transaction types

The transaction types TroopWebHost emits, with the legs each populates. Your
troop may use a subset, or types not listed here; the app does not enumerate
types, it reads whichever columns are populated.
`TA` = troop account, `P` = person, `F` = fund, `E` = event; `Dr`/`Cr` = debit/credit side.

| Transaction Type | Legs |
|---|---|
| Charge Scout an Event Fee | P·Dr, F·Cr, E·Cr |
| Deposit to Scout Account | TA·Cr, P·Cr |
| Individual Fundraising (Event) | P·Cr, F·Dr, E·Dr |
| Expense (Non-Event) paid by Troop | TA·Dr, F·Dr |
| Transfer Between Scout Accounts | P·Dr, P·Cr |
| Expense (Event) paid by Troop | TA·Dr, F·Dr, E·Dr |
| Grubmaster | P·Cr, F·Dr, E·Dr |
| Charge Scout a Non-Event Fee | P·Dr, F·Cr |
| Transfer Between Troop Accounts | TA·Dr, TA·Cr |
| Reimburse Expense (Event) to Scout Account | P·Cr, F·Dr, E·Dr |
| Deposit To Troop Account | TA·Cr, F·Cr |
| Other Income | TA·Cr, F·Cr |
| Return money to Scout from Scout Account | TA·Dr, P·Dr |
| Donation | P·Dr, P·Cr, F·Cr |
| Campership | P·Dr, P·Cr, F·Dr |
| Popcorn to Scout Account | P·Cr (F·Dr on 3) |
| Membership/Recharter from Scout Account | TA·Dr, P·Dr, F·Dr, F·Cr |
| Reimburse Expense (Non-Event) to Scout Account | P·Cr, F·Dr |
| \*Add to Scout Account | P·Cr only |
| Reimburse Expense (Event) to Scout as Payment | TA·Dr, P·Dr, P·Cr, F·Dr, E·Dr |
| Expense (External Event) paid by Troop from Scout Account | TA·Dr, P·Dr, F·Dr, F·Cr, E·Dr, E·Cr |
| Reimburse Expense (Non-Event) to Scout as Payment | TA·Dr, P·Dr, P·Cr, F·Dr |
| Cash given to Scoutmaster | P·Dr, P·Cr |
| Expense (Non-Event) paid by Troop from Scout Account | TA·Dr, P·Dr, F·Dr |
| Expense (Event) paid by Troop from Scout Account | TA·Dr, P·Dr, F·Dr, E·Dr |
| Transfer Between Funds | F·Dr, F·Cr |
| Refund Fee (Non-Event) to Scout Account | P·Cr, F·Dr |
| Other Income to Scout Account | TA·Cr, P·Cr, F·Cr |

Notes that matter for reading the reports:

- **TWH is not strict double-entry.** "Credit Troop Account" and "Credit Person"
  both mean *money in*, so an asset and a liability can rise on the same
  transaction. There is deliberately no "all legs net to zero" assertion.
- **Single-leg entries are legitimate.** `*Add to Scout Account` and similar
  `*`-prefixed adjustment types carry one leg, and opening-balance imports for
  scout accounts do too. The count should be stable month to month; a jump means
  someone posted something unusual.
- **Opening balances are typically booked through a fund account** with fiscal
  year `Opening`. This inflates all-time fund totals, which is why every income
  report is period-limited rather than an all-time roll-forward.
- **`Expense (External Event) paid by Troop from Scout Account`** is the only type
  populating both Debit Event and Credit Event; they are always the same event, so
  it is attributed to that event. A spreadsheet that blanks the ambiguous case
  instead drops those rows from the by-event report entirely.

## TroopWebHost configuration

**Affects the export and therefore the reports:**

- **Fund list.** Every fund must exist in `js/config.js`. Adding a fund in TWH
  without adding it here halts the load — deliberately.
- **Troop account list.** Same, for `accountClass`. Classify new accounts as
  cash / noncash / liability before the next export.
- **Event names.** Keep the trailing `(MM/DD/YY)`. TWH generates it; don't edit it out.
- **Pseudo-accounts.** Troop-held funds held as person accounts must keep the
  leading `_`. Without it they are treated as a scout, land in prepaid fees, and
  can appear in the arrears count.
- **Transaction types.** Choosing the type determines which legs post. A fee
  entered as a non-event fee will never appear in an event column.

**Documentation only — does not affect the export or the reports:**

- Budget and Budget Item Type: present as columns, empty in every row.
- Deposit Date, For Event: present as columns, empty in every row.
- Reconcile Debit / Reconcile Credit: bank-reconciliation batch labels, not read here.
- Added By User: audit trail, not read here.
- Fiscal Year: populated, but no report uses it (the FY comparison report was
  dropped from scope).

---

## Legacy mode

Many troops arrive here from a spreadsheet built on pivot tables and copy-pasted
`SUMIF` formulas. Those spreadsheets fail in characteristic ways, and this app
reproduces the failures on demand so a migration can be audited line by line
rather than taken on faith. Turn **Legacy mode** on to see the old numbers, off
to publish the correct ones.

Legacy mode reproduces two defect classes:

- **Arrears double-counted.** Negative scout balances are included in prepaid
  fees *and* subtracted again on their own line, and the arrears count includes
  troop-held accounts that are not people.
- **Hand-maintained deduction lists go stale.** Prepaid fees are computed by
  subtracting a list of troop-held accounts typed in by hand. Set that list in
  `legacyDeductedAccounts`; any pseudo-account missing from it is double-counted,
  exactly as it would have been in the spreadsheet.

The defects this app avoids structurally, and that no toggle brings back:

| Spreadsheet failure | How it is prevented here |
|---|---|
| Two sign conventions coexisting, mixed inside one formula | One convention set in `ledger.js`; sign flips in exactly one function |
| A row label naming an account or event that was later renamed | Names come from the export every run; unmatched names halt the load |
| A new fund silently contributing zero | Unmapped funds halt the load |
| A new account silently dropped from the balance sheet | Unclassified accounts halt the load |
| Formulas summing the wrong range after a column is inserted | No ranges; every figure is a filtered sum over the ledger |
| Cached values going stale when a formula stops recalculating | Nothing is cached; every figure is recomputed on load |
| Month and event columns rolled forward by hand | Both derived from the data |
| `#REF!` cells nobody notices | No cell references exist |

Presentation notes for anyone migrating: the assets total is labelled **Total
Assets** and includes non-cash lines, daggered and deducted from unrestricted net
assets on their own line rather than silently; past events roll forward
automatically as their dates pass; and funds land in whichever section your
category map assigns them, which may differ from how a spreadsheet grouped them
by hand.

---

## Testing

```
node test/reconcile.test.mjs                     # synthetic fixture
node test/reconcile.test.mjs ~/Downloads/YOUR_EXPORT.CSV   # invariants only
```

Two kinds of assertion. **Invariants** hold for any well-formed export — `Other +
columns == Total`, net income equals revenue minus expenses, totals independent
of the column limit, the balance sheet unaffected by the as-of date, and the
documented legacy-vs-corrected differences. **Golden values** are pinned to the
fixture and only run against it.

Requires Node 18+, no packages. If a number moves and you cannot explain why,
that is the finding — do not loosen a tolerance to get a green run.

## Security posture

- **Zero external requests.** No CDN, no fonts, no analytics. Nothing shares an
  origin with parsed scout data.
- **No transaction data in storage or in the settings file, ever.**
  `localStorage` and the settings file hold configuration and whole-troop
  snapshot totals only. The service worker caches the app shell only — enforced
  structurally, since the CSV never becomes a `Request`.
- **No URL state, no share links.** Nothing to leak through history or referrers.
- **Print is an allow-list.** A new report section is hidden until named in the
  `@media print` rules, so a schema change can't start printing unreviewed columns.
- Names hashed at parse; originals discarded immediately.

**Purge offline cache** in the app clears the shell cache and unregisters the
service worker. **Clear cached settings** resets config while keeping snapshots.

## Layout

```
index.html            markup and controls
app.css               screen + print styles (one report per sheet)
manifest.webmanifest  PWA manifest
sw.js                 app-shell service worker
_config.yml           Pages build: keeps repo-only files unpublished
CNAME                 custom domain for the published site
js/csv.js             RFC 4180 parser, MD5
js/config.js          fund map, account classification, parameters
js/ledger.js          hashing, canonical leg ledger, validation
js/reports.js         the three reports
js/snapshots.js       snapshot round-trip, drift, formatting
js/render.js          DOM rendering
js/install.js         PWA install + service worker lifecycle
js/yaml.js            small strict YAML subset (parser + emitter)
js/settings.js        the settings file: config + snapshots, one document
js/main.js            wiring
js/package.json       marks js/ as ES modules so Node can import it
defaults.txt          starting settings file (generated)
tools/                regenerate the two committed generated files
test/reconcile.test.mjs      invariants + golden values
test/fixtures/generate.mjs   synthetic export generator (seeded)
test/fixtures/sample-export.csv    the fixture — synthetic, safe to commit
test/fixtures/sample-settings.txt  settings to pair with it (generated)
```
