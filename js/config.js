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
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    return {
      fundCategories: { ...FUND_CATEGORIES, ...(saved.fundCategories || {}) },
      accountClass:   { ...DEFAULT_ACCOUNT_CLASS, ...(saved.accountClass || {}) },
      params:         { ...DEFAULT_PARAMS, ...(saved.params || {}) },
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
