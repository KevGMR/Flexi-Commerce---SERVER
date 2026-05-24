const recon = require('../controllers/Reconciliation');
const assert = require('assert');

function approxEqual(a, b) {
  return Math.abs(a - b) <= 1;
}

(function run() {
  console.log('Running reconciliation date-range smoke test...');
  const { start, end } = recon.toDateRange({ startDate: '2026-05-23', endDate: '2026-05-23' });
  const diff = end.getTime() - start.getTime();
  console.log('start:', start.toISOString());
  console.log('end:  ', end.toISOString());
  console.log('diff ms:', diff);

  // Expect one full day minus 1ms
  assert(approxEqual(diff, 86399999), `Expected 86399999 ms but got ${diff}`);

  console.log('✔ recon toDateRange smoke test passed');
})();
