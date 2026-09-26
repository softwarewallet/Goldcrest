import assert from 'node:assert/strict';
import { executeRun } from '../src/database/db';
import { getCurrentPairPredictionModelComparison } from '../src/services/currentPairPredictionOutcomeService';

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const rows = [
  ['model-comparison-baseline-1', 'PAIR_FEATURE_BASELINE_V2', now - 10 * day, 'UP', 0.8, 'UP', 1.5],
  ['model-comparison-baseline-2', 'PAIR_FEATURE_BASELINE_V2', now - 11 * day, 'UP', 0.7, 'DOWN', -1.0],
  ['model-comparison-ai-1', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', now - 10 * day, 'DOWN', 0.9, 'DOWN', -1.5],
  ['model-comparison-ai-2', 'LLAMA_GATEWAY_QWEN_LLAMA_V1', now - 11 * day, 'UP', 0.6, 'DOWN', -0.5]
] as const;

try {
  for (const [id, model, predictedAt, predictedDirection, confidence, actualDirection, actualReturn] of rows) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
    await executeRun(
      `INSERT INTO live_trade_research_predictions (
        prediction_id, model_version, prediction_source, symbol, signal_id, predicted_at,
        horizon, predicted_direction, confidence, feature_hash, model_agreement, reasoning,
        invalidation, actual_direction, actual_return_pct, outcome_status, evaluated_at,
        created_at, feature_snapshot_json, prediction_context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, model, model.includes('LLAMA') ? 'LLAMA_GATEWAY' : 'LIVE_PAIR_FEATURES', 'EUR/USD', `${id}-signal`,
        predictedAt, '1D', predictedDirection, confidence, `${id}-feature`, 1, 'test', 'test',
        actualDirection, actualReturn, 'EVALUATED', predictedAt + day, predictedAt, '{}', 'CURRENT_PAIR']
    );
  }

  const comparison = await getCurrentPairPredictionModelComparison({
    symbol: 'EUR/USD',
    horizon: '1D'
  });

  assert.equal(comparison.total, 4);
  assert.equal(comparison.evaluated, 4);
  assert.equal(comparison.pending, 0);
  assert.equal(comparison.models.length, 2);

  const baseline = comparison.models.find(model => model.modelVersion === 'PAIR_FEATURE_BASELINE_V2');
  const ai = comparison.models.find(model => model.modelVersion === 'LLAMA_GATEWAY_QWEN_LLAMA_V1');

  assert.ok(baseline);
  assert.ok(ai);

  assert.equal(baseline.predictions, 2);
  assert.equal(baseline.evaluated, 2);
  assert.equal(baseline.correct, 1);
  assert.equal(baseline.directionalEvaluated, 2);
  assert.equal(baseline.accuracyPct, 50);
  assert.equal(baseline.sampleSufficient, false);
  assert.equal(baseline.minimumSampleCount, 30);
  assert.ok(baseline.brierScore !== null);
  assert.ok(baseline.accuracyConfidenceInterval95Pct !== null);

  assert.equal(ai.predictions, 2);
  assert.equal(ai.evaluated, 2);
  assert.equal(ai.correct, 2);
  assert.equal(ai.directionalEvaluated, 2);
  assert.equal(ai.accuracyPct, 100);
  assert.equal(ai.sampleSufficient, false);
  assert.equal(ai.minimumSampleCount, 30);
  assert.ok(ai.brierScore !== null);
  assert.ok(ai.accuracyConfidenceInterval95Pct !== null);
} finally {
  for (const [id] of rows) {
    await executeRun('DELETE FROM live_trade_research_predictions WHERE prediction_id = ?', [id]);
  }
}

console.log('CURRENT PAIR MODEL COMPARISON TEST PASSED');
