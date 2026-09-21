import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldcrest-config-'));
const configFile = path.join(tempDir, 'system-config.json');

process.env.GOLDCREST_CONFIG_DIR = tempDir;
process.env.GOLDCREST_CONFIG_FILE = configFile;

// Legacy/stale account-selection data must not become the authoritative
// cTrader account after a restart.
fs.writeFileSync(configFile, JSON.stringify({
  selectedCtraderAccountId: '48728776',
  selectedCtraderAccountCurrency: 'USD',
  selectedCtraderAccountLabel: 'Stale Account',
  maxTradeValueForexUsd: 777,
  maxTradeValueIndianInr: 55555
}, null, 2));

const {
  getSystemConfig,
  updateSystemConfig,
  loadPersistedSystemConfig,
  getPersistedSystemConfigOverrides
} = await import('../src/services/configService');

try {
  const initial = loadPersistedSystemConfig();
  assert.equal(initial.tradingMode, 'LIVE_ONLY');
  assert.equal(initial.selectedCtraderAccountId, undefined);

  updateSystemConfig({
    maxTradeValueForexUsd: 777,
    maxTradeValueIndianInr: 55555,
    autoLiveForexPairs: ['EUR/USD', 'USD/JPY', 'XAU/USD'],
    autoLiveIndianUnderlyings: ['FINNIFTY', 'MIDCPNIFTY']
  });

  assert.equal(getSystemConfig().maxTradeValueForexUsd, 777);
  assert.equal(getSystemConfig().maxTradeValueIndianInr, 55555);
  assert.deepEqual(getSystemConfig().autoLiveForexPairs, ['EUR/USD', 'USD/JPY', 'XAU/USD']);
  assert.deepEqual(getSystemConfig().autoLiveIndianUnderlyings, ['FINNIFTY', 'MIDCPNIFTY']);
  assert.deepEqual(getPersistedSystemConfigOverrides().maxTradeValueForexUsd, 777);
  assert.deepEqual(getPersistedSystemConfigOverrides().maxTradeValueIndianInr, 55555);

  assert.equal(fs.existsSync(configFile), true);
  const persisted = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(persisted.maxTradeValueForexUsd, 777);
  assert.equal(persisted.maxTradeValueIndianInr, 55555);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'selectedCtraderAccountId'), false);
  assert.deepEqual(persisted.autoLiveForexPairs, ['EUR/USD', 'USD/JPY', 'XAU/USD']);
  assert.deepEqual(persisted.autoLiveIndianUnderlyings, ['FINNIFTY', 'MIDCPNIFTY']);

  console.log('CONFIG PERSISTENCE TEST PASSED');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
