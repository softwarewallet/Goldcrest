import { scannerService } from './scannerService';
import { getSystemConfig } from './configService';
import {
  LlamaGatewayPredictionModel,
  SignalDirectionBaselineModel,
  type PredictionModel,
  type ResearchPredictionDirection,
  type ResearchPredictionHorizon,
  type ResearchPredictionOutput
} from './liveTradeResearchPredictionService';
import type { ResearchFeatureRow } from './liveTradeResearchFeatureService';

export interface CurrentPairPrediction {
  predictionId: string;
  symbol: string;
  predictedAt: number;
  horizon: ResearchPredictionHorizon;
  predictedDirection: ResearchPredictionDirection;
  confidence: number;
  modelVersion: string;
  predictionSource: string;
  modelAgreement: number | null;
  reasoning: string | null;
  invalidation: string | null;
  signalId: string | null;
  signalDirection: string;
  signalScore: number;
  mlProbability: number | null;
  marketRegime: string;
  session: string;
  trendDirection: string;
  trendAlignment: string;
  bid: number | null;
  ask: number | null;
  spreadPips: number | null;
  dataStatus: string;
  strategy: string | null;
  reasons: string[];
  generatedAt: number;
}

function finite(value: unknown, fallback: number | null = null): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildFeatureRow(item: any): ResearchFeatureRow {
  const signal = item.signal || {};
  const direction = String(signal.direction || 'NO_TRADE');
  const trendScore = Number(signal.scoreBreakdown?.trend);
  const trendDirection =
    Number.isFinite(trendScore) && trendScore > 0 ? 'BULLISH' :
    Number.isFinite(trendScore) && trendScore < 0 ? 'BEARISH' :
    'INSUFFICIENT_DATA';

  const signalDirection = direction.toUpperCase();
  const trendAlignment =
    trendDirection === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA' :
    (signalDirection === 'BUY' && trendDirection === 'BULLISH') ||
    (signalDirection === 'SELL' && trendDirection === 'BEARISH')
      ? 'ALIGNED'
      : 'MIXED';

  const tradePlan = signal.entryZone || {};
  const stopLoss = finite(signal.stopLoss);
  const entry = finite(tradePlan.preferred);
  const target = finite(signal.target1);

  return {
    signalId: String(signal.id || item.symbol + '-' + Date.now()),
    symbol: String(item.symbol),
    signalTimestamp: Number(signal.timestamp || Date.now()),
    direction,
    score: Number(signal.score || 0),
    marketRegime: String(signal.marketRegime || 'LIVE_SIGNAL'),
    session: String(signal.session || 'UNKNOWN'),
    trendDirection,
    trendAlignment,
    trend7dReturnPct: null,
    trend30dReturnPct: null,
    trend90dReturnPct: null,
    trend365dReturnPct: null,
    trend7dVolatilityPct: null,
    trend30dVolatilityPct: null,
    trend90dVolatilityPct: null,
    trend365dVolatilityPct: null,
    newsRiskLevel: 'UNKNOWN',
    newsHighImpactCount: 0,
    newsActiveHighImpactCount: 0,
    newsSentiment: null,
    quoteSpread: finite(item.spreadPips),
    riskReward: finite(signal.riskReward),
    stopDistance: entry !== null && stopLoss !== null ? Math.abs(entry - stopLoss) : null,
    targetDistance: entry !== null && target !== null ? Math.abs(target - entry) : null,
    realizedPnl: null,
    outcome: null,
    holdingDurationMs: null
  };
}

function normalizeOutput(output: ResearchPredictionOutput) {
  return {
    predictedDirection: output.direction,
    confidence: Math.max(0, Math.min(1, Number(output.confidence) || 0)),
    modelAgreement: output.modelAgreement == null ? null : Math.max(0, Math.min(1, Number(output.modelAgreement))),
    reasoning: output.reasoning || null,
    invalidation: output.invalidation || null
  };
}

export async function generateCurrentPairPredictions(params: {
  pairs?: string[];
  horizon?: ResearchPredictionHorizon;
  model?: 'BASELINE' | 'AI_GATEWAY';
} = {}): Promise<CurrentPairPrediction[]> {
  const configuredPairs = params.pairs?.length ? params.pairs : getSystemConfig().autoLiveForexPairs;
  const horizon = params.horizon || '1D';
  const model: PredictionModel =
    params.model === 'AI_GATEWAY'
      ? new LlamaGatewayPredictionModel()
      : new SignalDirectionBaselineModel();

  const scan = await scannerService.getForexScanner(configuredPairs);
  const generatedAt = Date.now();

  return Promise.all(scan.map(async item => {
    const row = buildFeatureRow(item);
    let output: ResearchPredictionOutput;
    try {
      output = await model.predict(row, horizon);
    } catch (error: any) {
      output = {
        direction: 'FLAT',
        confidence: 0,
        modelAgreement: null,
        reasoning: 'Prediction unavailable for this pair: ' + (error?.message || String(error)),
        invalidation: 'No prediction should be used when authoritative pair data or the prediction model is unavailable.'
      };
    }

    const normalized = normalizeOutput(output);
    return {
      predictionId: 'current-' + generatedAt + '-' + row.signalId + '-' + horizon,
      symbol: row.symbol,
      predictedAt: generatedAt,
      horizon,
      predictedDirection: normalized.predictedDirection,
      confidence: normalized.confidence,
      modelVersion: model.modelVersion,
      predictionSource: model.predictionSource,
      modelAgreement: normalized.modelAgreement,
      reasoning: normalized.reasoning,
      invalidation: normalized.invalidation,
      signalId: row.signalId || null,
      signalDirection: row.direction,
      signalScore: row.score,
      mlProbability: finite(item.signal?.mlProbability),
      marketRegime: row.marketRegime,
      session: row.session,
      trendDirection: row.trendDirection,
      trendAlignment: row.trendAlignment,
      bid: finite(item.bid),
      ask: finite(item.ask),
      spreadPips: finite(item.spreadPips),
      dataStatus: String(item.dataStatus || 'UNKNOWN'),
      strategy: item.signal?.strategy || null,
      reasons: Array.isArray(item.signal?.reasons) ? item.signal.reasons : [],
      generatedAt
    };
  }));
}
