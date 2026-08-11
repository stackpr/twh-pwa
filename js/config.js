// config.js — fund map, account classification, report parameters.
// Persisted to localStorage. NEVER stores transaction data.

const LS_KEY = 'troopfin.config.v1';

// EXAMPLE CHART OF ACCOUNTS.
//
// These are defaults, not a schema. Every troop's TroopWebHost fund list is
// different. Replace this map with your own — either by editing this file, or
// at runtime through Settings → Load settings file, which is the intended route
// and requires no code change. The category names on the right ARE fixed: they
// drive the income-statement sections, which figures net together, and the
// program/fundraising split for event columns. See CATEGORY_ORDER.
export const FUND_CATEGORIES = {
  'Registration Revenue':                  'Program Revenue',
  'Registration (Summer Camp) Revenue':    'Program Revenue',
  'Registration (High Adventure) Revenue': 'Program Revenue',
  'Merch Revenue':                         'Program Revenue',
  'Misc Revenue':                          'Program Revenue',
  'Camping (Summer Camp) Expense':         'Program Expenses',
  'Camping (High Adventure) Expense':      'Program Expenses',
  'Camping (Weekend) Expense':             'Program Expenses',
  'Transportation Expense':                'Program Expenses',
  'Advancement Expense':                   'Program Expenses',
  'Equipment/Merch Expense':               'Program Expenses',
  'Misc Program Expense':                  'Program Expenses',
  'Troop-Hosted Event Expense':            'Program Expenses',
  'Food Expense':                          'Program Expenses',
  'COH Expense':                           'Program Expenses',
  'Troop-Funded Program Expense':          'Program Expenses',
  'Crew Revenue (from Scout)':             'Program Revenue',
  'Crew Funds Utilized':                   'Program Revenue',
  'Crew Expense':                          'Scout Program Expenses',
  'General Donation':                      'Unit Fundraising Revenue',
  'Campership Donation':                   'Unit Fundraising Revenue',
  // Proceeds credited to the participating scout's account rather than kept by
  // the unit: revenue in, the same amount straight back out, netting near zero.
  'Popcorn Revenue':                       'Scout Fundraising Revenue',
  'Product Sale Revenue':                  'Scout Fundraising Revenue',
  'Concessions Fundraising (from Venue)':  'Scout Fundraising Revenue',
  'Popcorn Expense':                       'Scout Fundraising Expenses',
  'Product Sale Expense':                  'Scout Fundraising Expenses',
  'Concessions Fundraising (to Scout)':    'Scout Fundraising Expenses',
  'Interest and Dividends':                'Other Income',
  'Administrative Expenses':               'Other Expenses',
  'Campership Expense':                    'Other Expenses',
  'Donations by Troop':                    'Other Expenses',
  'Adult Training Expense':                'Other Expenses',
  'Member Fees (Passthru)':                'Other Expenses',
  'Custom Order (Passthru)':              'Other Expenses',
};

// Presentation order and sign for income-statement sections.
//
// isRevenue drives whether the displayed figure is the raw signed leg total
// (credit-positive) or negated so expenses print positive.
//
// `group` is what nets: every category in a group becomes one Net Income line,
// and it is also what decides whether an event is a program event or a
// fundraiser. It is a field rather than a prefix on the name because the two
// used to be the same thing and quietly stopped being — a category called
// "Scout Fundraising Revenue" does not begin with "Fundraising", and matching on
// that would have dropped it out of the net silently.
//
// Two groups carry more than one category, and both exist so a treasurer can see
// a figure against its own budget without moving it out of the total it belongs
// in:
//
//   program           Scout Program Expenses is spending the scouts themselves
//                     direct. It is budgeted and reported separately, and still
//                     nets into Net Income — Scouting Program.
//   scoutFundraising  fundraising whose proceeds pass through to scout accounts.
//                     It usually nets to about nothing, which is the point of
//                     keeping it away from the unit's own fundraising.
export const HIDDEN_CATEGORY = 'Hide from Reports';

export const CATEGORY_ORDER = [
  { key: 'Program Revenue',            isRevenue: true,  group: 'program' },
  { key: 'Program Expenses',           isRevenue: false, group: 'program' },
  { key: 'Scout Program Expenses',     isRevenue: false, group: 'program' },
  { key: 'Unit Fundraising Revenue',   isRevenue: true,  group: 'unitFundraising' },
  { key: 'Unit Fundraising Expenses',  isRevenue: false, group: 'unitFundraising' },
  { key: 'Scout Fundraising Revenue',  isRevenue: true,  group: 'scoutFundraising' },
  { key: 'Scout Fundraising Expenses', isRevenue: false, group: 'scoutFundraising' },
  { key: 'Other Income',               isRevenue: true,  group: 'other' },
  { key: 'Other Expenses',             isRevenue: false, group: 'other' },
  { key: HIDDEN_CATEGORY,              isRevenue: false, group: 'hidden' },
];

// The one category whose name is its whole specification: a fund filed here is
// left out of the income statements. Its group belongs to no net line, so it
// nets into nothing, and REPORTED_CATEGORIES is what the statements iterate.
//
// It exists because TroopWebHost carries funds that are not income in any
// period sense — a transfer between the troop's own pots, a pass-through that
// books in and straight back out, an artefact of how a unit was migrated. Left
// in, each one inflates both a revenue and an expense line by the same amount
// and makes every section total answer a question nobody asked.
//
// Two things it deliberately does NOT do:
//
//  - It does not touch the balance sheet. Money the troop holds is money the
//    troop holds; a fund's reporting category cannot make a liability cease to
//    exist. Deferred revenue on a future event still counts under Other Future
//    Events (Net) whatever category its fund is in.
//  - It does not go unsaid. A hidden fund with activity in the period is named
//    on each statement that left it out. Dropping a fund silently is the exact
//    failure this app exists to prevent; dropping one because the treasurer
//    said to, and saying so, is a different act.
/** The categories the income statements have sections for — everything but the hidden one. */
export const REPORTED_CATEGORIES = CATEGORY_ORDER.filter(c => c.key !== HIDDEN_CATEGORY);

/** The set of fund names a chart says to leave out of the income statements. */
export const hiddenFundSet = cfg =>
  new Set(Object.keys(cfg.fundCategories || {}).filter(f => cfg.fundCategories[f] === HIDDEN_CATEGORY));

/** The categories that net into one Net Income line, in presentation order. */
export const categoriesInGroup = group =>
  CATEGORY_ORDER.filter(c => c.group === group).map(c => c.key);

/** Net Income lines, in the order they print. */
export const NET_LINES = [
  { group: 'program',          label: 'Scouting Program' },
  { group: 'unitFundraising',  label: 'Unit Fundraising' },
  { group: 'scoutFundraising', label: 'Scout Fundraising' },
  { group: 'other',            label: 'Other' },
];

// Categories this app used to have, and where a fund carrying one now belongs.
// A settings file written before the split still loads: the fund is moved and
// the move is REPORTED, never silently applied — see settings.js and main.js.
// Unit fundraising is the destination because that is what the single
// "Fundraising" pair meant before scout-level fundraising had anywhere else to
// go; a troop that passes proceeds to scouts moves those funds across once, on
// the Settings tab.
export const RENAMED_CATEGORIES = {
  'Fundraising Revenue':  'Unit Fundraising Revenue',
  'Fundraising Expenses': 'Unit Fundraising Expenses',
  // A crew pair shipped briefly and was withdrawn: a sub-unit's own programme
  // turned out to be one chart of accounts too many, and what treasurers
  // actually needed was a way to leave a fund out altogether. Both destinations
  // are inside the program group the Crew pair was in, so a chart written under
  // those two versions comes back with every net line where it was.
  'Crew Program Revenue':  'Program Revenue',
  'Crew Program Expenses': 'Scout Program Expenses',
};

/**
 * Rewrite any renamed category in a fund map, reporting what moved.
 *
 * Returns the new map plus a list of `{ fund, from, to }`. Nothing is dropped:
 * a category this app has never heard of is left exactly as it is, so the
 * validation in ledger.js can name it rather than this function guessing.
 */
export function migrateCategories(fundCategories) {
  const out = {}, moved = [];
  for (const [fund, cat] of Object.entries(fundCategories || {})) {
    const to = RENAMED_CATEGORIES[cat];
    if (to) { out[fund] = to; moved.push({ fund, from: cat, to }); }
    else out[fund] = cat;
  }
  return { fundCategories: out, moved };
}

// EXAMPLE ACCOUNT CLASSIFICATION. Same as above: defaults, replace with your own.
// Troop account -> balance sheet placement.
//   cash      : current asset, counts toward Total Assets
//   noncash   : counts toward Total Assets, but deducted from unrestricted net
//               assets because it cannot be spent (e.g. inventory)
//   liability : displayed under Liabilities, sign inverted
// Any account appearing in the export but missing here HALTS the load — see
// ledger.js.
export const DEFAULT_ACCOUNT_CLASS = {
  'Checking':                'cash',
  'CD':                      'cash',
  'Council Account':         'cash',
  'Product Sale Cash':          'cash',
  'Venmo':                   'cash',
  'PayPal':                  'cash',
  'High Adventure Checking': 'cash',
  'Trailer Fund':                 'cash',
  'Imported History':        'cash',
  'Merchandise Inventory':     'noncash',
  'Credit Card':             'liability',
};

export const CATEGORY_NAMES = CATEGORY_ORDER.map(c => c.key);

export const DEFAULT_PARAMS = {
  troopName: '',               // optional label printed above each report
  // Drives the prior-period split and which events get columns. A fixed date
  // rather than a rolling window, and deliberately an early one: a default that
  // sits after a troop's transactions produces an inverted period and an
  // all-dash statement on a first run. Every treasurer sets this to their own
  // reporting start; the shipped value only has to be harmless before they do.
  activitySince: '2020-01-01',
  // A reserve the troop has decided not to treat as spendable. Reported as a
  // liability so it comes off Available Unit Funds, which is a deliberate
  // departure from standard accounting — a self-imposed reserve is not an
  // obligation to anyone — and the reason that line is not called Unrestricted
  // Net Assets. Zero means no reserve is held back and the line is not printed.
  emergencyFund: 0,
  pastEventsShown: 8,          // most recent N past program events, for one-page fit
  // Soonest N future events. Like pastEventsShown this is page fit and nothing
  // more: the Future column is every event still to come whether or not it got
  // a column, so trimming columns never moves money into Other.
  futureEventsShown: 4,
  monthsShown: 12,             // rolling window for Monthly Income
  // Month the fiscal year starts, 1-12. Defaults to January: most troops run a
  // calendar year, and a budget needs a period to be a budget for. null is
  // still available and gives back the rolling monthsShown window.
  fiscalYearStart: 1,
  asOf: null,                  // null = min(latest txn date, today)
  // Earliest fiscal year the year-on-year comparison will show, or null for
  // every year in the export. A troop's first years in TroopWebHost are usually
  // a partial migration — opening balances booked in a lump, a season entered
  // by hand — and a column of those beside real years invites a comparison
  // nobody should make. Naming the first trustworthy year is a judgement only
  // the treasurer can make, so the app asks rather than guessing.
  earliestFiscalYear: null,
  // Cents on the reports, or whole dollars. Rounding is display only: every
  // figure is computed to the cent either way, so turning it off and on again
  // changes nothing but the printing.
  showCents: true,
  hashSalt: '',                // empty = plain MD5 (reproducible outside the app)
};

const DEFAULTS = {
  fundCategories: FUND_CATEGORIES,
  accountClass: DEFAULT_ACCOUNT_CLASS,
  params: DEFAULT_PARAMS,
  // Fiscal-year budgets, keyed by the calendar year the fiscal year starts in:
  //   { '2024': { 'Program Revenue': 30000, 'Merch Revenue': 500 } }
  // A key is either a fund or one of the six categories — see budgetFor().
  budgets: {},
};

/* ------------------------------------------------------------------ */
/* Fiscal year                                                         */
/*                                                                     */
/* A troop's year rarely matches the calendar's; scouting years usually */
/* start with the school year. A fiscal year is identified throughout   */
/* by the CALENDAR YEAR IT STARTS IN, so the year beginning September   */
/* 2024 and ending August 2025 is 2024, whatever it is called on paper. */
/* ------------------------------------------------------------------ */

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** The fiscal year a date falls in, or null when no fiscal year is configured. */
export function fiscalYearOf(date, startMonth) {
  if (!startMonth) return null;
  return date.getMonth() + 1 >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
}

/** First day of a fiscal year. */
export const fiscalYearStartDate = (year, startMonth) => new Date(year, startMonth - 1, 1);

/**
 * "FY 2024–25", or "FY 2024" for a fiscal year that is also a calendar year.
 * The label is worth getting right: a budget compared against the wrong year is
 * the kind of error that survives a whole season unnoticed.
 */
export function fiscalYearLabel(year, startMonth) {
  if (!startMonth || startMonth === 1) return `FY ${year}`;
  return `FY ${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

/**
 * The budget for one fund: its own figure if it has one, otherwise nothing.
 * A category figure is deliberately NOT spread across its funds — it is the
 * budget for whatever in that category was not budgeted individually, and it
 * belongs on the section subtotal, not on a row. See sectionBudget().
 */
export const budgetFor = (budget, name) =>
  (budget && Number.isFinite(budget[name]) ? budget[name] : null);

/** Fiscal years in which this fund or category carries a budget figure. */
export const budgetYearsFor = (budgets, name) =>
  Object.keys(budgets || {})
    .filter(y => Number.isFinite((budgets[y] || {})[name]))
    .sort();

/**
 * Move one budget line onto another, year by year.
 *
 * Used when a fund leaves the chart of accounts. Its budget is not discarded and
 * not left orphaned: it is added to whichever line the treasurer nominates, in
 * each year it exists, so every yearly total is exactly what it was before. A
 * budget is only in this app — nothing else holds a copy to restore it from.
 */
export function mergeBudgetLine(budgets, from, into) {
  // Moving a line onto itself is nothing happening, not a line being consumed.
  if (from === into) return { ...(budgets || {}) };
  const out = {};
  for (const [year, row] of Object.entries(budgets || {})) {
    const copy = { ...row };
    if (Number.isFinite(copy[from])) {
      const moved = copy[from];
      delete copy[from];
      copy[into] = (Number.isFinite(copy[into]) ? copy[into] : 0) + moved;
    }
    if (Object.keys(copy).length) out[year] = copy;
  }
  return out;
}

/**
 * A section's budget: every fund figure inside it, plus the category figure
 * covering the rest. Either alone is normal — budget each fund, or budget the
 * category as a lump — and mixing the two means "these funds, plus this much
 * for everything else in the category".
 */
export function sectionBudget(budget, category, fundNames) {
  if (!budget) return null;
  const parts = fundNames.map(f => budgetFor(budget, f)).filter(v => v !== null);
  const cat = budgetFor(budget, category);
  if (cat === null && !parts.length) return null;
  return (cat || 0) + parts.reduce((s, v) => s + v, 0);
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    // A saved chart of accounts is authoritative, not a patch over the shipped
    // example. Merging the example back in would undo a removal — the entry
    // reappears on the next visit — and would leave a troop that adopted their
    // own chart carrying example funds they never had. Parameters do merge:
    // those are named settings, and a release that adds one needs its default.
    // A chart saved before a category was renamed is migrated on the way out of
    // storage, so the reports never meet a category no section claims — that
    // fund's legs would simply stop appearing, which is the silent
    // under-reporting this app exists to prevent. main.js reports what moved.
    const savedFunds = saved.fundCategories
      ? migrateCategories(saved.fundCategories).fundCategories
      : structuredClone(FUND_CATEGORIES);
    return {
      fundCategories: savedFunds,
      accountClass:   saved.accountClass   ? { ...saved.accountClass }   : structuredClone(DEFAULT_ACCOUNT_CLASS),
      params:         { ...DEFAULT_PARAMS, ...(saved.params || {}) },
      budgets:        saved.budgets ? { ...saved.budgets } : {},
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
}

export function clearConfig() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

/** Values a settings file is allowed to set. See js/settings.js. */
export const ACCOUNT_CLASSES = ['cash', 'noncash', 'liability'];

/* ------------------------------------------------------------------ */
/* Guessing a classification for a name the settings have never seen.  */
/*                                                                     */
/* Used at import: a fund or account that appears in the export but not */
/* in the chart of accounts is added with the guess below, so a new     */
/* fund costs a treasurer a glance rather than a hand-edited settings   */
/* file. A guess is a starting point and is presented as one — the      */
/* import review names every guessed entry and asks for confirmation.   */
/* Nothing here may be used to classify silently.                       */
/* ------------------------------------------------------------------ */

// Word lists, not troop lists. Every term is generic to Scouting or to
// bookkeeping; none of them identifies a unit. TroopWebHost fund names are
// free text, so these will miss — that is why the guess is reviewed.
const EXPENSE_WORDS = /\b(expense|expenses|cost|costs|purchase|purchases|paid|payable|reimburse\w*|refund\w*)\b/i;
// "Donation" is deliberately absent here. It says which section a fund belongs
// to, not which side of it: a donation received and a donation made by the troop
// share the word and point opposite ways. Words like it are left to the sign,
// which knows. A wrong section is a tidiness problem; a wrong side prints
// revenue as a negative number.
const REVENUE_WORDS = /\b(revenue|revenues|income|proceeds|sales|sale|dues|fee|fees|deposit|deposits|collected|received)\b/i;
const FUNDRAISING_WORDS = /\b(fundrais\w*|donation|donations|sponsor\w*|popcorn|wreath\w*|product sale|concession\w*|raffle|auction|car wash|bake sale|camp ?card|coupon|scouting for food)\b/i;
const OTHER_WORDS = /\b(admin\w*|interest|dividend|dividends|bank|service charge|insurance|charter|recharter|adult training|passthru|pass-through|scholarship)\b/i;
// Marks a fundraiser whose proceeds land in the seller's account rather than the
// unit's. TroopWebHost fund names are free text, so this will miss; the guess is
// reviewed on the Import tab either way.
const SCOUT_SHARE_WORDS = /\b(to scout|to scouts|scout share|scout portion|scout credit|scout account|individual)\b/i;

/**
 * Guess a fund's category from its name and its net in the export.
 *
 * The name decides the section (program / fundraising / other). For the
 * revenue-or-expense half, an explicit word in the name wins — a fund called
 * "… Expense" is an expense even in a month when refunds made it net positive.
 * With no such word the sign decides, credit-positive meaning revenue, which is
 * the strongest evidence available and better than any default.
 */
export function guessFundCategory(name, net = 0) {
  const n = String(name || '');
  const isExpense = EXPENSE_WORDS.test(n) ? true
    : REVENUE_WORDS.test(n) ? false
    : net < 0;

  if (OTHER_WORDS.test(n)) return isExpense ? 'Other Expenses' : 'Other Income';
  if (FUNDRAISING_WORDS.test(n)) {
    // Unit or scout fundraising. Only the name can tell them apart, and it
    // usually does: a fund whose proceeds go to the seller is named for it
    // ("… (to Scout)", "Scout Popcorn"). Unit is the fallback because a
    // fundraiser is the unit's until someone says otherwise, and the guess is
    // shown for confirmation either way.
    const toScout = SCOUT_SHARE_WORDS.test(n);
    if (toScout) return isExpense ? 'Scout Fundraising Expenses' : 'Scout Fundraising Revenue';
    return isExpense ? 'Unit Fundraising Expenses' : 'Unit Fundraising Revenue';
  }
  // Scout Program Expenses is never guessed. It says who decides what a fund is
  // spent on — a fact about how a troop runs, not about a fund's name — and
  // inventing it would put spending under a budget line nobody set. Neither is
  // Hide from Reports, for a stronger reason: guessing that would delete a fund
  // from the statements on the strength of its name. A treasurer moves a fund
  // into either one deliberately, on the Settings tab.
  return isExpense ? 'Program Expenses' : 'Program Revenue';
}

/**
 * Guess a troop account's balance-sheet class from its name.
 *
 * Defaults to `cash`, because most troop accounts are bank accounts. The two
 * exceptions are recognisable by name and expensive to get wrong: inventory
 * counts toward assets but cannot be spent, and a card balance is a liability
 * shown with the sign inverted.
 */
export function guessAccountClass(name) {
  const n = String(name || '');
  if (/\b(credit card|charge card|line of credit|loan|payable|liabilit\w*)\b/i.test(n)) return 'liability';
  if (/\b(inventory|merchandise|stock on hand)\b/i.test(n)) return 'noncash';
  return 'cash';
}
