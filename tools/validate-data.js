const TITLES = require('../data.js');
const { validateCatalog } = require('../lib/validate.js');

const errors = validateCatalog(TITLES);
if (errors.length) {
  console.error('data.js validation failed with ' + errors.length + ' error(s):');
  errors.forEach(function (e) { console.error(' - ' + e); });
  process.exit(1);
} else {
  console.log('OK: ' + TITLES.length + ' titles, no errors.');
  process.exit(0);
}
