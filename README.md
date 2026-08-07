# Troop Finance Reports

Offline reporting for TroopWebHost transaction exports. Produces three printable
reports — **Balance Sheet**, **Event Income**, **Monthly Income** — replacing the
spreadsheet pipeline of pivot tables and hand-maintained `SUMIF` columns.

Everything runs in the browser. The CSV is read through the File API and is never
uploaded, never fetched over the network, and never written to storage.

---

## Quick start

**Hosted (GitHub Pages).** Push the branch Pages is set to serve (Settings →
Pages → Deploy from branch, root). This repo publishes from `gh-pages` and
develops on it too, so a push is a deployment: run the tests and bump
`CACHE_VERSION` in `sw.js` before you push, or installed clients keep serving
the old shell. All paths are relative, so a
`https://<user>.github.io/<repo>/` project subpath and a custom domain both work
without configuration; a `CNAME` file, if present, is what points the custom
domain here — don't delete it. `_config.yml` keeps the docs and the test suite
out of the published site, so **do not add a `.nojekyll` file**: it would
disable the build and publish them.

**Local.** Open `index.html` directly. Service workers don't run from `file://`,
so you lose offline install, but every report works. To exercise the service
worker, serve the directory over http: `python3 -m http.server 8080`.

**First run.** On the **Settings** tab, load `defaults.txt` as your settings
file, edit the `accounts:` and `funds:` sections to match your troop's
TroopWebHost setup, and load it back. Or,
from a checkout of this repo, load `test/fixtures/sample-settings.txt` with
`test/fixtures/sample-export.csv` to see every report with no setup at all —
both are synthetic.

**The tabs.** **Import** takes the transaction export and is the only place a file
is dropped; it switches to **Reports** once the file loads, and reports live there
only while an export is loaded. **Settings** is the settings file and the chart of
accounts. **Cache** is everything the browser is holding, and how to clear it.
**Help** is the monthly routine and the reasoning behind the reports, written for
the volunteer inheriting this. Switching tabs never changes the address bar.

**Install.** On Chrome/Edge/Android an *Install for offline use* button appears
once the browser decides the app is installable. On iOS, use Share → Add to Home
Screen; Safari never fires the install event.

## Monthly runbook

1. TroopWebHost → **Export All Transactions to Excel** (it emits CSV despite the name).
2. Open the app, drop the file on the target on the **Import** tab. It switches to
   **Reports** once the file loads, unless there is something to review.
3. Work through the **import review**, if there is one: confirm the classification
   guessed for any new fund or account, and take the offer to remove anything the
   export never mentioned.
4. Read the **Reconciliation** panel. Account count, fund count and transaction-type
   count should match last month. A jump in *single-leg entries* means someone
   posted something unusual.
5. Set **Past events shown** so Event Income fits one page.
6. Print each report. The buttons set the paper themselves — portrait for the
   balance sheet, landscape for the two statements — and each report is sized to
   land on one sheet, so Chrome's *Save as PDF* needs no adjusting. Ctrl+P works
   too, from any tab: only the reports print, in landscape.
7. **Capture snapshot at this date**, then, on the **Settings** tab, **Download
   settings file** and keep it with the PDFs. That file is the handover artefact.

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

**A fund in the export that is missing from the map is never silently ignored.**
Import adds it with a guessed category and names it in the review (below); the
ledger still refuses to build a report from a fund it cannot classify, as the
backstop. What it must never do is contribute zero — silently contributing zero
is how a spreadsheet loses a renamed event without anyone noticing.

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

**An account in the export that is not classified is added on import as `cash`,
unless its name says otherwise, and listed for confirmation.** The failure being
prevented is a spreadsheet row whose hand-typed label no longer matches any
account name: it contributes zero regardless of the account's true balance, and
nothing tells you. A guess is the opposite of that only while it is visible —
hence the review, and the warning that sits above the reports until it is done.

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

## Fiscal year and budget

**Fiscal year.** `fiscalYearStart` is the month a troop's year begins, 1–12, and
is unset by default. Setting it changes the monthly income statement from a
rolling `monthsShown` window to **the fiscal year to date** — the months from the
start of the fiscal year containing the as-of date, through the as-of month. That
is what makes the Total column comparable to an annual budget; comparing a budget
against a rolling twelve months would be quietly wrong. A fiscal year is
identified everywhere by the calendar year it *starts* in, so the year running
September 2024 to August 2025 is `2024`, and prints as `FY 2024–25`.

**Budget.** A budget is this app's own: TroopWebHost has no concept of one, so
the settings file is the only copy there is. Budgets are entered on the Settings
tab or written into the settings file directly, keyed by fiscal year:

```yaml
budgets:
  "2023":
    Program Expenses: 26000.00     # a whole category
    Food Expense: 1500.00          # one fund inside it
```

Each line is **either a fund or one of the six category names**. Use whichever
suits: budget every fund, budget the category as a lump, or mix the two — a
category figure covers whatever in that category was not budgeted by fund, so a
section's budget is `category figure + the fund figures inside it`. Enter every
figure as a positive number, the way it prints on the statement: revenue as
revenue, spending as spending.

The statement then carries two more columns, **Budget** and **Remaining**
(`budget − fiscal year to date`), which appear together or not at all — a
remaining figure with nothing to remain from is noise. Rows with no budget are
left **blank rather than zero**: zero is a decision to spend nothing, and a blank
is the absence of one. A budgeted fund with no activity yet still gets a row, or
its budget would be invisible. A net-income line budgeted on one side only —
revenue budgeted, expenses not — is marked `†` and says so in the notes, rather
than treating the missing half as zero.

## The import review

Every import compares the chart of accounts against what the export actually
contains, in both directions, and shows the result on the Import tab before the
reports.

**Names the export has and the settings don't** are added automatically with a
guessed classification, so a fund added in TroopWebHost last week does not send
a volunteer to hand-edit a settings file to see any figure at all. The guess:

- The **section** comes from words in the name — fundraising terms
  (`fundrais…`, `sponsor`, `raffle`, a named product sale) pick Fundraising,
  bookkeeping terms (`admin…`, `interest`, `charter`, `passthru`) pick Other,
  and everything else is Program, which is where most troop activity lives.
- The **side** — revenue or expense — comes from an explicit word in the name if
  there is one, so a fund called `… Expense` stays an expense in a month when
  refunds made it net positive. With no such word the sign of the fund's net in
  the export decides, credit-positive meaning revenue. A word that names a
  section but not a side (`donation` — received or made?) is left to the sign.
- **Troop accounts** are `cash` unless the name says `inventory`/`merchandise`
  (→ `noncash`) or `credit card`/`loan`/`payable` (→ `liability`).

Against the shipped example chart the guess gets 31 of 34 fund categories, and
the revenue/expense side right on 33 of 34 — the remaining one being a
pass-through, which is genuinely ambiguous. It is a heuristic and it is presented
as one: each row shows the fund's net and leg count as evidence, changing a
dropdown re-files it immediately, and a warning sits above the reports naming
how many names were guessed.

**Names the settings have and the export doesn't** are the opposite problem —
last year's chart of accounts accumulating entries nobody removed. They are
listed (short lists inline, long ones collapsed) with an offer to delete. Nothing
in the reports refers to them, so removing them moves no figure; if one turns up
in a later export it comes back, guessed like any other new name. This is offered
only, never done automatically, and never at all when the load failed — a
malformed export produces no legs, against which the whole chart would look
unused.

Correcting a classification does **not** require re-importing. Each event's
program-or-fundraising kind is the only part of the ledger that depends on the
chart of accounts, and it is recomputed in place from the legs already in memory
(`classifyEvents`). The export itself is still never retained.

## The settings file

One plain-text document holds everything except the transactions: troop name,
report parameters, the chart of accounts, and the snapshots. **That file plus a
fresh TroopWebHost export is all a new treasurer needs.**

It is YAML under the hood, written as `troop-settings.txt` — one extension, and
`.txt` rather than `.yaml` on purpose. On Windows a `.yaml` opens in whatever
happens to be registered, or in nothing, while `.txt` reliably opens in Notepad.
The people inheriting this are volunteers, and nothing in the interface mentions
the format: it is a settings file you edit in a text editor. Keep it that way
when you touch the Settings tab or the Help text.

```yaml
version: 1

troop:
  name: "Example Troop"

parameters:
  activitySince: 2023-09-01
  pastEventsShown: 8
  monthsShown: 12
  fiscalYearStart: 9
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

budgets:
  "2023":
    Program Revenue: 32000.00
    Program Expenses: 26000.00

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

- **Fund list.** A fund added in TWH arrives in the next export with a guessed
  category and a row in the import review. Confirm it there; the guess reads the
  name and the fund's net, and it will sometimes be wrong.
- **Troop account list.** Same, for `accountClass` — guessed `cash` unless the
  name says inventory or card. This one is worth checking every time: the
  difference between `cash` and `liability` is the sign of the balance.
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
  The tabs show and hide panels in place; they add no hash, no query string, and
  no history entry.
- **One place to clear it all.** The **Cache** tab explains what is held in the
  browser and clears configuration, snapshots and the offline shell in one press
  — the thing to do on a shared computer.
- **Print is an allow-list.** A new report section is hidden until named in the
  `@media print` rules, so a schema change can't start printing unreviewed columns.
- Names hashed at parse; originals discarded immediately.

All of that is on the **Cache** tab. **Clear everything in this browser** does the
lot — configuration, snapshots, and the offline shell — and the granular buttons
below it are still there: **Purge offline app cache** clears the shell cache and
unregisters the service worker, **Reset settings to shipped defaults** resets
config while keeping snapshots, **Clear snapshots** drops the published figures.
Nothing on that tab can be undone, and the settings file is the only backup.

## Layout

```
index.html            markup and controls (Import/Reports/Settings/Cache/Help panels)
app.css               screen + print styles (one report per sheet)
manifest.webmanifest  PWA manifest
sw.js                 app-shell service worker
_config.yml           Pages build: keeps repo-only files unpublished
CNAME                 custom domain for the published site
js/csv.js             RFC 4180 parser, MD5
js/config.js          fund map, account classification, parameters, guesses
js/ledger.js          hashing, canonical leg ledger, validation, import review
js/reports.js         the three reports
js/snapshots.js       snapshot round-trip, drift, formatting
js/render.js          DOM rendering
js/install.js         PWA install + service worker lifecycle
js/yaml.js            small strict YAML subset (parser + emitter)
js/settings.js        the settings file: config + snapshots, one document
js/main.js            wiring, including the tab strip
js/package.json       marks js/ as ES modules so Node can import it
defaults.txt          starting settings file (generated)
tools/                regenerate the two committed generated files
test/reconcile.test.mjs      invariants + golden values
test/fixtures/generate.mjs   synthetic export generator (seeded)
test/fixtures/sample-export.csv    the fixture — synthetic, safe to commit
test/fixtures/sample-settings.txt  settings to pair with it (generated)
```
