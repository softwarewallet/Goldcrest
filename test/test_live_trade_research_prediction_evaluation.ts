import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import { createResearchPrediction } from '../src/services/liveTradeResearchPredictionService';
import {
  evaluatePendingResearchPredictions,
  getResearchPredictionAnalytics
} from '../src/services/liveTradeResearchPredictionEvaluationService';

await getDatabase();
await executeRun('DELETE FROM live_trade_research_predictions');
await executeRun('DELETE FROM live_trade_research_features');
await executeRun("DELETE FROM candles WHERE symbol = 'EUR/USD' AND timeframe = 'Daily'");

const now = Date.now();
const signalTimestamp = now - 8 * 86400000;
const baseFeature = {
  signalId: 'eval-pred-1',
  symbol: 'EUR/USD',
  signalTimestamp,
  direction: 'BUY',
  score: 82,
  marketRegime: 'TRENDING',
  session: 'LONDON',
  trendDirection: 'BULLISH',
  trendAlignment: 'ALIGNED',
  trend7dReturnPct: 1.2,
  trend30dReturnPct: 2.1,
  trend90dReturnPct: 4.0,
  trend365dReturnPct: 8.0,
  trend7dVolatilityPct: 8,
  trend30dVolatilityPct: 9,
  trend90dVolatilityPct: 10,
  trend365dVolatilityPct: 11,
  newsRiskLevel: 'LOW',
  newsHighImpactCount: 0,
  newsActiveHighImpactCount: 0,
  newsSentiment: 0.2,
  quoteSpread: 0.0001,
  riskReward: 2,
  stopDistance: 0.001,
  targetDistance: 0.002,
  realizedPnl: 10,
  outcome: 'WIN',
  holdingDurationMs: 1000,
  updatedAt: now
};

await executeRun(
  `INSERT OR REPLACE INTO live_trade_research_features (
    signal_id, symbol, signal_timestamp, direction, score, market_regime, session,
    trend_direction, trend_alignment, trend_7d_return_pct, trend_30d_return_pct,
    trend_90d_return_pct, trend_365d_return_pct, trend_7d_volatility_pct,
    trend_30d_volatility_pct, trend_90d_volatility_pct, trend_365d_volatility_pct,
    news_risk_level, news_high_impact_count, news_active_high_impact_count, news_sentiment,
    quote_spread, risk_reward, stop_distance, target_distance, realized_pnl, outcome,
    holding_duration_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  Object.values(baseFeature)
);

for (let offset = 1; offset <= 8; offset++) {
  const timestamp = signalTimestamp + offset * 86400000;
  const close = 100 + offset;
  await executeRun(
    `INSERT OR REPLACE INTO candles (
      id, symbol, timeframe, timestamp, open, high, low, close, volume, oi, vwap
    ) VALUES (?, ?, 'Daily', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `prediction-test-${offset}`, 'EUR/USD', timestamp,
      close - 0.2, close + 0.5, close - 0.5, close, 1000, null, close
    ]
  );
}

await createResearchPrediction({ row: baseFeature as any, horizon: '1D' });
const result = await evaluatePendingResearchPredictions({ horizon: '1D' });
assert.equal(result.evaluated, 1);
assert.equal(result.pending, 0);
assert.equal(result.directionalEvaluated, 1);
assert.equal(result.correct, 1);
assert.equal(result.accuracyPct, 100);
assert.ok(result.brierScore !== null && result.brierScore < 0.05);

const analytics = await getResearchPredictionAnalytics({ horizon: '1D' });
assert.equal(analytics.total, 1);
assert.equal(analytics.evaluated, 1);
assert.equal(analytics.correct, 1);
assert.equal(analytics.accuracyPct, 100);
assert.equal(analytics.bySymbol[0].key, 'EUR/USD');
assert.equal(analytics.byTrendAlignment[0].key, 'ALIGNED');
assert.equal(analytics.byNewsRisk[0].key, 'LOW');
assert.equal(analytics.calibration[4].predictions, 1);
assert.equal(analytics.calibration[4].evaluated, 1);

console.log('LIVE TRADE RESEARCH PREDICTION EVALUATION TEST PASSED');
