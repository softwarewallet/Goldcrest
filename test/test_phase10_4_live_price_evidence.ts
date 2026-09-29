import assert from 'node:assert/strict';
import { classifyEvidence, getDueEvidenceCheckpoints } from '../src/services/livePriceEvidenceService';

const due = getDueEvidenceCheckpoints(1_000, 20_000, 20_000 + 15 * 60_000 + 1);
assert.ok(due.some(item => item.checkpoint === 'SIGNAL_PLUS_5S'));
assert.ok(due.some(item => item.checkpoint === 'EXECUTION_PLUS_15M'));

const correct = classifyEvidence({
  direction: 'BUY', signalTimestamp: 1_000, executionTimestamp: 2_000,
  signalPrice: 1.1000, executionPrice: 1.1001, stopLoss: 1.0980, takeProfit: 1.1040,
  outcome: 'WIN',
  quoteEvidence: [{ checkpoint: 'EXECUTION_PLUS_30S', mid: 1.1010, observedAt: 32_000 }]
});
assert.equal(correct.classification, 'CORRECT_DIRECTION');

const wrong = classifyEvidence({
  direction: 'SELL', signalTimestamp: 1_000, executionTimestamp: 2_000,
  signalPrice: 1.1000, executionPrice: 1.1001, stopLoss: 1.1020, takeProfit: 1.0960,
  outcome: 'LOSS',
  quoteEvidence: [{ checkpoint: 'EXECUTION_PLUS_30S', mid: 1.1015, observedAt: 32_000 }]
});
assert.equal(wrong.classification, 'WRONG_DIRECTION');

const late = classifyEvidence({
  direction: 'BUY', signalTimestamp: 1_000, executionTimestamp: 40_000,
  signalPrice: 1.1000, executionPrice: 1.1002, stopLoss: 1.0980, takeProfit: 1.1040,
  outcome: 'LOSS',
  quoteEvidence: [{ checkpoint: 'EXECUTION_PLUS_30S', mid: 1.0990, observedAt: 70_000 }]
});
assert.equal(late.classification, 'EXECUTION_TOO_LATE');

console.log('PHASE 10.4 LIVE PRICE EVIDENCE TESTS PASSED');
