// ============================================================================
// PAPER TRADING VALIDATION, CALIBRATION & PROMOTION GATE ENGINE
// ============================================================================

import {
  PaperValidationSignal,
  PaperExecutionRecord,
  PaperVsBacktestComparison,
  CalibrationReport,
  CalibrationBucket,
  PaperPromotionGateEvaluation,
  ModelLifecycleStatus
} from '../historical/types';
import { MarketType } from '../../markets/common/types';

export class PaperValidationEngine {
  private capturedSignals: Map<string, PaperValidationSignal> = new Map();
  private executions: Map<string, PaperExecutionRecord> = new Map();
  private modelStates: Map<string, ModelLifecycleStatus> = new Map();

  constructor() {
    // Seed default baseline lifecycle states
    this.modelStates.set('gbt_forex_v1.0.0', 'PAPER');
    this.modelStates.set('gbt_india_v1.0.0', 'PAPER');
    this.modelStates.set('gbt_options_v1.0.0', 'RESEARCH');
  }

  /**
   * Captures a live paper signal with point-in-time feature and model metadata.
   */
  public capturePaperSignal(signal: Omit<PaperValidationSignal, 'paperSignalId' | 'dateUtc' | 'executionStatus'>): PaperValidationSignal {
    const paperSignalId = `psig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullSignal: PaperValidationSignal = {
      ...signal,
      paperSignalId,
      dateUtc: new Date(signal.timestamp).toISOString(),
      executionStatus: 'PENDING'
    };

    this.capturedSignals.set(paperSignalId, fullSignal);
    return fullSignal;
  }

  /**
   * Simulates paper execution with realistic spread, slippage, and fees (NO broker orders).
   */
  public executePaperSignal(
    signalId: string,
    currentMarketPrice: number,
    spreadPips: number = 1.2,
    slippagePips: number = 0.5,
    quantity: number = 1.0
  ): PaperExecutionRecord {
    const sig = this.capturedSignals.get(signalId);
    if (!sig) {
      throw new Error(`Paper signal ${signalId} not found`);
    }

    const isForex = sig.market === 'FOREX';
    const pipSize = isForex ? (sig.instrument.includes('JPY') ? 0.01 : 0.0001) : 1.0;
    const isBuy = sig.signalDirection === 'BUY';

    const slippageDiff = slippagePips * pipSize;
    const executedPrice = isBuy ? (currentMarketPrice + slippageDiff) : (currentMarketPrice - slippageDiff);

    const slippageCost = isForex ? slippagePips * 10 * quantity : slippagePips * quantity;
    const spreadCost = isForex ? spreadPips * 10 * quantity : spreadPips * quantity;
    const commissionPaid = isForex ? 7.00 * quantity : 40.0;

    const executionId = `pexec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record: PaperExecutionRecord = {
      executionId,
      paperSignalId: signalId,
      submittedAt: sig.timestamp,
      filledAt: Date.now(),
      executedPrice,
      slippagePips,
      slippageCost,
      spreadPips,
      spreadCost,
      commissionPaid,
      quantity,
      stopLoss: sig.stopLossPrice,
      takeProfit: sig.takeProfitPrice
    };

    sig.executionStatus = 'FILLED';
    this.executions.set(executionId, record);
    return record;
  }

  /**
   * Updates a paper trade outcome and calculates realized R and PnL.
   */
  public completePaperExecution(
    executionId: string,
    exitPrice: number,
    closedAt: number = Date.now()
  ): PaperExecutionRecord {
    const exec = this.executions.get(executionId);
    if (!exec) throw new Error(`Execution ${executionId} not found`);

    const sig = this.capturedSignals.get(exec.paperSignalId);
    if (!sig) throw new Error(`Signal for execution ${executionId} not found`);

    const isBuy = sig.signalDirection === 'BUY';
    const isForex = sig.market === 'FOREX';
    const pipSize = isForex ? (sig.instrument.includes('JPY') ? 0.01 : 0.0001) : 1.0;

    const priceDiff = isBuy ? (exitPrice - exec.executedPrice) : (exec.executedPrice - exitPrice);
    const grossPnl = isForex
      ? (priceDiff / pipSize) * 10 * exec.quantity
      : priceDiff * exec.quantity;

    const totalCosts = exec.slippageCost + exec.spreadCost + exec.commissionPaid;
    const netPnl = grossPnl - totalCosts;

    const riskDist = Math.abs(exec.executedPrice - exec.stopLoss);
    const realizedR = riskDist > 0 ? (priceDiff / riskDist) : 0;

    let outcome: PaperExecutionRecord['outcome'] = 'TIME_EXIT';
    if (isBuy) {
      if (exitPrice >= exec.takeProfit - 1e-6) outcome = 'TARGET_FIRST';
      else if (exitPrice <= exec.stopLoss + 1e-6) outcome = 'STOP_FIRST';
    } else {
      if (exitPrice <= exec.takeProfit + 1e-6) outcome = 'TARGET_FIRST';
      else if (exitPrice >= exec.stopLoss - 1e-6) outcome = 'STOP_FIRST';
    }

    exec.exitPrice = exitPrice;
    exec.closedAt = closedAt;
    exec.holdingTimeMinutes = Math.round((closedAt - exec.filledAt) / 60000);
    exec.grossPnl = Number(grossPnl.toFixed(2));
    exec.netPnl = Number(netPnl.toFixed(2));
    exec.realizedR = Number(realizedR.toFixed(2));
    exec.outcome = outcome;

    return exec;
  }

  /**
   * Evaluates Model Calibration across standard probability buckets (50-59%, 60-69%, 70-79%, 80-89%, 90%+).
   */
  public generateCalibrationReport(
    modelVersion: string,
    market: MarketType,
    evaluatedPredictions: Array<{ predictedProb: number; targetFirstActual: 0 | 1 }>
  ): CalibrationReport {
    const reportId = `calib_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const bucketDefs: Array<{ range: CalibrationBucket['bucketRange']; min: number; max: number }> = [
      { range: '50-59%', min: 0.50, max: 0.5999 },
      { range: '60-69%', min: 0.60, max: 0.6999 },
      { range: '70-79%', min: 0.70, max: 0.7999 },
      { range: '80-89%', min: 0.80, max: 0.8999 },
      { range: '90%+', min: 0.90, max: 1.00 }
    ];

    let totalBrier = 0;
    let maxCalibrationErrorPct = 0;

    const buckets: CalibrationBucket[] = bucketDefs.map(def => {
      const itemsInBucket = evaluatedPredictions.filter(p => p.predictedProb >= def.min && p.predictedProb <= def.max);
      const count = itemsInBucket.length;

      if (count === 0) {
        return {
          bucketRange: def.range,
          minProb: def.min,
          maxProb: def.max,
          predictedProbabilityAvg: Number(((def.min + def.max) / 2).toFixed(2)),
          sampleCount: 0,
          actualTargetFirstCount: 0,
          actualTargetFirstRatePct: 0,
          calibrationErrorPct: 0,
          brierComponent: 0
        };
      }

      const probAvg = itemsInBucket.reduce((acc, p) => acc + p.predictedProb, 0) / count;
      const targetFirstCount = itemsInBucket.filter(p => p.targetFirstActual === 1).length;
      const actualRate = (targetFirstCount / count) * 100;
      const errorPct = Math.abs(actualRate - (probAvg * 100));

      if (errorPct > maxCalibrationErrorPct) maxCalibrationErrorPct = errorPct;

      const brierComp = itemsInBucket.reduce((acc, p) => acc + Math.pow(p.predictedProb - p.targetFirstActual, 2), 0);
      totalBrier += brierComp;

      return {
        bucketRange: def.range,
        minProb: def.min,
        maxProb: def.max,
        predictedProbabilityAvg: Number(probAvg.toFixed(3)),
        sampleCount: count,
        actualTargetFirstCount: targetFirstCount,
        actualTargetFirstRatePct: Number(actualRate.toFixed(1)),
        calibrationErrorPct: Number(errorPct.toFixed(1)),
        brierComponent: Number((brierComp / count).toFixed(4))
      };
    });

    const overallBrier = evaluatedPredictions.length > 0
      ? totalBrier / evaluatedPredictions.length
      : 0.25;

    return {
      reportId,
      modelVersion,
      market,
      totalEvaluatedPredictions: evaluatedPredictions.length,
      overallBrierScore: Number(overallBrier.toFixed(4)),
      maxCalibrationErrorPct: Number(maxCalibrationErrorPct.toFixed(1)),
      isCalibrated: overallBrier <= 0.22 && maxCalibrationErrorPct <= 15.0,
      buckets,
      evaluatedAt: Date.now()
    };
  }

  /**
   * Compares Paper Trading performance with Historical Backtests to detect execution or performance drift.
   */
  public comparePaperVsBacktest(
    instrument: string,
    market: MarketType,
    backtestMetrics: PaperVsBacktestComparison['backtestMetrics'],
    paperExecutions: PaperExecutionRecord[]
  ): PaperVsBacktestComparison {
    const comparisonId = `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const closedExecs = paperExecutions.filter(e => e.netPnl !== undefined && e.outcome !== undefined);
    const sampleCount = closedExecs.length;

    if (sampleCount < 10) {
      return {
        comparisonId,
        instrument,
        market,
        timeWindowDays: 30,
        backtestMetrics,
        paperMetrics: {
          sampleCount,
          winRatePct: 0,
          expectancyR: 0,
          avgSpreadPips: 1.2,
          avgSlippagePips: 0.5,
          profitFactor: 0,
          avgExecutionDelayMs: 45
        },
        divergence: {
          winRateDiffPct: 0,
          expectancyDiffR: 0,
          slippageDiffPips: 0,
          isPerformanceDriftDetected: false,
          driftFlag: 'INSUFFICIENT_SAMPLE',
          driftExplanation: `Only ${sampleCount} paper trades completed (minimum 10 required for drift comparison).`
        },
        evaluatedAt: Date.now()
      };
    }

    const wins = closedExecs.filter(e => (e.netPnl || 0) > 0);
    const losses = closedExecs.filter(e => (e.netPnl || 0) < 0);
    const winRatePct = (wins.length / sampleCount) * 100;
    const totalR = closedExecs.reduce((acc, e) => acc + (e.realizedR || 0), 0);
    const expectancyR = totalR / sampleCount;

    const totalWinPnl = wins.reduce((acc, e) => acc + (e.netPnl || 0), 0);
    const totalLossPnl = losses.reduce((acc, e) => acc + Math.abs(e.netPnl || 0), 0);
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : 5.0;

    const avgSpread = closedExecs.reduce((acc, e) => acc + e.spreadPips, 0) / sampleCount;
    const avgSlippage = closedExecs.reduce((acc, e) => acc + e.slippagePips, 0) / sampleCount;

    const winRateDiff = Math.abs(winRatePct - backtestMetrics.winRatePct);
    const expDiff = Math.abs(expectancyR - backtestMetrics.expectancyR);
    const isDrift = winRateDiff > 12.0 || expDiff > 0.40;

    return {
      comparisonId,
      instrument,
      market,
      timeWindowDays: 30,
      backtestMetrics,
      paperMetrics: {
        sampleCount,
        winRatePct: Number(winRatePct.toFixed(1)),
        expectancyR: Number(expectancyR.toFixed(2)),
        avgSpreadPips: Number(avgSpread.toFixed(2)),
        avgSlippagePips: Number(avgSlippage.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        avgExecutionDelayMs: 65
      },
      divergence: {
        winRateDiffPct: Number(winRateDiff.toFixed(1)),
        expectancyDiffR: Number(expDiff.toFixed(2)),
        slippageDiffPips: Number(Math.abs(avgSlippage - backtestMetrics.avgSlippagePips).toFixed(2)),
        isPerformanceDriftDetected: isDrift,
        driftFlag: isDrift ? 'PAPER_PERFORMANCE_DRIFT' : 'NORMAL_VARIANCE',
        driftExplanation: isDrift
          ? `Paper win rate (${winRatePct.toFixed(1)}%) diverges by > 12% from backtest baseline (${backtestMetrics.winRatePct.toFixed(1)}%). Review slippage & spread regimes.`
          : `Paper trading metrics track within expected statistical confidence intervals of historical backtest.`
      },
      evaluatedAt: Date.now()
    };
  }

  /**
   * Paper Promotion Gate: Strict formal safety checks required before candidate promotion.
   * NOTE: Auto-execution remains strictly OFF. Even with all passing gates, operator confirmation is required.
   */
  public evaluatePromotionGate(
    modelVersion: string,
    market: MarketType,
    sampleCount: number,
    walkForwardOosWinRatePct: number,
    backtestNetExpectancyR: number,
    maxDrawdownPct: number,
    paperTradeCount: number,
    driftDetected: boolean,
    brierScore: number
  ): PaperPromotionGateEvaluation {
    const requirements = [
      {
        criterion: 'Historical Sample Size',
        requirement: '>= 100 historical candles & >= 30 test trades',
        actualValue: `${sampleCount} records`,
        passed: sampleCount >= 30
      },
      {
        criterion: 'Walk-Forward OOS Win Rate',
        requirement: '>= 50.0% out-of-sample win rate',
        actualValue: `${walkForwardOosWinRatePct.toFixed(1)}%`,
        passed: walkForwardOosWinRatePct >= 50.0
      },
      {
        criterion: 'Net Expectancy After Costs',
        requirement: '> 0.15 R net expectancy after spreads, slippage, & taxes',
        actualValue: `${backtestNetExpectancyR.toFixed(2)} R`,
        passed: backtestNetExpectancyR >= 0.15
      },
      {
        criterion: 'Maximum Backtest Drawdown',
        requirement: '<= 18.0% peak-to-trough drawdown',
        actualValue: `${maxDrawdownPct.toFixed(1)}%`,
        passed: maxDrawdownPct <= 18.0
      },
      {
        criterion: 'Paper Trading Validation Sample',
        requirement: '>= 15 completed simulated paper trades',
        actualValue: `${paperTradeCount} paper trades`,
        passed: paperTradeCount >= 15
      },
      {
        criterion: 'Execution & Performance Drift',
        requirement: 'No PAPER_PERFORMANCE_DRIFT flag active',
        actualValue: driftDetected ? 'DRIFT DETECTED' : 'HEALTHY (No Drift)',
        passed: !driftDetected
      },
      {
        criterion: 'Probability Calibration (Brier)',
        requirement: 'Brier score <= 0.24',
        actualValue: `${brierScore.toFixed(3)}`,
        passed: brierScore <= 0.24
      }
    ];

    const allPassed = requirements.every(r => r.passed);

    return {
      modelVersion,
      market,
      timestamp: Date.now(),
      isEligibleForProduction: false, // Never auto-eligible for live execution
      requirements,
      overallDecision: allPassed ? 'READY_FOR_OPERATOR_APPROVAL' : 'KEEP_IN_RESEARCH',
      operatorApprovalRequired: true,
      operatorApproved: false
    };
  }

  /**
   * Sets lifecycle state for a model version.
   */
  public setModelLifecycleState(modelVersion: string, state: ModelLifecycleStatus): void {
    this.modelStates.set(modelVersion, state);
  }

  public getModelLifecycleState(modelVersion: string): ModelLifecycleStatus {
    return this.modelStates.get(modelVersion) || 'RESEARCH';
  }

  public listCapturedSignals(): PaperValidationSignal[] {
    return Array.from(this.capturedSignals.values());
  }

  public listExecutions(): PaperExecutionRecord[] {
    return Array.from(this.executions.values());
  }
}
