import { createHash } from 'node:crypto';
import { executeQuery, executeRun } from '../database/db';
import { getLiveTradeResearchFeatures, ResearchFeatureRow } from './liveTradeResearchFeatureService';

export type ResearchPredictionHorizon = '1D' | '3D' | '7D';
export type ResearchPredictionDirection = 'UP' | 'DOWN' | 'FLAT';

export interface ResearchPrediction {
  predictionId: string;
  modelVersion: string;
  predictionSource: string;
  symbol: string;
  signalId: string | null;
  predictedAt: number;
  horizon: ResearchPredictionHorizon;
  predictedDirection: ResearchPredictionDirection;
  confidence: number;
  featureHash: string;
  modelAgreement: number | null;
  reasoning: string | null;
  invalidation: string | null;
}

export interface PredictionModel {
  modelVersion: string;
  predictionSource: string;
  predict(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon): ResearchPredictionOutput;
}

export interface ResearchPredictionOutput {
  direction: ResearchPredictionDirection;
  confidence: number;
  modelAgreement?: number | null;
  reasoning?: string | null;
  invalidation?: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDirection(direction: string): ResearchPredictionDirection {
  const value = String(direction || '').toUpperCase();
  if (value.includes('BUY')) return 'UP';
  if (value.includes('SELL')) return 'DOWN';
  return 'FLAT';
}

function featureHash(row: ResearchFeatureRow): string {
  const snapshot = {
    signalId: row.signalId, symbol: row.symbol, signalTimestamp: row.signalTimestamp,
    direction: row.direction, score: row.score, marketRegime: row.marketRegime, session: row.session,
    trendDirection: row.trendDirection, trendAlignment: row.trendAlignment,
    trend7dReturnPct: row.trend7dReturnPct, trend30dReturnPct: row.trend30dReturnPct,
    trend90dReturnPct: row.trend90dReturnPct, trend365dReturnPct: row.trend365dReturnPct,
    trend7dVolatilityPct: row.trend7dVolatilityPct, trend30dVolatilityPct: row.trend30dVolatilityPct,
    trend90dVolatilityPct: row.trend90dVolatilityPct, trend365dVolatilityPct: row.trend365dVolatilityPct,
    newsRiskLevel: row.newsRiskLevel, newsHighImpactCount: row.newsHighImpactCount,
    newsActiveHighImpactCount: row.newsActiveHighImpactCount, newsSentiment: row.newsSentiment,
    quoteSpread: row.quoteSpread, riskReward: row.riskReward, stopDistance: row.stopDistance,
    targetDistance: row.targetDistance
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export class SignalDirectionBaselineModel implements PredictionModel {
  readonly modelVersion = 'SIGNAL_DIRECTION_BASELINE_V1';
  readonly predictionSource = 'LIVE_SIGNAL_DIRECTION';

  predict(row: ResearchFeatureRow): ResearchPredictionOutput {
    const direction = normalizeDirection(row.direction);
    const score = Number.isFinite(row.score) ? row.score : 0;
    const confidence = direction === 'FLAT'
      ? 0.5
      : clamp(0.5 + Math.max(0, score - 50) / 100, 0.5, 0.99);
    return {
      direction,
      confidence,
      modelAgreement: 1,
      reasoning: direction === 'FLAT'
        ? 'The baseline has no BUY/SELL direction in the source signal.'
        : 'Baseline prediction follows the recorded live signal direction; source score=' + score.toFixed(2) + '.',
      invalidation: 'Prediction is research-only and must not be used as an execution instruction.'
    };
  }
}

async function ensurePredictionTable(): Promise<void> {
  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_predictions (
    prediction_id TEXT PRIMARY KEY,
    model_version TEXT NOT NULL,
    prediction_source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    signal_id TEXT,
    predicted_at INTEGER NOT NULL,
    horizon TEXT NOT NULL,
    predicted_direction TEXT NOT NULL,
    confidence REAL NOT NULL,
    feature_hash TEXT NOT NULL,
    model_agreement REAL,
    reasoning TEXT,
    invalidation TEXT,
    actual_direction TEXT,
    actual_return_pct REAL,
    outcome_status TEXT,
    evaluated_at INTEGER,
    created_at INTEGER NOT NULL
  )`);
}

function makePrediction(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon, model: PredictionModel): ResearchPrediction {
  const output = model.predict(row, horizon);
  const predictedAt = Date.now();
  return {
    predictionId: 'pred-' + predictedAt + '-' + row.signalId + '-' + horizon,
    modelVersion: model.modelVersion,
    predictionSource: model.predictionSource,
    symbol: row.symbol,
    signalId: row.signalId,
    predictedAt,
    horizon,
    predictedDirection: output.direction,
    confidence: clamp(Number(output.confidence), 0, 1),
    featureHash: featureHash(row),
    modelAgreement: output.modelAgreement === undefined || output.modelAgreement === null
      ? null : clamp(Number(output.modelAgreement), 0, 1),
    reasoning: output.reasoning || null,
    invalidation: output.invalidation || null
  };
}

export async function createResearchPrediction(params: {
  row: ResearchFeatureRow;
  horizon?: ResearchPredictionHorizon;
  model?: PredictionModel;
}): Promise<ResearchPrediction> {
  const horizon = params.horizon || '1D';
  const model = params.model || new SignalDirectionBaselineModel();
  const prediction = makePrediction(params.row, horizon, model);
  await ensurePredictionTable();
  await executeRun(
    `INSERT OR REPLACE INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id,
      predicted_at, horizon, predicted_direction, confidence, feature_hash,
      model_agreement, reasoning, invalidation, actual_direction,
      actual_return_pct, outcome_status, evaluated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [prediction.predictionId, prediction.modelVersion, prediction.predictionSource,
      prediction.symbol, prediction.signalId, prediction.predictedAt, prediction.horizon,
      prediction.predictedDirection, prediction.confidence, prediction.featureHash,
      prediction.modelAgreement, prediction.reasoning, prediction.invalidation,
      null, null, 'PENDING', null, prediction.predictedAt]
  );
  return prediction;
}

export async function generateResearchPredictions(params: {
  fromTimestamp?: number; toTimestamp?: number; horizon?: ResearchPredictionHorizon;
  limit?: number; model?: PredictionModel;
} = {}): Promise<ResearchPrediction[]> {
  const rows = await getLiveTradeResearchFeatures({
    fromTimestamp: params.fromTimestamp, toTimestamp: params.toTimestamp,
    closedOnly: true, limit: params.limit || 50000
  });
  const model = params.model || new SignalDirectionBaselineModel();
  const predictions: ResearchPrediction[] = [];
  for (const row of rows) {
    predictions.push(await createResearchPrediction({ row, horizon: params.horizon || '1D', model }));
  }
  return predictions;
}

export async function getLiveTradeResearchPredictions(params: {
  limit?: number; symbol?: string; modelVersion?: string;
} = {}): Promise<any[]> {
  await ensurePredictionTable();
  const conditions: string[] = [];
  const values: any[] = [];
  if (params.symbol) { conditions.push('symbol = ?'); values.push(params.symbol); }
  if (params.modelVersion) { conditions.push('model_version = ?'); values.push(params.modelVersion); }
  const limit = Math.max(1, Math.min(250, Math.floor(Number(params.limit) || 50)));
  return executeQuery<any>(
    `SELECT * FROM live_trade_research_predictions
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY predicted_at DESC LIMIT ?`,
    [...values, limit]
  );
}

export async function getResearchPrediction(predictionId: string): Promise<any | null> {
  await ensurePredictionTable();
  const rows = await executeQuery<any>(
    'SELECT * FROM live_trade_research_predictions WHERE prediction_id = ? LIMIT 1', [predictionId]
  );
  return rows[0] || null;
}
