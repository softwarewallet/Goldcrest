import assert from 'node:assert/strict';
import {
  SignalDirectionBaselineModel, createResearchPrediction, type PredictionModel
} from '../src/services/liveTradeResearchPredictionService';
import type { ResearchFeatureRow } from '../src/services/liveTradeResearchFeatureService';

function row(direction: string, score: number): ResearchFeatureRow {
  return {
    signalId: 'signal-test-001', symbol: 'EUR/USD', signalTimestamp: 1700000000000,
    direction, score, marketRegime: 'TRENDING', session: 'LONDON',
    trendDirection: 'BULLISH', trendAlignment: 'ALIGNED',
    trend7dReturnPct: 1, trend30dReturnPct: 2, trend90dReturnPct: 3, trend365dReturnPct: 5,
    trend7dVolatilityPct: 8, trend30dVolatilityPct: 9, trend90dVolatilityPct: 10, trend365dVolatilityPct: 12,
    newsRiskLevel: 'LOW', newsHighImpactCount: 0, newsActiveHighImpactCount: 0, newsSentiment: 0.2,
    quoteSpread: 0.0001, riskReward: 2, stopDistance: 0.001, targetDistance: 0.002,
    realizedPnl: 10, outcome: 'WIN', holdingDurationMs: 3600000
  };
}
const model = new SignalDirectionBaselineModel();
const buy = model.predict(row('BUY', 78), '1D');
assert.equal(buy.direction, 'UP'); assert.ok(buy.confidence > 0.7 && buy.confidence < 1); assert.equal(buy.modelAgreement, 1);
const sell = model.predict(row('SELL', 60), '3D');
assert.equal(sell.direction, 'DOWN'); assert.equal(sell.confidence, 0.6);
const flat = model.predict(row('UNKNOWN', 90), '7D');
assert.equal(flat.direction, 'FLAT'); assert.equal(flat.confidence, 0.5);
const prediction = await createResearchPrediction({ row: row('BUY', 80), horizon: '1D', model });
assert.equal(prediction.predictedDirection, 'UP'); assert.equal(prediction.modelVersion, 'SIGNAL_DIRECTION_BASELINE_V1');
assert.equal(prediction.predictionSource, 'LIVE_SIGNAL_DIRECTION'); assert.equal(prediction.symbol, 'EUR/USD');
assert.equal(prediction.signalId, 'signal-test-001'); assert.match(prediction.featureHash, /^[a-f0-9]{64}$/);
assert.match(prediction.predictionId, /^pred-.*-signal-test-001-1D$/); assert.equal(prediction.horizon, '1D');
assert.ok(prediction.confidence >= 0 && prediction.confidence <= 1);
const customModel: PredictionModel = {
  modelVersion: 'TEST_MODEL_V1', predictionSource: 'DETERMINISTIC_TEST',
  predict: () => ({ direction: 'DOWN', confidence: 0.87, modelAgreement: 0.5, reasoning: 'Test prediction', invalidation: 'Test invalidation' })
};
const custom = await createResearchPrediction({ row: row('BUY', 80), horizon: '7D', model: customModel });
assert.equal(custom.modelVersion, 'TEST_MODEL_V1'); assert.equal(custom.predictedDirection, 'DOWN');
assert.equal(custom.confidence, 0.87); assert.equal(custom.modelAgreement, 0.5); assert.equal(custom.reasoning, 'Test prediction');
console.log('Live trade research prediction tests passed.');
