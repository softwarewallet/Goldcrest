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
  supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP'],
  baseCurrency: 'GBP',
  quoteCurrency: 'USD'
};

const adapter: any = {
  getAccountCurrencyConversionRate: async () => 1
};

updateSystemConfig({
  maxTradeValueForexUsd: 10_000
});

const forcedFromOne = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  1
);

assert.equal(forcedFromOne.quantity, 7_000);
assert.equal(forcedFromOne.adjusted, true);
assert.equal(Number(forcedFromOne.rawMaxQuantity.toFixed(2)), 7474.68);
assert.ok(forcedFromOne.estimatedTradeValueUsd <= 10_000);
assert.equal(Number(forcedFromOne.estimatedTradeValueUsd.toFixed(2)), 9_364.95);

updateSystemConfig({
  maxTradeValueForexUsd: 20_000
});

const forcedFromLargeRequest = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  10_000
);

// The caller's requested 10,000 units cannot limit the forced maximum-value
// calculation; the configured $20,000 cap sizes the order to 14,000 units.
assert.equal(forcedFromLargeRequest.quantity, 14_000);
assert.equal(forcedFromLargeRequest.adjusted, true);
assert.equal(Number(forcedFromLargeRequest.estimatedTradeValueUsd.toFixed(2)), 18_729.90);

updateSystemConfig({
  maxTradeValueForexUsd: 100
});

const belowBrokerMinimum = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  instrument,
  1
);

// A configured $100 cap produces a positive value-derived quantity even though
// this fixture advertises a broker minimum of 1,000 units. The local sizing
// layer must not reject or round the order up; cTrader receives the calculated
// volume and is responsible for accepting or rejecting broker-side constraints.
assert.equal(Number(belowBrokerMinimum.quantity.toFixed(6)), Number((100 / 1.33785).toFixed(6)));
assert.ok(belowBrokerMinimum.quantity < instrument.minQuantity);
assert.equal(Number(belowBrokerMinimum.estimatedTradeValueUsd.toFixed(2)), 100);

console.log('Trade sizing tests passed.');
