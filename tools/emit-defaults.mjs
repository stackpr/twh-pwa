// emit-defaults.mjs — regenerate defaults.txt from js/config.js.
//
//   node tools/emit-defaults.mjs > defaults.txt
//
// defaults.txt is the settings file a troop starts from: the example chart of
// accounts, ready to edit. It is generated rather than hand-maintained so it
// cannot drift from the shipped defaults; the test suite fails if it has.

import { FUND_CATEGORIES, DEFAULT_ACCOUNT_CLASS, DEFAULT_PARAMS } from '../js/config.js';
import { settingsToText } from '../js/settings.js';

process.stdout.write(settingsToText({
  fundCategories: FUND_CATEGORIES,
  accountClass: DEFAULT_ACCOUNT_CLASS,
  params: DEFAULT_PARAMS,
}, {}));
