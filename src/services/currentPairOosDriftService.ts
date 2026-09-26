import { executeQuery } from '../database/db';
import type { CurrentPairPredictionHorizon } from './currentPairPredictionOutcomeService';

export interface CurrentPairOosDriftWindow {
  windowDays: 30 | 90;
  predictions: number;
  evaluated: number;
  directionalEvaluated: number;
  correct: number;
  accuracyPct: number | null;
  brierScore: number | null;
  averageConfidencePct: number | null;
  calibrationGapPct: number | null;
  sampleSufficient: boolean;
}

export interface CurrentPairOosDriftReport {
  symbol: string | null;
  horizon: CurrentPairPredictionHorizon;
  modelVersion: string;
  generatedAt: number;
  currentWindow: CurrentPairOosDriftWindow;
  baselineWindow: CurrentPairOosDriftWindow;
  drift: {
    accuracyDeltaPct: number | null;
    brierDelta: number | null;
    confidenceDeltaPct: number | null;
    calibrationGapDeltaPct: number | null;
    accuracyDriftFlag: boolean;
    brierDriftFlag: boolean;
    confidenceDriftFlag: boolean;
    calibrationDriftFlag: boolean;
  };
  checks: Array<{
    id: string;
    status: 'PASS' | 'WARN' | 'INSUFFICIENT';
    title: string;
    detail: string;
  }>;
}

const MIN_SAMPLE_COUNT = 30;
const BASELINE_WINDOW_DAYS = 90;
const CURRENT_WINDOW_DAYS = 30;
const ACCURACY_DRIFT_THRESHOLD_PCT = 10;
const BRIER_DRIFT_THRESHOLD = 0.1;
const CONFIDENCE_DRIFT_THRESHOLD_PCT = 10;
const CALIBRATION_GAP_THRESHOLD_PCT = 10;

function horizonMs(horizon: CurrentPairPredictionHorizon): number {
  if (horizon === '1D') return 24 * 60 * 60 * 1000;
  if (horizon === '3D') return 3 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function emptyWindow(windowDays: 30 | 90): CurrentPairOosDriftWindow {
  return {
    windowDays,
    predictions: 0,
    evaluated: 0,
    directionalEvaluated: 0,
    correct: 0,
    accuracyPct: null,
    brierScore: null,
    averageConfidencePct: null,
    calibrationGapPct: null,
    sampleSufficient: false
  };
}

export async function getCurrentPairOosDriftReport(params: {
  symbol?: string;
  horizon?: CurrentPairPredictionHorizon;
  modelVersion: string;
  now?: number;
}): Promise<CurrentPairOosDriftReport> {
  const symbol = params.symbol?.trim().toUpperCase() || null;
  const horizon = params.horizon || '1D';
  const now = Number(params.now) || Date.now();
  const currentCutoff = now - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const baselineCutoff = now - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const maturityCutoff = now - horizonMs(horizon);

  const conditions = [
    "prediction_context = 'CURRENT_PAIR'",
    'model_version = ?',
    'horizon = ?',
    'predicted_at >= ?',
    'predicted_at <= ?'
  ];
  const values: unknown[] = [params.modelVersion, horizon, baselineCutoff, now];
  if (symbol) {
    conditions.push('symbol = ?');
    values.push(symbol);
  }

  const rows = await executeQuery<any>(
    `SELECT predicted_at, predicted_direction, confidence, actual_direction, actual_return_pct,
            outcome_status
       FROM live_trade_research_predictions
      WHERE ${conditions.join(' AND ')}
      ORDER BY predicted_at ASC`,
    values
  );

  const buildWindow = (windowDays: 30 | 90, cutoff: number): CurrentPairOosDriftWindow => {
    const windowRows = rows.filter(row => Number(row.predicted_at) >= cutoff);
    const result = emptyWindow(windowDays);
    result.predictions = windowRows.length;

    let confidenceSum = 0;
    let confidenceCount = 0;
    let brierSum = 0;
    let brierCount = 0;

    for (const row of windowRows) {
      const confidence = clampConfidence(row.confidence);
      confidenceSum += confidence;
      confidenceCount++;

      if (Number(row.predicted_at) > maturityCutoff || row.outcome_status !== 'EVALUATED' || !row.actual_direction) continue;
      result.evaluated++;

      if (row.predicted_direction === 'FLAT' || row.actual_direction === 'FLAT') continue;
      result.directionalEvaluated++;

      const correct = row.predicted_direction === row.actual_direction;
      if (correct) result.correct++;

      const probabilityUp = row.predicted_direction === 'UP' ? confidence : 1 - confidence;
      const actualUp = row.actual_direction === 'UP' ? 1 : 0;
      brierSum += Math.pow(probabilityUp - actualUp, 2);
      brierCount++;
    }

    result.accuracyPct = result.directionalEvaluated
      ? (result.correct / result.directionalEvaluated) * 100
      : null;
    result.brierScore = brierCount ? brierSum / brierCount : null;
    result.averageConfidencePct = confidenceCount ? (confidenceSum / confidenceCount) * 100 : null;
    result.calibrationGapPct = result.accuracyPct != null && result.averageConfidencePct != null
      ? Math.abs(result.averageConfidencePct - result.accuracyPct)
      : null;
    result.sampleSufficient = result.directionalEvaluated >= MIN_SAMPLE_COUNT;
    return result;
  };

  const currentWindow = buildWindow(30, currentCutoff);
  const baselineWindow = buildWindow(90, baselineCutoff);

  const delta = (current: number | null, baseline: number | null) =>
    current == null || baseline == null ? null : current - baseline;

  const accuracyDeltaPct = delta(currentWindow.accuracyPct, baselineWindow.accuracyPct);
  const brierDelta = delta(currentWindow.brierScore, baselineWindow.brierScore);
  const confidenceDeltaPct = delta(currentWindow.averageConfidencePct, baselineWindow.averageConfidencePct);
  const calibrationGapDeltaPct = delta(currentWindow.calibrationGapPct, baselineWindow.calibrationGapPct);

  const checks = [
    {
      id: 'current-sample',
      status: currentWindow.sampleSufficient ? 'PASS' as const : 'INSUFFICIENT' as const,
      title: 'Current OOS sample',
      detail: `${currentWindow.directionalEvaluated} evaluated directional observations in the latest 30 days; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'baseline-sample',
      status: baselineWindow.sampleSufficient ? 'PASS' as const : 'INSUFFICIENT' as const,
      title: 'Reference OOS sample',
      detail: `${baselineWindow.directionalEvaluated} evaluated directional observations in the latest 90 days; minimum is ${MIN_SAMPLE_COUNT}.`
    },
    {
      id: 'accuracy-drift',
      status: accuracyDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(accuracyDeltaPct) >= ACCURACY_DRIFT_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Accuracy drift',
      detail: accuracyDeltaPct == null ? 'Insufficient evaluated data for comparison.' : `30-day minus 90-day accuracy is ${accuracyDeltaPct.toFixed(2)} percentage points.`
    },
    {
      id: 'brier-drift',
      status: brierDelta == null ? 'INSUFFICIENT' as const : Math.abs(brierDelta) >= BRIER_DRIFT_THRESHOLD ? 'WARN' as const : 'PASS' as const,
      title: 'Brier drift',
      detail: brierDelta == null ? 'Insufficient evaluated data for comparison.' : `30-day minus 90-day Brier score is ${brierDelta.toFixed(4)}.`
    },
    {
      id: 'confidence-drift',
      status: confidenceDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(confidenceDeltaPct) >= CONFIDENCE_DRIFT_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Confidence drift',
      detail: confidenceDeltaPct == null ? 'Insufficient prediction data for comparison.' : `30-day minus 90-day average confidence is ${confidenceDeltaPct.toFixed(2)} percentage points.`
    },
    {
      id: 'calibration-drift',
      status: calibrationGapDeltaPct == null ? 'INSUFFICIENT' as const : Math.abs(calibrationGapDeltaPct) >= CALIBRATION_GAP_THRESHOLD_PCT ? 'WARN' as const : 'PASS' as const,
      title: 'Calibration-gap drift',
      detail: calibrationGapDeltaPct == null ? 'Insufficient evaluated data for comparison.' : `30-day minus 90-day confidence/accuracy gap is ${calibrationGapDeltaPct.toFixed(2)} percentage points.`
    }
  ];

  return {
    symbol,
    horizon,
    modelVersion: params.modelVersion,
    generatedAt: now,
    currentWindow,
    baselineWindow,
    drift: {
      accuracyDeltaPct,
      brierDelta,
      confidenceDeltaPct,
      calibrationGapDeltaPct,
      accuracyDriftFlag: accuracyDeltaPct != null && Math.abs(accuracyDeltaPct) >= ACCURACY_DRIFT_THRESHOLD_PCT,
      brierDriftFlag: brierDelta != null && Math.abs(brierDelta) >= BRIER_DRIFT_THRESHOLD,
      confidenceDriftFlag: confidenceDeltaPct != null && Math.abs(confidenceDeltaPct) >= CONFIDENCE_DRIFT_THRESHOLD_PCT,
      calibrationDriftFlag: calibrationGapDeltaPct != null && Math.abs(calibrationGapDeltaPct) >= CALIBRATION_GAP_THRESHOLD_PCT
    },
    checks
  };
}
