import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

const CURRENT_WINDOW_DAYS = 30;
const REFERENCE_WINDOW_DAYS = 90;
const MIN_SAMPLE_COUNT = 30;

export interface CurrentPairCalibrationMatrixWindow {
  predictions: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  averageConfidencePct: number | null;
  expectedCalibrationErrorPct: number | null;
  maximumCalibrationErrorPct: number | null;
  sampleSufficient: boolean;
}

export interface CurrentPairCalibrationMatrixRow {
  symbol: string;
  horizon: CurrentPairPredictionHorizon;
  current: CurrentPairCalibrationMatrixWindow;
  reference: CurrentPairCalibrationMatrixWindow;
  deltas: {
    accuracyDeltaPct: number | null;
    confidenceDeltaPct: number | null;
    expectedCalibrationErrorDeltaPct: number | null;
    maximumCalibrationErrorDeltaPct: number | null;
  };
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function emptyWindow(): CurrentPairCalibrationMatrixWindow {
  return {
    predictions: 0,
    directionalEvaluated: 0,
    correct: 0,
    accuracyPct: null,
    averageConfidencePct: null,
    expectedCalibrationErrorPct: null,
    maximumCalibrationErrorPct: null,
    sampleSufficient: false
  };
}

function calculateWindow(rows: any[], maturityCutoff: number): CurrentPairCalibrationMatrixWindow {
  const result = emptyWindow();
  result.predictions = rows.length;

  const buckets = Array.from({ length: 5 }, (_, index) => ({
    lower: index * 20,
    upper: index === 4 ? 100 : (index + 1) * 20,
    predictions: 0,
    directionalEvaluated: 0,
    correct: 0,
    confidenceSum: 0
  }));

  for (const row of rows) {
    const confidence = clampConfidence(row.confidence);
    const confidencePct = confidence * 100;
    const bucketIndex = Math.min(4, Math.floor(confidencePct / 20));
    const bucket = buckets[bucketIndex];
    bucket.predictions++;
    bucket.confidenceSum += confidence;

    if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
    if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;

    result.directionalEvaluated++;
    bucket.directionalEvaluated++;
    if (row.predicted_direction === row.actual_direction) {
      result.correct++;
      bucket.correct++;
    }
  }

  result.accuracyPct = result.directionalEvaluated
    ? (result.correct / result.directionalEvaluated) * 100
    : null;

  const totalDirectional = buckets.reduce((sum, bucket) => sum + bucket.directionalEvaluated, 0);
  if (totalDirectional > 0) {
    const bucketErrors = buckets
      .filter(bucket => bucket.directionalEvaluated > 0)
      .map(bucket => {
        const accuracyPct = (bucket.correct / bucket.directionalEvaluated) * 100;
        const averageConfidencePct = bucket.predictions
          ? (bucket.confidenceSum / bucket.predictions) * 100
          : null;
        return {
          errorPct: averageConfidencePct == null ? null : Math.abs(averageConfidencePct - accuracyPct),
          weightedErrorPct: averageConfidencePct == null ? null : Math.abs(averageConfidencePct - accuracyPct) * (bucket.directionalEvaluated / totalDirectional),
          sampleSufficient: bucket.directionalEvaluated >= MIN_SAMPLE_COUNT
        };
      })
      .filter(bucket => bucket.errorPct != null);

    result.expectedCalibrationErrorPct = bucketErrors.length
      ? bucketErrors.reduce((sum, bucket) => sum + (bucket.weightedErrorPct as number), 0)
      : null;

    const sufficientErrors = bucketErrors.filter(bucket => bucket.sampleSufficient).map(bucket => bucket.errorPct as number);
    result.maximumCalibrationErrorPct = sufficientErrors.length ? Math.max(...sufficientErrors) : null;
  }

  const confidenceCount = rows.length;
  result.averageConfidencePct = confidenceCount
    ? rows.reduce((sum, row) => sum + clampConfidence(row.confidence), 0) / confidenceCount * 100
    : null;
  result.sampleSufficient = result.directionalEvaluated >= MIN_SAMPLE_COUNT;
  return result;
}

export async function getCurrentPairCalibrationMatrix(params: {
  modelVersion: string;
  horizon?: CurrentPairPredictionHorizon;
  symbol?: string;
  now?: number;
}): Promise<{
  modelVersion: string;
  generatedAt: number;
  currentWindowDays: number;
  referenceWindowDays: number;
  minimumSampleCount: number;
  rows: CurrentPairCalibrationMatrixRow[];
}> {
  const now = Number(params.now) || Date.now();
  const currentCutoff = now - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const referenceStart = now - (CURRENT_WINDOW_DAYS + REFERENCE_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const horizons = params.horizon ? [params.horizon] : ['1D', '3D', '7D'] as CurrentPairPredictionHorizon[];

  const conditions = [
    "prediction_context = 'CURRENT_PAIR'",
    'model_version = ?',
    'predicted_at >= ?',
    'predicted_at <= ?'
  ];
  const values: unknown[] = [params.modelVersion, referenceStart, now];

  if (params.symbol?.trim()) {
    conditions.push('symbol = ?');
    values.push(params.symbol.trim().toUpperCase());
  }

  const rows = await executeQuery<any>(
    `SELECT symbol, horizon, predicted_at, predicted_direction, confidence, actual_direction, outcome_status
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY symbol ASC, horizon ASC, predicted_at ASC`,
    values
  );

  const maturityCutoffs = new Map<CurrentPairPredictionHorizon, number>();
  for (const horizon of horizons) {
    const days = horizon === '1D' ? 1 : horizon === '3D' ? 3 : 7;
    maturityCutoffs.set(horizon, now - days * 24 * 60 * 60 * 1000);
  }

  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const horizon = String(row.horizon).toUpperCase() as CurrentPairPredictionHorizon;
    if (!horizons.includes(horizon)) continue;
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const key = symbol + '|' + horizon;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  const matrixRows: CurrentPairCalibrationMatrixRow[] = [];
  for (const [key, groupRows] of groups.entries()) {
    const [symbol, horizonText] = key.split('|');
    const horizon = horizonText as CurrentPairPredictionHorizon;
    const maturityCutoff = maturityCutoffs.get(horizon) as number;
    const currentRows = groupRows.filter(row => Number(row.predicted_at) >= currentCutoff);
    const referenceRows = groupRows.filter(row => Number(row.predicted_at) < currentCutoff);

    const current = calculateWindow(currentRows, maturityCutoff);
    const reference = calculateWindow(referenceRows, maturityCutoff);
    const delta = (a: number | null, b: number | null) => a == null || b == null ? null : a - b;

    matrixRows.push({
      symbol,
      horizon,
      current,
      reference,
      deltas: {
        accuracyDeltaPct: delta(current.accuracyPct, reference.accuracyPct),
        confidenceDeltaPct: delta(current.averageConfidencePct, reference.averageConfidencePct),
        expectedCalibrationErrorDeltaPct: delta(current.expectedCalibrationErrorPct, reference.expectedCalibrationErrorPct),
        maximumCalibrationErrorDeltaPct: delta(current.maximumCalibrationErrorPct, reference.maximumCalibrationErrorPct)
      }
    });
  }

  matrixRows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.horizon.localeCompare(b.horizon));

  return {
    modelVersion: params.modelVersion,
    generatedAt: now,
    currentWindowDays: CURRENT_WINDOW_DAYS,
    referenceWindowDays: REFERENCE_WINDOW_DAYS,
    minimumSampleCount: MIN_SAMPLE_COUNT,
    rows: matrixRows
  };
}
