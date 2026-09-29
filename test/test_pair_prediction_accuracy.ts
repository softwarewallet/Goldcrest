import { SignalDirectionBaselineModel } from '../src/services/liveTradeResearchPredictionService';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const prediction = fs.readFileSync('src/services/liveTradeResearchPredictionService.ts', 'utf8');
const audit = fs.readFileSync('src/services/pairPredictionAccuracyAuditService.ts', 'utf8');
const collection = fs.readFileSync('src/services/currentPairPredictionCollectionService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(prediction, /HISTORICAL_EDGE_V1/);
assert.match(prediction, /lifecycle_status = 'CLOSED'/);
assert.match(prediction, /Number\(row\.signal_timestamp\) < signalTimestamp/);
assert.match(prediction, /minimum 20 directional outcomes/);
assert.match(prediction, /realized_pnl IS NOT NULL OR outcome IS NOT NULL/);
assert.match(audit, /getPairPredictionAccuracyAudit/);
assert.match(audit, /byPair/);
assert.match(audit, /byScoreBand/);
assert.match(audit, /byRegime/);
assert.match(audit, /bySession/);
assert.match(audit, /byNewsRisk/);
assert.match(audit, /byStrategy/);
assert.match(audit, /profitFactor/);
assert.match(audit, /expectancy/);
assert.match(collection, /model: 'BASELINE'/);
assert.match(collection, /model: 'HISTORICAL_EDGE'/);
assert.doesNotMatch(collection, /models:/);
assert.match(fs.readFileSync('src/services/pairPredictionService.ts', 'utf8'), /fetchLiveForexNews/);
assert.match(fs.readFileSync('src/services/pairPredictionService.ts', 'utf8'), /newsActiveHighImpactCount/);

// Regression: a forward prediction must not change merely because the current
// execution signal label changes from BUY to SELL. The forecast is computed
// from independent market evidence, not by echoing the current signal.
const baseline = new SignalDirectionBaselineModel();
const baseRow: any = {
  signalId: 'prediction-regression',
  symbol: 'EUR/USD',
  signalTimestamp: 1_000_000,
  direction: 'BUY',
  score: 82,
  marketRegime: 'TRENDING',
  session: 'LONDON',
  trendDirection: 'BULLISH',
  trendAlignment: 'ALIGNED',
  trend7dReturnPct: 1,
  trend30dReturnPct: 2,
  trend90dReturnPct: 3,
  trend365dReturnPct: 4,
  trend7dVolatilityPct: 1,
  trend30dVolatilityPct: 1,
  trend90dVolatilityPct: 1,
  trend365dVolatilityPct: 1,
  newsRiskLevel: 'LOW',
  newsHighImpactCount: 0,
  newsActiveHighImpactCount: 0,
  newsSentiment: 0.1,
  quoteSpread: 0.8,
  riskReward: 2,
  stopDistance: 0.001,
  targetDistance: 0.002,
  realizedPnl: null,
  outcome: null,
  holdingDurationMs: null,
  priceChange5mPct: 0.01,
  priceChange15mPct: 0.02,
  priceChange1hPct: 0.04,
  priceChange4hPct: 0.08,
  priceChangeDailyPct: 0.2,
  atrPct: 0.5,
  rsi: 58,
  macdHistogram: 0.001,
  adx: 28,
  trendStrength: 75,
  mtfAlignmentScore: 18,
  structureTrend: 'bullish',
  structurePhase: 'trend_continuation',
  structureType: 'trend',
  breakoutStatus: 'bullish_breakout',
  distanceToSupportPips: 20,
  distanceToResistancePips: 40
};
const buyForecast = baseline.predict({ ...baseRow, direction: 'BUY' }, '1D');
const sellForecast = baseline.predict({ ...baseRow, direction: 'SELL' }, '1D');
assert.equal(buyForecast.direction, sellForecast.direction);
assert.equal(buyForecast.confidence, sellForecast.confidence);
assert.doesNotMatch(
  fs.readFileSync('src/services/liveTradeResearchPredictionService.ts', 'utf8'),
  /const scoreBias = sourceDirection/
);
// The source file may retain row.direction inside the feature hash so that
// cache invalidation occurs when the source signal changes. What matters for
// the forecast is that the prediction payload/model does not consume it.
const predictionSource = fs.readFileSync('src/services/liveTradeResearchPredictionService.ts', 'utf8');
const payloadStart = predictionSource.indexOf('function researchPredictionPayload');
const payloadEnd = predictionSource.indexOf('export class LlamaGatewayPredictionModel');
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
const predictionPayloadSource = predictionSource.slice(payloadStart, payloadEnd);
assert.doesNotMatch(predictionPayloadSource, /direction: row\.direction,/);
assert.match(server, /api\/live-trade-research\/pair-accuracy-audit/);

console.log('PHASE 10 PAIR PREDICTION ACCURACY AUDIT: PASSED');
