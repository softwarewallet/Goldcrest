import { createHash } from 'node:crypto';
import { executeQuery, executeRun } from '../database/db';
import { getLiveTradeResearchFeatures, ResearchFeatureRow } from './liveTradeResearchFeatureService';
import { requestResearchAiPrediction } from './researchAiServerService';

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
  predict(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon): ResearchPredictionOutput | Promise<ResearchPredictionOutput>;
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
    targetDistance: row.targetDistance,
    priceChange5mPct: row.priceChange5mPct, priceChange15mPct: row.priceChange15mPct,
    priceChange1hPct: row.priceChange1hPct, priceChange4hPct: row.priceChange4hPct,
    priceChangeDailyPct: row.priceChangeDailyPct, atrPct: row.atrPct,
    rsi: row.rsi, macdHistogram: row.macdHistogram, adx: row.adx,
    trendStrength: row.trendStrength, mtfAlignmentScore: row.mtfAlignmentScore,
    structureTrend: row.structureTrend, structurePhase: row.structurePhase,
    structureType: row.structureType, breakoutStatus: row.breakoutStatus,
    distanceToSupportPips: row.distanceToSupportPips,
    distanceToResistancePips: row.distanceToResistancePips
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function normalizeAiProbability(value: unknown, field: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`AI gateway returned an invalid ${field}.`);
  }
  // Accept 0-1 as the canonical format and 0-100 for interoperability with
  // common model-serving payloads, then normalize internally to 0-1.
  const normalized = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (normalized < 0 || normalized > 1) {
    throw new Error(`AI gateway returned ${field} outside the 0-1 range.`);
  }
  return normalized;
}

function researchPredictionPayload(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon) {
  // Deliberately exclude realized P&L, outcome, and holding duration: these are
  // post-outcome fields and would leak future information into the prediction.
  return {
    task: 'RESEARCH_PREDICTION',
    horizon,
    features: {
      signalId: row.signalId,
      symbol: row.symbol,
      signalTimestamp: row.signalTimestamp,
      // Do not expose the current execution signal direction to the forward
      // prediction model. That is the label-adjacent decision we are trying
      // to forecast, and allowing the model to consume it causes signal echo
      // and can create apparent direction "prediction" without independent
      // forward evidence.
      score: row.score,
      marketRegime: row.marketRegime,
      session: row.session,
      trendDirection: row.trendDirection,
      trendAlignment: row.trendAlignment,
      trend7dReturnPct: row.trend7dReturnPct,
      trend30dReturnPct: row.trend30dReturnPct,
      trend90dReturnPct: row.trend90dReturnPct,
      trend365dReturnPct: row.trend365dReturnPct,
      trend7dVolatilityPct: row.trend7dVolatilityPct,
      trend30dVolatilityPct: row.trend30dVolatilityPct,
      trend90dVolatilityPct: row.trend90dVolatilityPct,
      trend365dVolatilityPct: row.trend365dVolatilityPct,
      newsRiskLevel: row.newsRiskLevel,
      newsHighImpactCount: row.newsHighImpactCount,
      newsActiveHighImpactCount: row.newsActiveHighImpactCount,
      newsSentiment: row.newsSentiment,
      quoteSpread: row.quoteSpread,
      riskReward: row.riskReward,
      stopDistance: row.stopDistance,
      targetDistance: row.targetDistance,
      priceChange5mPct: row.priceChange5mPct,
      priceChange15mPct: row.priceChange15mPct,
      priceChange1hPct: row.priceChange1hPct,
      priceChange4hPct: row.priceChange4hPct,
      priceChangeDailyPct: row.priceChangeDailyPct,
      atrPct: row.atrPct,
      rsi: row.rsi,
      macdHistogram: row.macdHistogram,
      adx: row.adx,
      trendStrength: row.trendStrength,
      mtfAlignmentScore: row.mtfAlignmentScore,
      structureTrend: row.structureTrend,
      structurePhase: row.structurePhase,
      structureType: row.structureType,
      breakoutStatus: row.breakoutStatus,
      distanceToSupportPips: row.distanceToSupportPips,
      distanceToResistancePips: row.distanceToResistancePips
    }
  };
}

export class LlamaGatewayPredictionModel implements PredictionModel {
  readonly modelVersion = 'LLAMA_GATEWAY_QWEN_LLAMA_V1';
  readonly predictionSource = 'LLAMA_GATEWAY';

  async predict(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon): Promise<ResearchPredictionOutput> {
    const response = await requestResearchAiPrediction(researchPredictionPayload(row, horizon));
    // The gateway may return a dedicated consensus object after Llama
    // orchestrates Qwen internally. Keep the legacy prediction envelope as a
    // compatible fallback, but prefer the explicit consensus result.
    const source = response.consensus && typeof response.consensus === 'object'
      ? response.consensus as Record<string, unknown>
      : response.prediction && typeof response.prediction === 'object'
        ? response.prediction as Record<string, unknown>
        : response;

    const directionValue = String(source.direction || source.predictedDirection || '').toUpperCase();
    const direction: ResearchPredictionDirection =
      directionValue === 'UP' || directionValue.includes('BUY') ? 'UP' :
      directionValue === 'DOWN' || directionValue.includes('SELL') ? 'DOWN' :
      directionValue === 'FLAT' ? 'FLAT' :
      (() => { throw new Error('AI gateway returned an invalid prediction direction.'); })();

    const confidence = normalizeAiProbability(source.confidence, 'confidence');
    const modelAgreement = source.modelAgreement === undefined || source.modelAgreement === null
      ? null
      : normalizeAiProbability(source.modelAgreement, 'modelAgreement');

    return {
      direction,
      confidence,
      modelAgreement,
      reasoning: source.reasoning === undefined || source.reasoning === null ? null : String(source.reasoning),
      invalidation: source.invalidation === undefined || source.invalidation === null ? null : String(source.invalidation)
    };
  }
}

type HistoricalOutcomeRow = {
  symbol: string; signal_timestamp: number; direction: string; score: number;
  market_regime: string; session: string; news_status: string | null; news_json: string | null;
  strategy_version: string; realized_pnl: number | null; outcome: string | null;
};

function historicalOutcome(row: HistoricalOutcomeRow): 'WIN' | 'LOSS' | 'BREAKEVEN' | null {
  const explicit = String(row.outcome || '').trim().toUpperCase();
  if (['WIN', 'WON', 'PROFIT', 'PROFITABLE'].includes(explicit)) return 'WIN';
  if (['LOSS', 'LOST', 'LOSING'].includes(explicit)) return 'LOSS';
  if (['BREAKEVEN', 'BREAK_EVEN', 'BE'].includes(explicit)) return 'BREAKEVEN';
  const pnl = Number(row.realized_pnl);
  if (!Number.isFinite(pnl)) return null;
  return pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';
}

function predictionNewsRisk(row: HistoricalOutcomeRow): string {
  try {
    const parsed = row.news_json ? JSON.parse(row.news_json) : null;
    return String(parsed?.pairRisk?.riskLevel || parsed?.riskLevel || row.news_status || 'UNKNOWN').toUpperCase();
  } catch {
    return String(row.news_status || 'UNKNOWN').toUpperCase();
  }
}

function predictionScoreBand(score: number): string {
  if (!Number.isFinite(score)) return 'UNKNOWN';
  if (score < 60) return '<60'; if (score < 65) return '60-64'; if (score < 70) return '65-69';
  if (score < 75) return '70-74'; if (score < 80) return '75-79'; if (score < 85) return '80-84';
  if (score < 90) return '85-89'; return '90+';
}

let historicalEdgeCache: { loadedAt: number; rows: HistoricalOutcomeRow[] } | null = null;

async function loadHistoricalEdgeRows(signalTimestamp: number): Promise<HistoricalOutcomeRow[]> {
  const now = Date.now();
  if (!historicalEdgeCache || now - historicalEdgeCache.loadedAt > 60_000) {
    const rows = await executeQuery<HistoricalOutcomeRow>(
      `SELECT symbol, signal_timestamp, direction, score, market_regime, session,
              news_status, news_json, strategy_version, realized_pnl, outcome
         FROM live_trade_research
        WHERE lifecycle_status = 'CLOSED'
          AND (realized_pnl IS NOT NULL OR outcome IS NOT NULL)
        ORDER BY signal_timestamp ASC LIMIT 200000`,
      []
    );
    historicalEdgeCache = { loadedAt: now, rows };
  }
  return historicalEdgeCache.rows.filter(row => Number(row.signal_timestamp) < signalTimestamp);
}

export class HistoricalEdgePredictionModel implements PredictionModel {
  readonly modelVersion = 'HISTORICAL_EDGE_V1';
  readonly predictionSource = 'CLOSED_TRADE_HISTORY';

  async predict(row: ResearchFeatureRow): Promise<ResearchPredictionOutput> {
    const history = await loadHistoricalEdgeRows(row.signalTimestamp);
    const candidate = normalizeDirection(row.direction);
    const base = new SignalDirectionBaselineModel().predict(row, '1D');
    if (!history.length || candidate === 'FLAT') {
      return { ...base, reasoning: base.reasoning + ' Historical edge model had insufficient directional trade history and fell back to the deterministic baseline.' };
    }

    const targetDirection = candidate === 'UP' ? 'BUY' : 'SELL';
    const targetNews = String(row.newsRiskLevel || 'UNKNOWN').toUpperCase();
    const targetScoreBand = predictionScoreBand(row.score);
    const targetRegime = String(row.marketRegime || 'UNKNOWN').toUpperCase();
    const targetSession = String(row.session || 'UNKNOWN').toUpperCase();
    const targetSymbol = String(row.symbol).toUpperCase();

    let weightedWins = 0; let weightedLosses = 0; let matched = 0;
    for (const historical of history) {
      const outcome = historicalOutcome(historical);
      if (!outcome || outcome === 'BREAKEVEN') continue;
      if (String(historical.direction || '').toUpperCase() !== targetDirection) continue;
      let weight = 1;
      if (String(historical.symbol || '').toUpperCase() === targetSymbol) weight += 4;
      if (String(historical.market_regime || 'UNKNOWN').toUpperCase() === targetRegime) weight += 2;
      if (String(historical.session || 'UNKNOWN').toUpperCase() === targetSession) weight += 1;
      if (predictionNewsRisk(historical) === targetNews) weight += 1;
      if (predictionScoreBand(Number(historical.score)) === targetScoreBand) weight += 1;
      matched++;
      if (outcome === 'WIN') weightedWins += weight; else weightedLosses += weight;
    }

    if (matched < 20 || weightedWins + weightedLosses < 20) {
      return { ...base, reasoning: base.reasoning + ` Historical edge sample=${matched}; minimum 20 directional outcomes not reached, so no historical override was applied.` };
    }

    const historicalProbability = (weightedWins + 1) / (weightedWins + weightedLosses + 2);
    const signalProbability = candidate === 'UP' ? historicalProbability : 1 - historicalProbability;
    let direction: ResearchPredictionDirection = candidate;
    if (signalProbability < 0.45) direction = candidate === 'UP' ? 'DOWN' : 'UP';
    else if (signalProbability < 0.55) direction = 'FLAT';

    const confidence = clamp(Math.max(0.5, Math.min(0.9, Math.max(signalProbability, 1 - signalProbability))), 0.5, 0.9);
    return {
      direction,
      confidence,
      modelAgreement: Math.max(0, Math.min(1, 1 - Math.abs(signalProbability - historicalProbability))),
      reasoning: `Historical closed-trade edge model: ${matched} directional outcomes, weighted wins=${weightedWins.toFixed(1)}, weighted losses=${weightedLosses.toFixed(1)}, candidate=${candidate}, historical candidate success=${(signalProbability * 100).toFixed(1)}%. Context weights emphasize pair, regime, session, news risk and score band.`,
      invalidation: 'Research-only model. Recompute after material feature/context changes; historical win rate is not a guarantee.'
    };
  }
}

export class SignalDirectionBaselineModel implements PredictionModel {
  readonly modelVersion = 'PAIR_FEATURE_BASELINE_V2';
  readonly predictionSource = 'LIVE_PAIR_FEATURES';

  predict(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon): ResearchPredictionOutput {
    const score = Number.isFinite(row.score) ? row.score : 0;
    const evidence: number[] = [];

    const push = (value: number | null | undefined) => {
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) evidence.push(Number(value));
    };

    // Normalize independent directional evidence to -1..1. This is a deterministic
    // baseline, not a trained forecast model; its purpose is to provide a transparent
    // benchmark for later out-of-sample model evaluation.
    push(row.priceChange5mPct == null ? null : Math.tanh(row.priceChange5mPct * 20));
    push(row.priceChange15mPct == null ? null : Math.tanh(row.priceChange15mPct * 10));
    push(row.priceChange1hPct == null ? null : Math.tanh(row.priceChange1hPct * 6));
    push(row.priceChange4hPct == null ? null : Math.tanh(row.priceChange4hPct * 3));
    push(row.priceChangeDailyPct == null ? null : Math.tanh(row.priceChangeDailyPct * 2));
    push(row.structureTrend === 'bullish' ? 1 : row.structureTrend === 'bearish' ? -1 : 0);
    push(row.trendDirection === 'BULLISH' ? 1 : row.trendDirection === 'BEARISH' ? -1 : 0);
    push(row.breakoutStatus === 'bullish_breakout' ? 1 : row.breakoutStatus === 'bearish_breakdown' ? -1 : 0);
    if (row.mtfAlignmentScore != null) push((row.mtfAlignmentScore - 10) / 10);
    if (row.rsi != null) push((row.rsi - 50) / 20);
    if (row.macdHistogram != null) push(Math.tanh(row.macdHistogram * 1000));

    // The prediction horizon must control which price horizons dominate the
    // forecast. The previous implementation gave 5M/15M evidence the same weight
    // as 4H/Daily evidence, so a small intraday reversal could flip a 1D prediction.
    const horizonWeights: Record<ResearchPredictionHorizon, number[]> = {
      '1D': [0.03, 0.07, 0.15, 0.30, 0.45],
      '3D': [0.01, 0.04, 0.10, 0.30, 0.55],
      '7D': [0.00, 0.02, 0.08, 0.25, 0.65]
    };
    const priceEvidence = [
      row.priceChange5mPct == null ? null : Math.tanh(row.priceChange5mPct * 20),
      row.priceChange15mPct == null ? null : Math.tanh(row.priceChange15mPct * 10),
      row.priceChange1hPct == null ? null : Math.tanh(row.priceChange1hPct * 6),
      row.priceChange4hPct == null ? null : Math.tanh(row.priceChange4hPct * 3),
      row.priceChangeDailyPct == null ? null : Math.tanh(row.priceChangeDailyPct * 2)
    ];
    const weights = horizonWeights[horizon];
    let weightedPrice = 0;
    let weightTotal = 0;
    for (let i = 0; i < priceEvidence.length; i++) {
      if (priceEvidence[i] !== null) {
        weightedPrice += priceEvidence[i]! * weights[i];
        weightTotal += weights[i];
      }
    }
    const priceComposite = weightTotal > 0 ? weightedPrice / weightTotal : 0;

    // Structural evidence is slower-moving than raw short-term momentum.
    const structuralEvidence = [
      row.structureTrend === 'bullish' ? 1 : row.structureTrend === 'bearish' ? -1 : 0,
      row.trendDirection === 'BULLISH' ? 1 : row.trendDirection === 'BEARISH' ? -1 : 0,
      row.breakoutStatus === 'bullish_breakout' ? 1 : row.breakoutStatus === 'bearish_breakdown' ? -1 : 0,
      row.mtfAlignmentScore == null ? 0 : clamp((row.mtfAlignmentScore - 10) / 10, -1, 1)
    ];
    const structuralComposite = structuralEvidence.reduce((a, b) => a + b, 0) / structuralEvidence.length;
    const rsiEvidence = row.rsi == null ? 0 : clamp((row.rsi - 50) / 20, -1, 1);
    const macdEvidence = row.macdHistogram == null ? 0 : Math.tanh(row.macdHistogram * 1000);

    // Score is deliberately non-directional here. The forecast must be
    // determined by independent market evidence rather than by the current
    // BUY/SELL signal that is being evaluated.
    const composite = Math.max(-1, Math.min(1,
      priceComposite * 0.35 +
      structuralComposite * 0.45 +
      rsiEvidence * 0.08 +
      macdEvidence * 0.07 +
      (score - 50) / 400
    ));
    // Require materially directional evidence before changing state. This keeps
    // a 1D/3D/7D forecast from oscillating on small intraday noise.
    const direction = composite > 0.18 ? 'UP' : composite < -0.18 ? 'DOWN' : 'FLAT';
    const confidence = clamp(0.5 + Math.abs(composite) * 0.45, 0.5, 0.95);

    return {
      direction,
      confidence,
      modelAgreement: evidence.length ? 1 - Math.min(1, Math.abs(structuralComposite - composite)) : 0.5,
      reasoning: 'Deterministic forward-direction baseline using independent momentum, multi-timeframe, trend, structure, breakout, RSI/MACD and non-directional score evidence. The current BUY/SELL signal is excluded from the directional forecast. Evidence=' + evidence.length + ', composite=' + composite.toFixed(3) + '.',
      invalidation: 'Prediction is research-only; invalidate when the current feature set materially changes. Do not use as an execution instruction.'
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
    created_at INTEGER NOT NULL,
    feature_snapshot_json TEXT,
    prediction_context TEXT NOT NULL DEFAULT 'RESEARCH',
    actual_profitable INTEGER,
    realized_pnl REAL,
    outcome_label TEXT,
    label_source TEXT
  )`);
  const columns = await executeQuery<{ name: string }>('PRAGMA table_info(live_trade_research_predictions)');
  if (!columns.some(column => column.name === 'feature_snapshot_json')) {
    await executeRun('ALTER TABLE live_trade_research_predictions ADD COLUMN feature_snapshot_json TEXT');
  }
  if (!columns.some(column => column.name === 'prediction_context')) {
    await executeRun("ALTER TABLE live_trade_research_predictions ADD COLUMN prediction_context TEXT NOT NULL DEFAULT 'RESEARCH'");
  }
  const additiveColumns: Array<[string, string]> = [
    ['actual_profitable', 'INTEGER'],
    ['realized_pnl', 'REAL'],
    ['outcome_label', 'TEXT'],
    ['label_source', 'TEXT']
  ];
  for (const [name, type] of additiveColumns) {
    if (!columns.some(column => column.name === name)) {
      try { await executeRun(`ALTER TABLE live_trade_research_predictions ADD COLUMN ${name} ${type}`); } catch {}
    }
  }
}

async function makePrediction(row: ResearchFeatureRow, horizon: ResearchPredictionHorizon, model: PredictionModel): Promise<ResearchPrediction> {
  const output = await model.predict(row, horizon);
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
  predictionContext?: 'RESEARCH' | 'CURRENT_PAIR';
}): Promise<ResearchPrediction> {
  const horizon = params.horizon || '1D';
  const model = params.model || new SignalDirectionBaselineModel();
  const predictionContext = params.predictionContext || 'RESEARCH';
  const prediction = await makePrediction(params.row, horizon, model);
  await ensurePredictionTable();
  await executeRun(
    `INSERT OR REPLACE INTO live_trade_research_predictions (
      prediction_id, model_version, prediction_source, symbol, signal_id,
      predicted_at, horizon, predicted_direction, confidence, feature_hash,
      model_agreement, reasoning, invalidation, actual_direction,
      actual_return_pct, outcome_status, evaluated_at, created_at, feature_snapshot_json, prediction_context,
      actual_profitable, realized_pnl, outcome_label, label_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [prediction.predictionId, prediction.modelVersion, prediction.predictionSource,
      prediction.symbol, prediction.signalId, prediction.predictedAt, prediction.horizon,
      prediction.predictedDirection, prediction.confidence, prediction.featureHash,
      prediction.modelAgreement, prediction.reasoning, prediction.invalidation,
      null, null, 'PENDING', null, prediction.predictedAt, JSON.stringify(params.row), predictionContext,
      null, null, null, null]
  );
  return prediction;
}


export async function createCurrentResearchPrediction(params: {
  row: ResearchFeatureRow;
  horizon?: ResearchPredictionHorizon;
  model?: PredictionModel;
  dedupeWindowMs?: number;
}): Promise<ResearchPrediction> {
  const horizon = params.horizon || '1D';
  const model = params.model || new SignalDirectionBaselineModel();
  const dedupeWindowMs = Math.max(0, Math.floor(Number(params.dedupeWindowMs ?? 5 * 60_000)));
  await ensurePredictionTable();
  const currentFeatureHash = featureHash(params.row);

  if (dedupeWindowMs > 0) {
    const cutoff = Date.now() - dedupeWindowMs;
    const existing = await executeQuery<any>(
      `SELECT * FROM live_trade_research_predictions
        WHERE symbol = ? AND model_version = ? AND horizon = ? AND prediction_context = 'CURRENT_PAIR' AND predicted_at >= ?
        ORDER BY predicted_at DESC LIMIT 1`,
      [params.row.symbol, model.modelVersion, horizon, cutoff]
    );
    if (existing[0] && String(existing[0].feature_hash || '') === currentFeatureHash) {
      const row = existing[0];
      return {
        predictionId: String(row.prediction_id),
        modelVersion: String(row.model_version),
        predictionSource: String(row.prediction_source),
        symbol: String(row.symbol),
        signalId: row.signal_id == null ? null : String(row.signal_id),
        predictedAt: Number(row.predicted_at),
        horizon: row.horizon as ResearchPredictionHorizon,
        predictedDirection: row.predicted_direction as ResearchPredictionDirection,
        confidence: Number(row.confidence),
        featureHash: String(row.feature_hash),
        modelAgreement: row.model_agreement == null ? null : Number(row.model_agreement),
        reasoning: row.reasoning == null ? null : String(row.reasoning),
        invalidation: row.invalidation == null ? null : String(row.invalidation)
      };
    }
  }

  return createResearchPrediction({ row: params.row, horizon, model, predictionContext: 'CURRENT_PAIR' });
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

export async function getCurrentPairPredictions(params: {
  limit?: number;
  symbol?: string;
  modelVersion?: string;
  horizon?: ResearchPredictionHorizon;
} = {}): Promise<any[]> {
  await ensurePredictionTable();
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: any[] = [];
  if (params.symbol) { conditions.push('symbol = ?'); values.push(params.symbol); }
  if (params.modelVersion) { conditions.push('model_version = ?'); values.push(params.modelVersion); }
  if (params.horizon) { conditions.push('horizon = ?'); values.push(params.horizon); }
  const limit = Math.max(1, Math.min(250, Math.floor(Number(params.limit) || 50)));
  return executeQuery<any>(
    `SELECT prediction_id AS predictionId, model_version AS modelVersion,
      prediction_source AS predictionSource, symbol, signal_id AS signalId,
      predicted_at AS predictedAt, horizon, predicted_direction AS predictedDirection,
      confidence, feature_hash AS featureHash, model_agreement AS modelAgreement,
      reasoning, invalidation, actual_direction AS actualDirection,
      actual_return_pct AS actualReturnPct, outcome_status AS outcomeStatus,
      evaluated_at AS evaluatedAt, created_at AS createdAt,
      actual_profitable AS actualProfitable, realized_pnl AS realizedPnl,
      outcome_label AS outcomeLabel, label_source AS labelSource
      FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
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
