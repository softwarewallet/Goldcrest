import assert from 'node:assert/strict';
import { generateCurrentPairPredictions } from '../src/services/pairPredictionService';
import { ScannerService } from '../src/services/scannerService';

const scanner = new ScannerService();
const serviceModule = await import('../src/services/pairPredictionService') as any;
void serviceModule;

const original = ScannerService.prototype.getForexScanner;
ScannerService.prototype.getForexScanner = async function () {
  return [{
    symbol: 'EUR/USD',
    bid: 1.1001,
    ask: 1.1003,
    spreadPips: 2,
    dataStatus: 'LIVE',
    signal: {
      id: 'pair-pred-test-1',
      timestamp: Date.now(),
      direction: 'BUY',
      score: 84,
      mlProbability: 0.82,
      strategy: 'TEST_STRATEGY',
      scoreBreakdown: { trend: 12 },
      entryZone: { preferred: 1.1002 },
      stopLoss: 1.0982,
      target1: 1.1042,
      riskReward: 2
    }
  }] as any;
};

try {
  const predictions = await generateCurrentPairPredictions({
    pairs: ['EUR/USD'],
    horizon: '1D',
    model: 'BASELINE'
  });
  assert.equal(predictions.length, 1);
  assert.equal(predictions[0].symbol, 'EUR/USD');
  assert.equal(predictions[0].predictedDirection, 'UP');
  assert.equal(predictions[0].modelVersion, 'SIGNAL_DIRECTION_BASELINE_V1');
  assert.equal(predictions[0].signalDirection, 'BUY');
  assert.equal(predictions[0].signalScore, 84);
  assert.equal(predictions[0].dataStatus, 'LIVE');
  assert.equal(predictions[0].bid, 1.1001);
  assert.equal(predictions[0].ask, 1.1003);
  assert.equal(predictions[0].mlProbability, 0.82);
  assert.ok(predictions[0].generatedAt > 0);
} finally {
  ScannerService.prototype.getForexScanner = original;
}

console.log('CURRENT PAIR PREDICTION TEST PASSED');
