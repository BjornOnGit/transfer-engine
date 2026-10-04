const { refreshRate, RATE_TTL_SECONDS } = require('../modules/fx/fx.service');

const PAIRS = ['NGN_CAD', 'CAD_NGN'];
// refresh at half the TTL so the key never expires between refreshes
const REFRESH_INTERVAL_MS = (RATE_TTL_SECONDS / 2) * 1000;

async function refreshAll() {
  for (const pair of PAIRS) {
    try {
      const rate = await refreshRate(pair);
      console.log(`[fx-refresh] ${pair} -> ${rate}`);
    } catch (err) {
      console.error(`[fx-refresh] failed for ${pair}:`, err.message);
    }
  }
}

function start() {
  refreshAll();
  return setInterval(refreshAll, REFRESH_INTERVAL_MS);
}

module.exports = { start, refreshAll };

if (require.main === module) start();