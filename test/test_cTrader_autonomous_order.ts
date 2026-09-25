import assert from 'node:assert/strict';
import { CTraderBrokerAdapter } from '../src/brokers/adapters/cTrader/CTraderBrokerAdapter';

const prototype = CTraderBrokerAdapter.prototype as any;

let placeOrderCalls = 0;
const liveStub = {
  isLive: true,
  environment: 'LIVE',
  placeOrder: async (order: any) => {
    placeOrderCalls += 1;
    return { status: 'FILLED', id: 'stub-order', ...order };
  }
};

const order = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  orderType: 'MARKET',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.12,
  takeProfit: 1.13,
  signalId: 'test-live-autonomous-order',
  strategyId: 'fx_structure_v2a'
};

const result = await prototype.placeAutonomousOrder.call(liveStub, order);
assert.equal(placeOrderCalls, 1);
assert.equal(result.status, 'FILLED');
assert.equal(result.signalId, order.signalId);

const demoStub = {
  isLive: false,
  environment: 'DEMO',
  placeOrder: async () => {
    throw new Error('placeOrder must not be called for non-LIVE autonomous execution');
  }
};

await assert.rejects(
  prototype.placeAutonomousOrder.call(demoStub, order),
  /Autonomous execution is available only for cTrader LIVE/
);

console.log('CTRADER AUTONOMOUS ORDER CAPABILITY TEST PASSED');
