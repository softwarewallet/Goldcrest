import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldcrest-sizing-'));
process.env.GOLDCREST_CONFIG_DIR = configDir;
process.env.GOLDCREST_CONFIG_FILE = path.join(configDir, 'system-config.json');

const { updateSystemConfig } = await import('../src/services/configService');
const { sizeForexOrderToMaxTradeValue } = await import('../src/brokers/safety/TradeSizing');

const instrument = {
  symbol: 'GBP/USD',
  market: 'FOREX',
  pipSize: 0.0001,
  minQuantity: 1000,
  maxQuantity: 10_000_000,
  stepQuantity: 1000,
  digits: 5,
  supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP'] as const,
  baseCurrency: 'GBP',
  quoteCurrency: 'USD'
};

const adapter: any = {
  getAccountCurrencyConversionRate: async () => 1
};

updateSystemConfig({
  maxTradeValueForexUsd: 10_000
});

const capped = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  10_000
);

assert.equal(capped.quantity, 7_000);
assert.equal(capped.adjusted, true);
assert.ok(capped.estimatedTradeValueUsd <= 10_000);
assert.equal(Number(capped.estimatedTradeValueUsd.toFixed(2)), 9_364.95);

updateSystemConfig({
  maxTradeValueForexUsd: 20_000
});

const uncapped = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  10_000
);

assert.equal(uncapped.quantity, 10_000);
assert.equal(uncapped.adjusted, false);
assert.equal(Number(uncapped.estimatedTradeValueUsd.toFixed(2)), 13_378.50);

updateSystemConfig({
  maxTradeValueForexUsd: 100
});

await assert.rejects(
  () => sizeForexOrderToMaxTradeValue(adapter, 'GBP/USD', 1.33785, instrument, 10_000),
  /MAX_TRADE_VALUE_BELOW_BROKER_MINIMUM/
);

console.log('Trade sizing tests passed.');
