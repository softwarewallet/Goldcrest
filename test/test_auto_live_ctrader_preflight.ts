import assert from 'node:assert/strict';
import { validateAutoLiveCTraderConnection } from '../src/services/autoTradingService';

const demoSuccess = await validateAutoLiveCTraderConnection({
  testConnection: async () => ({
    broker: 'CTRADER',
    environment: 'LIVE',
    connected: true,
    apiMode: 'DEMO',
    apiEndpoint: 'wss://demo.ctraderapi.com:5036',
    account: '2001',
    accountType: 'LIVE',
    balance: 100000,
    equity: 100000,
    currency: 'USD',
    timestamp: Date.now(),
    latency: 12
  })
});

assert.equal(demoSuccess.ok, true);
assert.equal(demoSuccess.result.apiMode, 'DEMO');
assert.match(demoSuccess.message, /cTrader DEMO API connection preflight passed/);

const liveSuccess = await validateAutoLiveCTraderConnection({
  testConnection: async () => ({
    broker: 'CTRADER',
    environment: 'LIVE',
    connected: true,
    apiMode: 'LIVE',
    apiEndpoint: 'wss://live.ctraderapi.com:5036',
    account: '1001',
    accountType: 'LIVE',
    balance: 100000,
    equity: 100000,
    currency: 'USD',
    timestamp: Date.now(),
    latency: 10
  })
});

assert.equal(liveSuccess.ok, true);
assert.equal(liveSuccess.result.apiMode, 'LIVE');
assert.match(liveSuccess.message, /cTrader LIVE API connection preflight passed/);

const failure = await validateAutoLiveCTraderConnection({
  testConnection: async () => ({
    broker: 'CTRADER',
    environment: 'LIVE',
    connected: false,
    apiMode: 'DEMO',
    apiEndpoint: 'wss://demo.ctraderapi.com:5036',
    account: '****',
    accountType: 'LIVE',
    error: 'No cTrader accounts match the selected DEMO environment.',
    timestamp: Date.now(),
    latency: 25
  })
});

assert.equal(failure.ok, false);
assert.match(failure.message, /DEMO API connection preflight failed/);
assert.match(failure.message, /selected DEMO environment/);

console.log('AUTO LIVE cTrader connection preflight tests passed.');
