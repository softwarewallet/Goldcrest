import { executeQuery, executeRun } from '../database/db';
import { LiveForexProvider } from '../markets/forex/provider';
import type { ForexCandle } from '../markets/forex/types';

export type CurrentPairPredictionHorizon = '1D' | '3D' | '7D';

interface CurrentPairPredictionRow {
  prediction_id: string;
  model_version: string;
  prediction_source: string;
  symbol: string;
  predicted_at: number;
  horizon: CurrentPairPredictionHorizon;
  predicted_direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  actual_direction: 'UP' | 'DOWN' | 'FLAT' | null;
  actual_return_pct: number | null;
  outcome_status: string;
}

export interface CurrentPairOutcomeEvaluationResult {
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
  updatedAt: number;
}

export interface CurrentPairPredictionGroupMetrics {
  symbol: string;
  modelVersion: string;
  horizon: CurrentPairPredictionHorizon;
  predictions: number;
  evaluated: number;
  pending: number;
  correct: number;
  directionalEvaluated: number;
  accuracyPct: number | null;
  brierScore: number | null;
}

const liveForexProvider = new LiveForexProvider();

function horizonMs(horizon: CurrentPairPredictionHorizon): number {
  if (horizon === '1D') return 24 * 60 * 60 * 1000;
  if (horizon === '3D') return 3 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function directionalScore(predicted: CurrentPairPredictionRow, actual: 'UP' | 'DOWN' | 'FLAT') {
  if (actual === 'FLAT' || predicted.predicted_direction === 'FLAT') {
    return { evaluated: false, correct: false, brier: null as number | null };
  }
  const correct = predicted.predicted_direction === actual;
  const confidence = Math.max(0, Math.min(1, Number(predicted.confidence) || 0));
  const probabilityUp = predicted.predicted_direction === 'UP' ? confidence : 1 - confidence;
  const actualUp = actual === 'UP' ? 1 : 0;
  return {
    evaluated: true,
    correct,
    brier: Math.pow(probabilityUp - actualUp, 2)
  };
}

function actualFromReturn(returnPct: number): 'UP' | 'DOWN' | 'FLAT' {
  if (returnPct > 0) return 'UP';
  if (returnPct < 0) return 'DOWN';
  return 'FLAT';
}

function selectCandleAtOrAfter(candles: ForexCandle[], timestamp: number): ForexCandle | null {
  return candles.find(candle => Number(candle.timestamp) >= timestamp) || null;
}

function selectLatestCandleAtOrBefore(candles: ForexCandle[], timestamp: number): ForexCandle | null {
  let selected: ForexCandle | null = null;
  for (const candle of candles) {
    if (Number(candle.timestamp) <= timestamp) selected = candle;
    else break;
  }
  return selected;
}

/**
 * Evaluates CURRENT_PAIR predictions against authoritative cTrader Daily candles.
 *
 * The reference price is the latest Daily close at or before prediction time.
 * The horizon price is the first Daily close at or after prediction time + horizon.
 * This is deliberately separate from the historical signal/training evaluator:
 * current-pair snapshots do not require a historical live_trade_research signal.
 */
export async function evaluatePendingCurrentPairPredictions(params: {
  modelVersion?: string;
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<CurrentPairOutcomeEvaluationResult> {
  const conditions = [
    "prediction_context = 'CURRENT_PAIR'",
    "(outcome_status IS NULL OR outcome_status != 'EVALUATED')"
  ];
  const values: unknown[] = [];

  if (params.modelVersion) {
    conditions.push('model_version = ?');
    values.push(params.modelVersion);
  }
  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  let evaluated = 0;
  let pending = 0;
  let correct = 0;
  let directionalEvaluated = 0;
  let brierSum = 0;

  const candlesBySymbol = new Map<string, ForexCandle[]>();
  for (const prediction of rows) {
    if (!candlesBySymbol.has(prediction.symbol)) {
      try {
        await liveForexProvider.refreshPair(prediction.symbol);
        candlesBySymbol.set(prediction.symbol, liveForexProvider.getCandles(prediction.symbol, 'Daily', 80));
      } catch {
        candlesBySymbol.set(prediction.symbol, []);
      }
    }

    const candles = candlesBySymbol.get(prediction.symbol) || [];
    const targetTimestamp = Number(prediction.predicted_at) + horizonMs(prediction.horizon);
    const reference = selectLatestCandleAtOrBefore(candles, Number(prediction.predicted_at));
    const target = selectCandleAtOrAfter(candles, targetTimestamp);

    // Do not label a prediction until the requested horizon is actually represented
    // by authoritative market history.
    if (!reference || !target || !(Number(reference.close) > 0) || !(Number(target.close) > 0)) {
      pending++;
      continue;
    }

    const actualReturnPct = ((Number(target.close) - Number(reference.close)) / Number(reference.close)) * 100;
    const actualDirection = actualFromReturn(actualReturnPct);
    const score = directionalScore(prediction, actualDirection);

    await executeRun(
      `UPDATE live_trade_research_predictions
          SET actual_direction = ?, actual_return_pct = ?, outcome_status = 'EVALUATED', evaluated_at = ?
        WHERE prediction_id = ? AND prediction_context = 'CURRENT_PAIR'`,
      [actualDirection, actualReturnPct, Date.now(), prediction.prediction_id]
    );

    evaluated++;
    if (score.evaluated) {
      directionalEvaluated++;
      if (score.correct) correct++;
      brierSum += score.brier || 0;
    }
  }

  return {
    evaluated,
    pending,
    correct,
    directionalEvaluated,
    accuracyPct: directionalEvaluated ? (correct / directionalEvaluated) * 100 : null,
    brierScore: directionalEvaluated ? brierSum / directionalEvaluated : null,
    updatedAt: Date.now()
  };
}

export async function getCurrentPairPredictionAnalytics(params: {
  modelVersion?: string;
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  limit?: number;
} = {}): Promise<{
  total: number;
  evaluated: number;
  pending: number;
  groups: CurrentPairPredictionGroupMetrics[];
  generatedAt: number;
}> {
  const conditions = ["prediction_context = 'CURRENT_PAIR'"];
  const values: unknown[] = [];
  if (params.modelVersion) {
    conditions.push('model_version = ?');
    values.push(params.modelVersion);
  }
  if (params.horizon) {
    conditions.push('horizon = ?');
    values.push(params.horizon);
  }
  if (params.symbol) {
    conditions.push('symbol = ?');
    values.push(params.symbol);
  }

  const limit = Math.max(1, Math.min(100000, Math.floor(Number(params.limit) || 50000)));
  const rows = await executeQuery<CurrentPairPredictionRow>(
    `SELECT prediction_id, model_version, prediction_source, symbol, predicted_at,
            horizon, predicted_direction, confidence, actual_direction,
            actual_return_pct, outcome_status
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC
      LIMIT ?`,
    [...values, limit]
  );

  const groups = new Map<string, CurrentPairPredictionRow[]>();
  for (const row of rows) {
    const key = [row.symbol, row.model_version, row.horizon].join('|');
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  const metrics: CurrentPairPredictionGroupMetrics[] = [...groups.values()].map(group => {
    const evaluatedRows = group.filter(row => row.outcome_status === 'EVALUATED' && row.actual_direction);
    const directional = evaluatedRows
      .map(row => directionalScore(row, row.actual_direction as 'UP' | 'DOWN' | 'FLAT'))
      .filter(result => result.evaluated);
    const correct = directional.filter(result => result.correct).length;
    const brierValues = directional
      .map(result => result.brier)
      .filter((value): value is number => value !== null);

    return {
      symbol: group[0].symbol,
      modelVersion: group[0].model_version,
      horizon: group[0].horizon,
      predictions: group.length,
      evaluated: evaluatedRows.length,
      pending: group.length - evaluatedRows.length,
      correct,
      directionalEvaluated: directional.length,
      accuracyPct: directional.length ? (correct / directional.length) * 100 : null,
      brierScore: brierValues.length
        ? brierValues.reduce((sum, value) => sum + value, 0) / brierValues.length
        : null
    };
  }).sort((a, b) =>
    a.symbol.localeCompare(b.symbol) ||
    a.modelVersion.localeCompare(b.modelVersion) ||
    a.horizon.localeCompare(b.horizon)
  );

  return {
    total: rows.length,
    evaluated: rows.filter(row => row.outcome_status === 'EVALUATED').length,
    pending: rows.filter(row => row.outcome_status !== 'EVALUATED').length,
    groups: metrics,
    generatedAt: Date.now()
  };
}
