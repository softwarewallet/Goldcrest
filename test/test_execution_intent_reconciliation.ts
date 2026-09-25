import assert from 'node:assert/strict';
import {
  claimExecutionIntent,
  completeExecutionIntent,
  failExecutionIntent,
  getExecutionIntent,
  markExecutionIntentSubmissionAmbiguous,
  resumeExecutionIntentReconciliation
} from '../src/services/executionIntentService';

const key = 'test-reconciliation-' + Date.now();
const payload = {
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  orderType: 'MARKET',
  quantity: 1000,
  price: 1.123,
  stopLoss: 1.120,
  takeProfit: 1.129,
  signalId: key
};

const first = await claimExecutionIntent(key, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload
});
assert.equal(first.claimed, true);
assert.equal(first.existing?.state, 'PENDING');

const duplicate = await claimExecutionIntent(key, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload
});
assert.equal(duplicate.claimed, false);
assert.equal(duplicate.existing?.state, 'PENDING');

await markExecutionIntentSubmissionAmbiguous(key, {
  message: 'network timeout after broker submission'
});
let intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'RECONCILIATION_TIMEOUT');
assert.equal((intent?.result as any)?.code, 'BROKER_SUBMISSION_AMBIGUOUS');

const duplicateDuringReconciliation = await claimExecutionIntent(key, {
  broker: 'CTRADER',
  market: 'FOREX',
  symbol: 'EUR/USD',
  side: 'BUY',
  payload
});
assert.equal(duplicateDuringReconciliation.claimed, false);
assert.equal(duplicateDuringReconciliation.existing?.state, 'RECONCILIATION_TIMEOUT');

await resumeExecutionIntentReconciliation(key);
intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'IN_FLIGHT');

await completeExecutionIntent(key, {
  status: 'FILLED',
  id: 'broker-order-reconciled'
});
intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'COMPLETED');

await failExecutionIntent(key, {
  status: 'REJECTED'
});
intent = await getExecutionIntent(key);
assert.equal(intent?.state, 'COMPLETED');

console.log('EXECUTION INTENT RECONCILIATION TESTS PASSED');
