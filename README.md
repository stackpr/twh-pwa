# Troop Finance Reports

Three printable reports from a TroopWebHost transaction export — **Balance
Sheet**, **Event Income**, **Monthly Income** — produced in your browser, in a
few seconds, with nothing to install.

It replaces the spreadsheet a troop treasurer usually inherits: pivot tables and
hand-maintained `SUMIF` columns that nobody but the last treasurer understands,
and that quietly stop counting a fund the month TroopWebHost gains one.

---

## Your data never leaves your computer

This is the point of the app, not a feature of it.

- **Nothing is uploaded.** The export is read directly from the file you pick.
  It never becomes a network request, and the app makes no network requests of
  any kind — no fonts, no analytics, no error reporting, no third-party code.
  After the first visit it works with the wifi off.
- **Nothing is stored.** Transactions live in memory while the tab is open and
  are gone when you close it. That is why you re-drop the export each month.
- **Scout names are discarded on the way in.** They are replaced with an
  anonymous identifier as the file is read, before anything else sees them. No
  name reaches a report, a printout, or the browser's storage.

  Honest limit: the identifier is a plain hash of the name. Someone who already
  has your troop roster could work backwards from it. It protects against
  casual disclosure, not against someone holding the roster. The **hash salt**
  setting changes the identifiers if you want that closed off.
- **The browser keeps two things**: your settings, and the balance-sheet
  snapshots you capture. Both are configuration and whole-troop totals. Never a
  transaction, never a scout's name, never a scout's balance.
- **On a shared computer**, the **Cache** tab explains exactly what is being
  held and clears all of it in one press.

**The transaction export itself is sensitive.** It contains scout names, family
payment histories and per-child arrears — financial records about minors. Keep
it as you would a bank statement, and don't email it around. The settings file
is the one thing here that is safe to hand on; see below.

---

## Getting started

Open the app and go to the **Settings** tab.

1. **Load a settings file.** The app ships with an example chart of accounts
   that will not match your troop. Download `defaults.txt` from this repository
   as a starting point, or just skip ahead — importing your export adds every
   fund and account it finds, each with a guessed classification for you to
   confirm.
2. **Import your export.** In TroopWebHost, choose **Export All Transactions to
   Excel** (it produces a CSV despite the name). Drop it on the **Import** tab.
3. **Work through the review**, if there is one. Anything new since last month
   is listed with the classification the app guessed and the evidence for the
   guess. Correct what is wrong — the reports update as you do.
4. **Read the reports**, then **Download settings file** from the Settings tab
   and keep it. That file is your configuration, your budget and your published
   figures. It is the only copy of some of that.

To see the whole thing working before touching real data, load
`test/fixtures/sample-settings.txt` and `test/fixtures/sample-export.csv` from
this repository. Both are entirely invented.

**Installing.** On Chrome, Edge or Android an *Install for offline use* button
appears once the browser offers it. On iPhone and iPad, use Share → *Add to Home
Screen*.

---

## The monthly routine

1. TroopWebHost → **Export All Transactions to Excel**.
2. Drop it on the **Import** tab.
3. Work through the import review if one appears.
4. Glance at **Reconciliation**. Account, fund and transaction-type counts should
   look like last month's. A jump in *single-leg entries* means somebody posted
   something unusual — worth a look before you publish.
5. Set **Past events shown** so Event Income fits your page.
6. Print each report. The buttons choose the paper for you, and Ctrl+P works from
   any tab — only the reports print.
7. Press **Capture snapshot at this date**, download the settings file, and keep
   it with the PDFs.

---

## What each report says

**Balance Sheet** — what the troop holds, what it owes, and what is genuinely
free to spend. Assets by account, then scout balances, then liabilities, ending
at **Unrestricted Net Assets**.

Two things surprise people, both deliberate:

- It reflects **every transaction**, not only those on or before the report
  date. TroopWebHost dates an event charge to the *event*, so a scout charged
  today for a September campout already owes it today. Filtering by date would
  understate what the troop owes.
- **Money for events that have not happened** is shown as a liability, on the
  *Other Future Events (Net)* line. It is collected, but it is not yours to
  spend.

**Event Income** — a column per event, so you can see which trips paid for
themselves. Covers activity since the date you set, with anything earlier on the
*Prior Period* line. **Past events shown** only controls how many columns print;
no total ever changes with it.

**Monthly Income** — revenue and spending by month across the fiscal year to
date, with the total first and the most recent month next to it. If you have
entered a budget, **Budget** and **Remaining** columns sit alongside.

### Snapshots and drift

Only the balance sheet is snapshotted. Press **Capture snapshot at this date**
and the figures you just published are frozen into the settings file, with each
account's balance beside the totals.

If a back-dated correction later changes what that date *would* now produce, the
app says so — it shows the drift instead of quietly rewriting history. The
income statements are period reports and are always recomputed; they are allowed
to move.

---

## Settings, in plain terms

Everything except the transactions lives in one plain text file —
`troop-settings.txt` — that opens in Notepad or TextEdit. It holds your troop
name, the report dates, your chart of accounts, your budget and your snapshots.

**It contains no scout names, no individual balances and no transactions.** It
does list your troop's own bank accounts and their balances by date, because a
balance sheet that can say *Total Assets moved* but not *which account moved*
answers half the question. Bear that in mind when you pass it on: you are
disclosing the troop's finances by institution, which is usually exactly what a
successor needs.

**Chart of accounts.** Every fund and troop account in your export must be
classified, or the reports refuse to run. That is on purpose — an unclassified
fund would otherwise be silently counted as nothing, which is how spreadsheets
go wrong. New names are added for you at import with a guess, and every guess is
listed for you to confirm.

**Troop accounts** are classified as `cash` (a bank account), `noncash`
(something owned but not spendable, like inventory) or `liability` (a credit
card). **Funds** map to one of six fixed categories: Program Revenue, Program
Expenses, Fundraising Revenue, Fundraising Expenses, Other Income, Other
Expenses.

**Fiscal year.** Set the month your year begins. Monthly Income then covers the
fiscal year to date, which is what makes its total comparable to an annual
budget. A year is named for the calendar year it starts in, so September 2024 to
August 2025 is `FY 2024–25`.

**Budget.** TroopWebHost has no idea budgets exist, so this file is the only
copy — treat losing it as losing the budget. Budget a whole category, or
individual funds, or both; a category figure covers whatever in it you did not
budget by fund. A blank is not a zero: zero says you planned to spend nothing,
a blank says you did not plan that line.

---

## Four things to get right in TroopWebHost

These are settings on the TroopWebHost side. Get them wrong and the reports are
wrong, and the app cannot tell.

- **Keep the `(MM/DD/YY)` on the end of event names.** TroopWebHost puts it
  there. It is the only thing that dates an event, and an event without one
  cannot be placed on the timeline — it falls into Other.
- **Keep the leading underscore on troop-held funds.** An account like
  `_TROOP, Campership` is money the troop is holding, not a scout. Drop the
  underscore and it is read as a scout: it lands in prepaid fees and can appear
  in the arrears count.
- **Check new troop accounts are classified right.** The app guesses `cash`
  unless the name mentions inventory or a card. The difference between `cash`
  and `liability` is the sign of the balance, so this is the guess worth
  checking every time.
- **Pick the right transaction type when posting.** The type decides which sides
  of the entry are filled in. A fee entered as a non-event fee will never show
  up in an event column, no matter what the reports do.

---

## Getting help

The **Help** tab inside the app is written for the volunteer who inherits this:
the monthly routine, what each report means, and why the figures are arranged
the way they are.

Contributor and maintenance documentation — architecture, invariants, testing
and deployment — lives in [`CLAUDE.md`](CLAUDE.md).
