import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldcrest-sizing-'));
process.env.GOLDCREST_CONFIG_DIR = configDir;
process.env.GOLDCREST_CONFIG_FILE = path.join(configDir, 'system-config.json');

const { updateSystemConfig } = await import('../src/services/configService');
const { normalizePriceToInstrumentDigits, sizeForexOrderToMaxTradeValue } = await import('../src/brokers/safety/TradeSizing');
process.env.LIVE_TRADING_ENABLED = 'true';
const { liveTradingGate } = await import('../src/brokers/safety/LiveTradingGate');

const instrument = {
  symbol: 'GBP/USD',
  market: 'FOREX',
  pipSize: 0.0001,
  // cTrader protocol minVolume/stepVolume = 1000 cents => 10.00 base units.
  // The normalized application representation is therefore 10-unit steps.
  minQuantity: 10,
  maxQuantity: 10_000_000,
  stepQuantity: 10,
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

assert.equal(forcedFromOne.quantity, 7_470);
assert.equal(forcedFromOne.adjusted, true);
assert.equal(Number(forcedFromOne.rawMaxQuantity.toFixed(2)), 7474.68);
assert.ok(forcedFromOne.estimatedTradeValueUsd <= 10_000);
assert.equal(Number(forcedFromOne.estimatedTradeValueUsd.toFixed(2)), 9_993.74);

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
// calculation; the configured $20,000 cap sizes the order to the nearest
// broker-valid 10-unit step below the cap.
assert.equal(forcedFromLargeRequest.quantity, 14_940);
assert.equal(forcedFromLargeRequest.adjusted, true);
assert.equal(Number(forcedFromLargeRequest.estimatedTradeValueUsd.toFixed(2)), 19_987.48);

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

// The configured $100 cap yields 70 base units after broker 10-unit step
// quantization and remains below the notional cap.
assert.equal(belowBrokerMinimum.quantity, 70);
assert.equal(Number(belowBrokerMinimum.estimatedTradeValueUsd.toFixed(2)), 93.65);

const fineGrainedInstrument = {
  ...instrument,
  minQuantity: 0.01,
  stepQuantity: 0.01
};

updateSystemConfig({
  maxTradeValueForexUsd: 10.22
});

const fractionalQuantity = await sizeForexOrderToMaxTradeValue(
  adapter,
  'GBP/USD',
  1.33785,
  fineGrainedInstrument,
  1
);

// cTrader protocol volume is in 0.01 base-currency units. The maximum-value
// calculation is quantized DOWN to the nearest 0.01 unit: 7.638... -> 7.63.
assert.equal(fractionalQuantity.quantity, 7.63);
assert.ok(Number.isFinite(fractionalQuantity.quantity));
assert.equal(Math.round(fractionalQuantity.quantity * 100) % 1, 0);
assert.ok(fractionalQuantity.estimatedTradeValueUsd <= 10.22 + 1e-8);

// Goldcrest-wide price precision policy: every symbol is normalized to three
// decimal places, regardless of broker-reported symbol precision.
assert.equal(normalizePriceToInstrumentDigits(157.71077, 3), 157.711);
assert.equal(normalizePriceToInstrumentDigits(157.7104, 3), 157.71);
assert.equal(normalizePriceToInstrumentDigits(1.123456, 5), 1.123);
assert.equal(normalizePriceToInstrumentDigits(1.1239, 5), 1.124);
assert.equal(normalizePriceToInstrumentDigits(210.70722, 3), 210.707);

console.log('Trade sizing tests passed.');

updateSystemConfig({
  maxTradeValueForexUsd: 200,
  maxTradeValueIndianInr: 1_000_000
});

const gateAdapter: any = {
  broker: 'CTRADER',
  environment: 'LIVE',
  isLive: true,
  getTradingStatus: async () => 'CONNECTED',
  getAccount: async () => ({
    accountId: 'test',
    accountType: 'LIVE',
    balance: 1000,
    equity: 1000,
    availableMargin: 1000,
    usedMargin: 0,
    freeMargin: 1000,
    currency: 'USD',
    broker: 'CTRADER',
    environment: 'LIVE',
    connectionStatus: 'CONNECTED',
    permissions: ['READ', 'TRADE', 'TRADING'],
    lastUpdate: Date.now()
  }),
  getInstrument: async () => instrument,
  getPositions: async () => [],
  getAccountCurrencyConversionRate: async () => 1
};

const boundaryQuote = {
  symbol: 'GBP/USD',
  bid: 1,
  ask: 1,
  spread: 0,
  timestamp: Date.now(),
  source: 'test',
  environment: 'LIVE',
  status: 'FRESH'
};

const exactBoundary = await liveTradingGate.evaluate(gateAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200,
    price: 1.0000000000000002,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 1000,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});

assert.equal(exactBoundary.checks.maxExposureNotExceeded, true);
assert.equal(exactBoundary.checks.maximumTradeValueCheckPassed, true);

const realExposureOverage = await liveTradingGate.evaluate(gateAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200,
    price: 1,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 1000.0001,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});

assert.equal(realExposureOverage.checks.maxExposureNotExceeded, false);
assert.ok(realExposureOverage.failedReasons.some(reason => reason.includes('Condition 12 Failed')));

const realTradeOverage = await liveTradingGate.evaluate(gateAdapter, {
  order: {
    market: 'FOREX',
    symbol: 'GBP/USD',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: 200.000001,
    price: 1,
    stopLoss: 0.99
  },
  signalAgeMs: 1000,
  currentQuote: boundaryQuote,
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 10,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});

assert.equal(realTradeOverage.checks.maximumTradeValueCheckPassed, false);
assert.ok(realTradeOverage.failedReasons.some(reason => reason.includes('Condition 16 Failed')));


// Live quote freshness regression: the gate must accept a 19.9s-old quote
// and reject a quote older than the fixed 20s policy. No caller override exists.
const quoteAt = Date.now() - 19_900;
const freshAt20s = await liveTradingGate.evaluate(gateAdapter, {
  order: { market: 'FOREX', symbol: 'GBP/USD', side: 'BUY', orderType: 'MARKET', quantity: 1, price: 1, stopLoss: 0.99 },
  signalAgeMs: 1000,
  currentQuote: { ...boundaryQuote, timestamp: quoteAt },
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 0,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});
assert.equal(freshAt20s.checks.marketDataFresh, true);

const staleAt20s = await liveTradingGate.evaluate(gateAdapter, {
  order: { market: 'FOREX', symbol: 'GBP/USD', side: 'BUY', orderType: 'MARKET', quantity: 1, price: 1, stopLoss: 0.99 },
  signalAgeMs: 1000,
  currentQuote: { ...boundaryQuote, timestamp: Date.now() - 20_100 },
  isMarketOpen: true,
  dailyRealizedLoss: 0,
  dailyLossLimit: 100,
  totalAccountExposure: 0,
  maxAllowedExposure: 1000,
  activePositionsCount: 0,
  maxOpenPositions: 5
});
assert.equal(staleAt20s.checks.marketDataFresh, false);
assert.ok(staleAt20s.failedReasons.some(reason => reason.includes('>20s old')));
