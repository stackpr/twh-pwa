// generate.mjs — build the synthetic TWH export used by the test suite.
//
//   node test/fixtures/generate.mjs > test/fixtures/sample-export.csv
//
// EVERYTHING IN THE OUTPUT IS INVENTED: the troop, its scouts, its events,
// amounts, dates, accounts, funds and whole financial history. No real troop's
// data belongs in this repo. The TroopWebHost *transaction type* names are the
// one thing taken from the product itself, because they are the schema the code
// is written against; they describe no troop and no person.
//
// The generator is seeded, so the fixture is reproducible byte for byte. If you
// change anything here, regenerate the fixture AND re-derive the expected values
// pinned in test/reconcile.test.mjs — do not adjust one without the other.
//
// The invented troop deliberately exercises every edge case a real export can
// contain: an opening-balance import booked through a fund account, single-leg
// adjustment entries, five underscore-prefixed troop-held accounts, scouts in
// arrears, a credit-card account carrying a balance, inventory as a non-cash
// asset, future-dated event pre-charges, more past program events than fit on a
// page, fundraising events that must stay out of the event columns, an event
// carrying both a debit and a credit event reference, and one event whose name
// is missing its (MM/DD/YY) suffix.

/* ---- seeded PRNG (mulberry32) ---- */
let seed = 0x5eed1616;
function rnd() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const money = (lo, hi, step = 0.5) => Math.round(between(lo, hi) / step) * step;

/* ---- invented people ---- */
const SURNAMES = [
  'Ashcombe', 'Bellweather', 'Calloway', 'Denwood', 'Everly', 'Fairbourne', 'Glassmoor',
  'Hartigan', 'Ibsen', 'Jarrow', 'Kestrel', 'Lindquist', 'Marchetti', 'Norcross',
  'Oyelaran', 'Pemberton', 'Quintero', 'Ravenhill', 'Stoddard', 'Thackeray',
  'Underhill', 'Vandermeer', 'Whitlock', 'Yarborough', 'Zeller', 'Brannigan',
  'Corrigan', 'Delacroix', 'Ellsworth', 'Fontaine',
];
const GIVEN = [
  'Amara', 'Bennett', 'Callum', 'Dashiell', 'Elowen', 'Finnegan', 'Greta', 'Hollis',
  'Imogen', 'Jasper', 'Keziah', 'Linus', 'Marisol', 'Nikolai', 'Odalys', 'Percival',
  'Quill', 'Rosalind', 'Soren', 'Tamsin', 'Ulises', 'Verity', 'Wendell', 'Xiomara',
  'Yusuf', 'Zephyr', 'Auberon', 'Clementine', 'Dorian', 'Eulalie',
];
const NICKS = { Dashiell: 'Dash', Percival: 'Percy', Rosalind: 'Roz', Wendell: 'Del', Clementine: 'Clem' };

const SCOUTS = [];
{
  const used = new Set();
  for (let i = 0; i < 38; i++) {
    let s, g, key;
    do { s = pick(SURNAMES); g = pick(GIVEN); key = s + '|' + g; } while (used.has(key));
    used.add(key);
    // Quoted nicknames exercise the CSV parser's embedded-quote handling.
    SCOUTS.push(NICKS[g] ? `${s}, ${g} "${NICKS[g]}" (Main)` : `${s}, ${g} (Main)`);
  }
}

// A handful of families who consistently pay late. They are the arrears tail.
const SLOW_PAYERS = new Set(SCOUTS.slice(31, 37));

const PSEUDO = [
  '_UNIT, Campership (Main)',
  '_UNIT, High Adventure (Main)',
  '_UNIT, Custom Order (Main)',
  '_CREW, Venture Crew (Main)',
  '_UNIT, Wanderoak 2026 (Main)',
];

/* ---- invented chart of accounts (no personal data, no real troop) ---- */
const ACCOUNTS = ['Checking', 'CD', 'Council Account', 'Product Sale Cash', 'Venmo', 'PayPal', 'Trailer Fund'];
// Weighted so most family payments land in Checking, as they do in practice.
const PAY_ACCOUNTS = ['Checking', 'Checking', 'Checking', 'Checking', 'Venmo', 'PayPal'];
const INVENTORY = 'Merchandise Inventory';
const CARD = 'Credit Card';
const IMPORTED = 'Imported History';

const F = {
  reg: 'Registration Revenue',
  regSC: 'Registration (Summer Camp) Revenue',
  regHA: 'Registration (High Adventure) Revenue',
  merch: 'Merch Revenue',
  misc: 'Misc Revenue',
  campSC: 'Camping (Summer Camp) Expense',
  campHA: 'Camping (High Adventure) Expense',
  campWk: 'Camping (Weekend) Expense',
  transport: 'Transportation Expense',
  advance: 'Advancement Expense',
  equip: 'Equipment/Merch Expense',
  miscProg: 'Misc Program Expense',
  hosted: 'Troop-Hosted Event Expense',
  food: 'Food Expense',
  coh: 'COH Expense',
  troopFunded: 'Troop-Funded Program Expense',
  crewUsed: 'Crew Funds Utilized',
  crewExp: 'Crew Expense',
  donation: 'General Donation',
  campershipDon: 'Campership Donation',
  popcornRev: 'Popcorn Revenue',
  saleRev: 'Product Sale Revenue',
  concRev: 'Concessions Fundraising (from Venue)',
  popcornExp: 'Popcorn Expense',
  saleExp: 'Product Sale Expense',
  concExp: 'Concessions Fundraising (to Scout)',
  interest: 'Interest and Dividends',
  admin: 'Administrative Expenses',
  campershipExp: 'Campership Expense',
  donByTroop: 'Donations by Troop',
  training: 'Adult Training Expense',
  memberFee: 'Member Fees (Passthru)',
  custom: 'Custom Order (Passthru)',
};

/* ---- invented events (fictional troop year Sep 2023 – Aug 2024) ---- */
const PROGRAM_EVENTS = [
  { n: 'Ironwood Fall Camporee (09/29/23)',            d: '09/29/2023', fee: 22,  kind: 'weekend' },
  { n: 'Hollow Creek Troop Campout (10/20/23)',        d: '10/20/2023', fee: 18,  kind: 'weekend' },
  { n: 'Lantern Hill Lock-in: Adult RSVP (12/01/23)',  d: '12/01/2023', fee: 0,   kind: 'weekend', small: true },
  { n: 'Blackpine Winter Trek (12/27/23)',             d: '12/27/2023', fee: 145, kind: 'ha' },
  { n: 'Klondike - Curse of the Frozen Compass (01/26/24)', d: '01/26/2024', fee: 26, kind: 'weekend' },
  { n: 'Whitetail Ridge Ski Trip (02/16/24)',          d: '02/16/2024', fee: 96,  kind: 'weekend' },
  { n: 'Copper Bluff Troop Campout (03/15/24)',        d: '03/15/2024', fee: 17,  kind: 'weekend' },
  { n: 'Spring Camporee at Fort Vance (04/12/24)',     d: '04/12/2024', fee: 24,  kind: 'weekend' },
  { n: 'Marlowe Museum & Zoo Campout (05/17/24)',      d: '05/17/2024', fee: 31,  kind: 'weekend' },
  { n: 'Camp Wanderoak Summer Camp (06/16/24)',        d: '06/16/2024', fee: 315, kind: 'sc' },
  { n: 'Northern Waters Canoe Trek (07/07/24)',        d: '07/07/2024', fee: 410, kind: 'ha' },
  // future relative to the pinned as-of date of 2024-08-03
  { n: 'Cedar Gap Biking Campout (08/16/24)',          d: '08/16/2024', fee: 19,  kind: 'weekend', future: true },
  { n: '"Try Backpacking" Troop Campout (09/27/24)',   d: '09/27/2024', fee: 17,  kind: 'weekend', future: true },
  { n: 'Coral Key Scuba Adventure (03/05/25)',         d: '03/05/2025', fee: 620, kind: 'ha', future: true },
];
const FUNDRAISER_EVENTS = [
  { n: 'Concessions Stand - Homecoming Game (10/07/23)', d: '10/07/2023' },
  { n: 'Concessions Stand - Spring Classic (04/20/24)', d: '04/20/2024' },
  { n: 'Concessions Stand - Riverfest (06/22/24)',      d: '06/22/2024' },
  { n: 'Summer Product Sale 2024 (07/04/24)',            d: '07/04/2024' },
];
// Deliberately missing its (MM/DD/YY) suffix, to prove the guardrail fires.
const UNDATED_EVENT = 'Council Merit Badge Midway';

const EXPENSE_FUND = { weekend: F.campWk, sc: F.campSC, ha: F.campHA };
const REVENUE_FUND = { weekend: F.reg, sc: F.regSC, ha: F.regHA };

/* ---- row construction ---- */
const HEADERS = [
  'Transaction Type', 'Date', 'Deposit Date', 'Description', 'Ref', 'Amount',
  'Debit Troop Account', 'Credit Troop Account', 'Debit Person', 'Credit Person',
  'Debit Event', 'Credit Event', 'For Event', 'Debit Fund', 'Credit Fund',
  'Fiscal Year', 'Budget Item Type', 'Budget', 'Group Transaction', 'Group',
  'Reconcile Debit', 'Reconcile Credit', 'Added By User',
];
const KEY = {
  type: 'Transaction Type', date: 'Date', desc: 'Description', amt: 'Amount', ref: 'Ref',
  dta: 'Debit Troop Account', cta: 'Credit Troop Account',
  dp: 'Debit Person', cp: 'Credit Person',
  de: 'Debit Event', ce: 'Credit Event',
  df: 'Debit Fund', cf: 'Credit Fund',
  fy: 'Fiscal Year', grp: 'Group Transaction',
  rd: 'Reconcile Debit', rc: 'Reconcile Credit', user: 'Added By User',
};

const rows = [];
const fy = d => {
  const [m, , y] = d.split('/').map(Number);
  return String(m >= 9 ? y + 1 : y);
};
function add(o) {
  const r = {};
  for (const h of HEADERS) r[h] = '';
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) r[KEY[k] || k] = v;
  r['Amount'] = Number(o.amt).toFixed(2);
  r['Fiscal Year'] = o.fy || fy(o.date);
  r['Group Transaction'] = o.grp || 'N';
  r['Added By User'] = o.user || 'TREASURER1';
  rows.push(r);
}

/* ---- 1. opening balance import (invented, dated well before the report) ---- */
const OPEN = '12/31/2018';
add({ type: 'Deposit To Troop Account', date: OPEN, desc: 'Opening balance import',
      amt: 41285.44, cta: 'Checking', cf: F.admin, fy: 'Opening',
      rc: 'Imported History (12/31/2018)' });
add({ type: 'Deposit To Troop Account', date: OPEN, desc: 'Opening balance import',
      amt: 12000.00, cta: 'CD', cf: F.admin, fy: 'Opening',
      rc: 'Imported History (12/31/2018)' });
add({ type: 'Deposit To Troop Account', date: OPEN, desc: 'Opening inventory',
      amt: 3910.00, cta: INVENTORY, cf: F.admin, fy: 'Opening',
      rc: 'Imported History (12/31/2018)' });
add({ type: 'Transfer Between Troop Accounts', date: OPEN, desc: 'Import clearing',
      amt: 0.00, dta: IMPORTED, cta: IMPORTED, fy: 'Opening',
      rd: 'Imported History (12/31/2018)', rc: 'Imported History (12/31/2018)' });
// Single-leg opening balances for scout accounts.
for (let i = 0; i < 14; i++) {
  add({ type: '*Add to Scout Account', date: OPEN, desc: 'Opening scout balance',
        amt: money(40, 300), cp: SCOUTS[i], fy: 'Opening' });
}
for (let i = 0; i < 6; i++) {
  add({ type: 'Popcorn to Scout Account', date: OPEN, desc: 'Opening popcorn credit',
        amt: money(20, 180), cp: SCOUTS[i + 4], fy: 'Opening' });
}
// Seed the troop-held accounts.
add({ type: '*Add to Scout Account', date: OPEN, desc: 'Opening campership fund', amt: 1450.00, cp: PSEUDO[0], fy: 'Opening' });
add({ type: '*Add to Scout Account', date: OPEN, desc: 'Opening high adventure fund', amt: 2200.00, cp: PSEUDO[1], fy: 'Opening' });
add({ type: '*Add to Scout Account', date: OPEN, desc: 'Opening custom-order fund', amt: 410.00, cp: PSEUDO[2], fy: 'Opening' });

/* ---- 2. program events ---- */
let ref = 1000;
for (const ev of PROGRAM_EVENTS) {
  const n = ev.small ? 4 : Math.round(between(11, 26));
  const attendees = shuffled(SCOUTS).slice(0, n);
  for (const s of attendees) {
    if (ev.fee > 0) {
      // Most families pay ahead of the charge; a few lag, which is what puts a
      // handful of accounts into arrears without making the troop look insolvent.
      if (!SLOW_PAYERS.has(s) && rnd() < 0.94) {
        add({ type: 'Deposit to Scout Account', date: shiftDays(ev.d, -Math.round(between(4, 30))),
              desc: `Payment - ${ev.n}`, ref: ref++,
              amt: Math.ceil(ev.fee * between(0.94, 1.06) / 5) * 5,
              cta: pick(PAY_ACCOUNTS), cp: s });
      }
      add({ type: 'Charge Scout an Event Fee', date: ev.d, desc: `${ev.n} - Scout Participant`,
            ref: ref++, amt: ev.fee, dp: s, cf: REVENUE_FUND[ev.kind], ce: ev.n });
    }
  }
  // Troop-paid costs, dated a few days before the event.
  const pre = shiftDays(ev.d, -Math.round(between(2, 12)));
  add({ type: 'Expense (Event) paid by Troop', date: pre, desc: `${ev.n} - site fee`,
        ref: ref++, amt: money(ev.fee * n * 0.45, ev.fee * n * 0.7),
        dta: 'Checking', df: EXPENSE_FUND[ev.kind], de: ev.n });
  if (!ev.small) {
    add({ type: 'Grubmaster', date: pre, desc: `${ev.n} - patrol grub`,
          ref: ref++, amt: money(38, 165), cp: pick(attendees), df: F.food, de: ev.n });
    add({ type: 'Reimburse Expense (Event) to Scout Account', date: shiftDays(ev.d, 3),
          desc: `${ev.n} - fuel`, ref: ref++, amt: money(22, 88),
          cp: pick(attendees), df: F.transport, de: ev.n });
  }
  if (ev.kind !== 'weekend') {
    add({ type: 'Expense (Event) paid by Troop', date: pre, desc: `${ev.n} - deposit`,
          ref: ref++, amt: money(300, 1400), dta: 'Checking', df: EXPENSE_FUND[ev.kind], de: ev.n });
  }
}

// The one type that carries both a debit and a credit event reference.
{
  const ev = PROGRAM_EVENTS[5];
  for (let i = 0; i < 3; i++) {
    add({ type: 'Expense (External Event) paid by Troop from Scout Account',
          date: ev.d, desc: `${ev.n} - lift ticket`, ref: ref++, amt: money(40, 72),
          dta: 'Checking', dp: pick(SCOUTS), df: EXPENSE_FUND[ev.kind], cf: REVENUE_FUND[ev.kind],
          de: ev.n, ce: ev.n });
  }
}

// Event with no parseable date — the reconciliation panel must warn about this.
add({ type: 'Charge Scout a Non-Event Fee', date: '02/03/2024', desc: UNDATED_EVENT,
      ref: ref++, amt: 15.00, dp: pick(SCOUTS), cf: F.reg, ce: UNDATED_EVENT });
add({ type: 'Expense (Non-Event) paid by Troop', date: '02/03/2024', desc: UNDATED_EVENT,
      ref: ref++, amt: 45.00, dta: 'Checking', df: F.advance, de: UNDATED_EVENT });

/* ---- 3. fundraising events ---- */
for (const ev of FUNDRAISER_EVENTS) {
  const isProductSale = ev.n.startsWith('Summer Product Sale');
  const crew = shuffled(SCOUTS).slice(0, Math.round(between(8, 18)));
  if (isProductSale) {
    add({ type: 'Deposit To Troop Account', date: ev.d, desc: `${ev.n} - stand receipts`,
          ref: ref++, amt: 18430.00, cta: 'Product Sale Cash', cf: F.saleRev, ce: ev.n });
    add({ type: 'Expense (Event) paid by Troop', date: shiftDays(ev.d, -21),
          desc: `${ev.n} - inventory purchase`, ref: ref++, amt: 13905.50,
          dta: 'Checking', df: F.saleExp, de: ev.n });
    add({ type: 'Transfer Between Troop Accounts', date: shiftDays(ev.d, -21),
          desc: 'Purchased inventory into stock', ref: ref++, amt: 13905.50,
          dta: 'Checking', cta: INVENTORY });
    add({ type: 'Transfer Between Troop Accounts', date: shiftDays(ev.d, 2),
          desc: 'Inventory sold at stand', ref: ref++, amt: 12890.00,
          dta: INVENTORY, cta: 'Checking' });
  } else {
    const gross = money(2400, 5200);
    add({ type: 'Deposit To Troop Account', date: shiftDays(ev.d, 26), desc: `${ev.n} - venue payment`,
          ref: ref++, amt: gross, cta: 'Checking', cf: F.concRev, ce: ev.n });
    let paid = 0;
    for (const s of crew) {
      const share = money(gross / crew.length * 0.7, gross / crew.length * 0.95);
      paid += share;
      add({ type: 'Individual Fundraising (Event)', date: shiftDays(ev.d, 27),
            desc: `${ev.n} - scout share`, ref: ref++, amt: share,
            cp: s, df: F.concExp, de: ev.n });
    }
  }
}

/* ---- 4. recurring non-event activity ---- */
const MONTHS = [
  '09/2023', '10/2023', '11/2023', '12/2023', '01/2024', '02/2024',
  '03/2024', '04/2024', '05/2024', '06/2024', '07/2024', '08/2024',
];
for (const m of MONTHS) {
  const [mm, yyyy] = m.split('/');
  const d = day => `${mm}/${String(day).padStart(2, '0')}/${yyyy}`;

  add({ type: 'Other Income', date: d(1), desc: 'Interest', ref: ref++,
        amt: money(1.2, 14), cta: 'CD', cf: F.interest });
  add({ type: 'Expense (Non-Event) paid by Troop', date: d(7), desc: 'Advancement supplies',
        ref: ref++, amt: money(35, 260), dta: 'Checking', df: F.advance });
  add({ type: 'Expense (Non-Event) paid by Troop', date: d(12), desc: 'Troop admin',
        ref: ref++, amt: money(12, 95), dta: 'Checking', df: F.admin });
  // Sweep the payment apps into Checking, as the treasurer does each month.
  add({ type: 'Transfer Between Troop Accounts', date: d(26), desc: 'Venmo sweep',
        ref: ref++, amt: money(180, 620), dta: 'Venmo', cta: 'Checking' });
  add({ type: 'Transfer Between Troop Accounts', date: d(27), desc: 'PayPal sweep',
        ref: ref++, amt: money(180, 620), dta: 'PayPal', cta: 'Checking' });

  // Deposits into scout accounts.
  for (const s of shuffled(SCOUTS).slice(0, Math.round(between(2, 5)))) {
    add({ type: 'Deposit to Scout Account', date: d(Math.round(between(3, 27))),
          desc: 'Family payment', ref: ref++, amt: money(20, 120),
          cta: pick(PAY_ACCOUNTS), cp: s });
  }

  if (mm === '10' || mm === '03') {
    add({ type: 'Expense (Non-Event) paid by Troop', date: d(18), desc: 'Court of Honor',
          ref: ref++, amt: money(60, 210), dta: 'Checking', df: F.coh });
  }
  if (mm === '11') {
    for (const s of shuffled(SCOUTS).slice(0, 9)) {
      add({ type: 'Membership/Recharter from Scout Account', date: d(15), desc: 'Recharter',
            ref: ref++, amt: 85.00, dta: 'Checking', dp: s, df: F.memberFee, cf: F.memberFee });
    }
  }
  if (mm === '01') {
    add({ type: 'Expense (Non-Event) paid by Troop', date: d(22), desc: 'Adult leader training',
          ref: ref++, amt: 175.00, dta: 'Checking', df: F.training });
  }
  if (mm === '05') {
    for (let i = 0; i < 4; i++) {
      add({ type: 'Charge Scout a Non-Event Fee', date: d(9), desc: 'Custom order item',
            ref: ref++, amt: 55.00, dp: pick(SCOUTS), cf: F.custom });
    }
    add({ type: 'Expense (Non-Event) paid by Troop', date: d(20), desc: 'Custom order placed',
          ref: ref++, amt: 220.00, dta: 'Checking', df: F.custom });
  }
}

// Popcorn: a genuine pass-through, revenue and expense should broadly cancel.
add({ type: 'Deposit To Troop Account', date: '11/18/2023', desc: 'Popcorn commission',
      ref: ref++, amt: 1985.00, cta: 'Checking', cf: F.popcornRev });
for (const s of shuffled(SCOUTS).slice(0, 11)) {
  add({ type: 'Popcorn to Scout Account', date: '11/22/2023', desc: 'Popcorn share',
        ref: ref++, amt: money(45, 260), cp: s, df: F.popcornExp });
}

// Donations, camperships, and the troop-held accounts in motion.
for (let i = 0; i < 9; i++) {
  add({ type: 'Donation', date: `0${(i % 8) + 1}/${10 + i}/2024`.replace(/^0(\d\d)/, '$1'),
        desc: 'Family donation', ref: ref++, amt: money(25, 400),
        dp: pick(SCOUTS), cp: PSEUDO[0], cf: F.campershipDon });
}
for (let i = 0; i < 7; i++) {
  add({ type: 'Campership', date: `0${(i % 6) + 2}/14/2024`.replace(/^0(\d\d)/, '$1'),
        desc: 'Campership award', ref: ref++, amt: money(60, 300),
        dp: PSEUDO[0], cp: pick(SCOUTS), df: F.campershipExp });
}
add({ type: 'Deposit To Troop Account', date: '03/04/2024', desc: 'General donation',
      ref: ref++, amt: 1200.00, cta: 'Checking', cf: F.donation });
add({ type: 'Expense (Non-Event) paid by Troop', date: '04/09/2024', desc: 'Council FOS gift',
      ref: ref++, amt: 350.00, dta: 'Checking', df: F.donByTroop });

// Venture Crew, small and slightly negative — a shape worth covering.
add({ type: 'Reimburse Expense (Non-Event) to Scout Account', date: '12/28/2023',
      desc: 'Crew reservation fee', ref: ref++, amt: 148.00,
      cp: pick(SCOUTS), df: F.crewExp });
add({ type: 'Charge Scout a Non-Event Fee', date: '12/28/2023', desc: 'Crew activity',
      ref: ref++, amt: 148.00, dp: PSEUDO[3], cf: F.crewUsed });
add({ type: 'Charge Scout a Non-Event Fee', date: '01/09/2024', desc: 'Crew shortfall',
      ref: ref++, amt: 9.25, dp: PSEUDO[3], cf: F.misc });

// High adventure savings.
for (let i = 0; i < 5; i++) {
  add({ type: 'Transfer Between Scout Accounts', date: `0${i + 2}/21/2024`.replace(/^0(\d\d)/, '$1'),
        desc: 'High adventure savings', ref: ref++, amt: money(50, 250),
        dp: pick(SCOUTS), cp: PSEUDO[1] });
}
// Troop-held fund for a future trek, netting to zero.
add({ type: 'Transfer Between Scout Accounts', date: '06/01/2024', desc: 'Wanderoak trek deposit',
      ref: ref++, amt: 900.00, dp: pick(SCOUTS), cp: PSEUDO[4] });
add({ type: 'Transfer Between Scout Accounts', date: '07/12/2024', desc: 'Wanderoak trek release',
      ref: ref++, amt: 900.00, dp: PSEUDO[4], cp: pick(SCOUTS) });

// Merchandise, refunds, cash handling, inter-fund and inter-account movement.
for (let i = 0; i < 6; i++) {
  add({ type: 'Charge Scout a Non-Event Fee', date: `0${(i % 9) + 1}/06/2024`.replace(/^0(\d\d)/, '$1'),
        desc: 'Troop t-shirt', ref: ref++, amt: 16.00, dp: pick(SCOUTS), cf: F.merch });
}
add({ type: 'Expense (Non-Event) paid by Troop', date: '09/14/2023', desc: 'T-shirt order',
      ref: ref++, amt: 384.00, dta: 'Checking', df: F.equip });
add({ type: 'Refund Fee (Non-Event) to Scout Account', date: '05/02/2024', desc: 'Shirt refund',
      ref: ref++, amt: 16.00, cp: pick(SCOUTS), df: F.merch });
add({ type: 'Return money to Scout from Scout Account', date: '07/30/2024', desc: 'Eagle-out refund',
      ref: ref++, amt: 212.50, dta: 'Checking', dp: pick(SCOUTS) });
add({ type: 'Cash given to Scoutmaster', date: '06/10/2024', desc: 'Trip petty cash',
      ref: ref++, amt: 120.00, dp: pick(SCOUTS), cp: pick(SCOUTS) });
add({ type: 'Transfer Between Funds', date: '04/30/2024', desc: 'Reclassify equipment purchase',
      ref: ref++, amt: 96.00, df: F.miscProg, cf: F.equip });
add({ type: 'Transfer Between Troop Accounts', date: '10/02/2023', desc: 'Council account funding',
      ref: ref++, amt: 4200.00, dta: 'Checking', cta: 'Council Account' });
add({ type: 'Transfer Between Troop Accounts', date: '02/01/2024', desc: 'Council account top-up',
      ref: ref++, amt: 900.00, dta: 'Checking', cta: 'Council Account' });
add({ type: 'Transfer Between Troop Accounts', date: '06/03/2024', desc: 'Summer camp payment',
      ref: ref++, amt: 2600.00, dta: 'Council Account', cta: 'Checking' });
add({ type: 'Other Income to Scout Account', date: '05/28/2024', desc: 'Scout rebate',
      ref: ref++, amt: 40.00, cta: 'Checking', cp: pick(SCOUTS), cf: F.misc });
add({ type: 'Expense (Non-Event) paid by Troop', date: '08/01/2024', desc: 'Troop-funded new-scout kit',
      ref: ref++, amt: 268.00, dta: 'Checking', df: F.troopFunded });
add({ type: 'Expense (Non-Event) paid by Troop', date: '10/28/2023', desc: 'Haunted trail supplies',
      ref: ref++, amt: 315.00, dta: 'Checking', df: F.hosted });

// Credit card carrying a balance, so the liability line is not always zero.
add({ type: 'Expense (Non-Event) paid by Troop', date: '07/26/2024', desc: 'Camp gear on card',
      ref: ref++, amt: 642.75, dta: CARD, df: F.equip });
add({ type: 'Reimburse Expense (Event) to Scout as Payment', date: '07/22/2024',
      desc: 'Trek shuttle reimbursement', ref: ref++, amt: 310.00,
      dta: 'Checking', dp: pick(SCOUTS), cp: pick(SCOUTS), df: F.transport,
      de: PROGRAM_EVENTS[10].n });
add({ type: 'Reimburse Expense (Non-Event) to Scout as Payment', date: '03/28/2024',
      desc: 'Advancement reimbursement', ref: ref++, amt: 128.40,
      dta: 'Checking', dp: pick(SCOUTS), cp: pick(SCOUTS), df: F.advance });
add({ type: 'Expense (Non-Event) paid by Troop from Scout Account', date: '01/17/2024',
      desc: 'Merit badge fee', ref: ref++, amt: 30.00,
      dta: 'Checking', dp: pick(SCOUTS), df: F.advance });
add({ type: 'Expense (Event) paid by Troop from Scout Account', date: '06/18/2024',
      desc: 'Camp trading post advance', ref: ref++, amt: 55.00,
      dta: 'Checking', dp: pick(SCOUTS), df: F.campSC, de: PROGRAM_EVENTS[9].n });

// Push a handful of scouts into arrears.
for (const s of SLOW_PAYERS) {
  if (rnd() < 0.5) continue;
  add({ type: 'Deposit to Scout Account', date: '07/25/2024', desc: 'Catch-up payment',
        ref: ref++, amt: money(60, 260), cta: 'Checking', cp: s });
}

/* ---- emit ---- */
rows.sort((a, b) => toISO(a.Date) - toISO(b.Date));
const esc = v => (/[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const out = [HEADERS.join(','), ...rows.map(r => HEADERS.map(h => esc(r[h] ?? '')).join(','))];
process.stdout.write(out.join('\r\n') + '\r\n');

/* ---- helpers ---- */
function shuffled(a) { const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; }
function toISO(d) { const [m, dd, y] = d.split('/').map(Number); return new Date(y, m - 1, dd).getTime(); }
function shiftDays(d, n) {
  const [m, dd, y] = d.split('/').map(Number);
  const t = new Date(y, m - 1, dd + n);
  const p = x => String(x).padStart(2, '0');
  return `${p(t.getMonth() + 1)}/${p(t.getDate())}/${t.getFullYear()}`;
}
