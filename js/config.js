// config.js — fund map, account classification, report parameters.
// Persisted to localStorage. NEVER stores transaction data.

const LS_KEY = 'troopfin.config.v1';

// EXAMPLE CHART OF ACCOUNTS.
//
// These are defaults, not a schema. Every troop's TroopWebHost fund list is
// different. Replace this map with your own — either by editing this file, or
// at runtime through Settings → Load settings file, which is the intended route
// and requires no code change. The six category names on the right ARE
// fixed: they drive the income-statement sections and the program/fundraising
// split for event columns.
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
  'Crew Expense':                          'Program Expenses',
  'General Donation':                      'Fundraising Revenue',
  'Campership Donation':                   'Fundraising Revenue',
  'Popcorn Revenue':                       'Fundraising Revenue',
  'Product Sale Revenue':                     'Fundraising Revenue',
  'Concessions Fundraising (from Venue)':      'Fundraising Revenue',
  'Popcorn Expense':                       'Fundraising Expenses',
  'Product Sale Expense':                     'Fundraising Expenses',
  'Concessions Fundraising (to Scout)':      'Fundraising Expenses',
  'Interest and Dividends':                'Other Income',
  'Administrative Expenses':               'Other Expenses',
  'Campership Expense':                    'Other Expenses',
  'Donations by Troop':                    'Other Expenses',
  'Adult Training Expense':                'Other Expenses',
  'Member Fees (Passthru)':                'Other Expenses',
  'Custom Order (Passthru)':              'Other Expenses',
};

// Presentation order and sign for income-statement sections.
// isRevenue drives whether the displayed figure is the raw signed leg total
// (credit-positive) or negated so expenses print positive.
export const CATEGORY_ORDER = [
  { key: 'Program Revenue',      isRevenue: true  },
  { key: 'Program Expenses',     isRevenue: false },
  { key: 'Fundraising Revenue',  isRevenue: true  },
  { key: 'Fundraising Expenses', isRevenue: false },
  { key: 'Other Income',         isRevenue: true  },
  { key: 'Other Expenses',       isRevenue: false },
];

// EXAMPLE ACCOUNT CLASSIFICATION. Same as above: defaults, replace with your own.
// Troop account -> balance sheet placement.
//   cash      : current asset, counts toward Total Assets
//   noncash   : counts toward Total Assets, but deducted from unrestricted net
//               assets because it cannot be spent (e.g. inventory)
//   liability : displayed under Liabilities, sign inverted
// Seeded from the treatment implied by the legacy workbook. Any account
// appearing in the export but missing here HALTS the load — see ledger.js.
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
  activitySince: '2025-09-01', // drives prior-period split and per-event columns
  pastEventsShown: 8,          // most recent N past program events, for one-page fit
  monthsShown: 12,             // rolling window for Monthly Income
  // Month the fiscal year starts, 1-12. Defaults to January: most troops run a
  // calendar year, and a budget needs a period to be a budget for. null is
  // still available and gives back the rolling monthsShown window.
  fiscalYearStart: 1,
  asOf: null,                  // null = min(latest txn date, today)
  legacyMode: false,           // reproduce spreadsheet-era defects, for diffing
  // Under legacyMode, the troop-held accounts a predecessor spreadsheet deducted
  // by hand from prepaid fees. Any pseudo-account NOT listed here reproduces the
  // classic double-count. Empty means every pseudo-account is double-counted.
  legacyDeductedAccounts: [],
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
    return {
      fundCategories: saved.fundCategories ? { ...saved.fundCategories } : structuredClone(FUND_CATEGORIES),
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
  if (FUNDRAISING_WORDS.test(n)) return isExpense ? 'Fundraising Expenses' : 'Fundraising Revenue';
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
