// ============================================================================
// PHASE 5 — SIGNAL QUALITY & FUNNEL ANALYTICS ENGINE
// ============================================================================

import { SignalFunnelMetrics, RejectionAnalyticsItem, RejectionReason } from './types';

export interface PaperExecutionQualityLog {
  executionId: string;
  signalId: string;
  instrument: string;
  side: 'BUY' | 'SELL';
  signalTimestamp: number;
  orderTimestamp: number;
  simulatedFillTimestamp: number;
  executionLatencyMs: number;
  expectedEntryPrice: number;
  actualSimulatedEntryPrice: number;
  spreadPips: number;
  slippagePips: number;
  costEstimate: number;
}

export class SignalAnalyticsEngine {
  private executionLogs: PaperExecutionQualityLog[] = [];
  private rejections: Map<RejectionReason, { count: number; sampleInstruments: string[]; lastOccurredAt: number }> = new Map();

  // Baseline Signal Funnel Counts
  private funnelCounts = {
    marketDataEvents: 14200,
    validDataEvents: 13950,
    technicalSetupsFound: 1840,
    deterministicSignalsGenerated: 520,
    mlPredictionsGenerated: 520,
    fusionSignalsQualified: 215,
    riskApprovedSignals: 180,
    paperExecutionsDispatched: 148,
    targetHitOutcomes: 91,
    stopHitOutcomes: 57
  };

  constructor() {
    this.seedRejections();
    this.seedExecutionLogs();
  }

  private seedRejections(): void {
    const reasons: Array<{ reason: RejectionReason; count: number; instruments: string[] }> = [
      { reason: 'WEAK_TREND', count: 85, instruments: ['EUR/USD', 'USD/CAD'] },
      { reason: 'POOR_RR', count: 62, instruments: ['GBP/USD', 'NIFTY'] },
      { reason: 'HIGH_SPREAD', count: 44, instruments: ['USD/JPY', 'BANKNIFTY'] },
      { reason: 'TIMEFRAME_CONFLICT', count: 38, instruments: ['AUD/USD', 'EUR/USD'] },
      { reason: 'ML_PREDICTION_CONFLICT', count: 56, instruments: ['USD/JPY', 'EUR/GBP'] },
      { reason: 'RISK_LIMIT_EXCEEDED', count: 24, instruments: ['BANKNIFTY', 'NIFTY'] },
      { reason: 'STALE_QUOTE', count: 12, instruments: ['RELIANCE', 'USD/CHF'] },
      { reason: 'INVALID_GEOMETRY', count: 9, instruments: ['EUR/USD'] },
      { reason: 'OUTSIDE_SESSION', count: 18, instruments: ['EUR/USD', 'GBP/JPY'] },
      { reason: 'DUPLICATE_POSITION', count: 15, instruments: ['USD/CAD'] }
    ];

    for (const r of reasons) {
      this.rejections.set(r.reason, {
        count: r.count,
        sampleInstruments: r.instruments,
        lastOccurredAt: Date.now() - Math.floor(Math.random() * 3600000)
      });
    }
  }

  private seedExecutionLogs(): void {
    const samples = [
      { instrument: 'EUR/USD', side: 'BUY' as const, expected: 1.08450, actual: 1.08454, latency: 120, spread: 0.8, slippage: 0.4 },
      { instrument: 'GBP/USD', side: 'SELL' as const, expected: 1.29120, actual: 1.29117, latency: 145, spread: 1.0, slippage: 0.3 },
      { instrument: 'USD/JPY', side: 'BUY' as const, expected: 152.340, actual: 152.345, latency: 98, spread: 0.9, slippage: 0.5 },
      { instrument: 'NIFTY', side: 'BUY' as const, expected: 24350.0, actual: 24351.5, latency: 160, spread: 1.5, slippage: 1.5 },
      { instrument: 'BANKNIFTY', side: 'SELL' as const, expected: 51200.0, actual: 51197.0, latency: 175, spread: 3.0, slippage: 3.0 }
    ];

    samples.forEach((s, idx) => {
      const now = Date.now() - (idx * 1800000);
      this.executionLogs.push({
        executionId: `exec_log_${idx + 1}`,
        signalId: `sig_${100 + idx}`,
        instrument: s.instrument,
        side: s.side,
        signalTimestamp: now - s.latency - 50,
        orderTimestamp: now - s.latency,
        simulatedFillTimestamp: now,
        executionLatencyMs: s.latency,
        expectedEntryPrice: s.expected,
        actualSimulatedEntryPrice: s.actual,
        spreadPips: s.spread,
        slippagePips: s.slippage,
        costEstimate: s.spread + s.slippage
      });
    });
  }

  // -------------------------------------------------------------
  // 1. SIGNAL FUNNEL METRICS & CONVERSION
  // -------------------------------------------------------------
  public getSignalFunnel(): SignalFunnelMetrics {
    const c = this.funnelCounts;

    return {
      marketDataEvents: c.marketDataEvents,
      validDataEvents: c.validDataEvents,
      technicalSetupsFound: c.technicalSetupsFound,
      deterministicSignalsGenerated: c.deterministicSignalsGenerated,
      mlPredictionsGenerated: c.mlPredictionsGenerated,
      fusionSignalsQualified: c.fusionSignalsQualified,
      riskApprovedSignals: c.riskApprovedSignals,
      paperExecutionsDispatched: c.paperExecutionsDispatched,
      targetHitOutcomes: c.targetHitOutcomes,
      stopHitOutcomes: c.stopHitOutcomes,
      conversionRates: {
        marketDataToValidDataPct: Number(((c.validDataEvents / c.marketDataEvents) * 100).toFixed(1)),
        validDataToTechnicalSetupPct: Number(((c.technicalSetupsFound / c.validDataEvents) * 100).toFixed(1)),
        setupToDeterministicPct: Number(((c.deterministicSignalsGenerated / c.technicalSetupsFound) * 100).toFixed(1)),
        deterministicToFusedPct: Number(((c.fusionSignalsQualified / c.deterministicSignalsGenerated) * 100).toFixed(1)),
        fusedToRiskApprovedPct: Number(((c.riskApprovedSignals / c.fusionSignalsQualified) * 100).toFixed(1)),
        riskApprovedToExecutedPct: Number(((c.paperExecutionsDispatched / c.riskApprovedSignals) * 100).toFixed(1)),
        executedToTargetFirstPct: Number(((c.targetHitOutcomes / (c.targetHitOutcomes + c.stopHitOutcomes)) * 100).toFixed(1))
      }
    };
  }

  // -------------------------------------------------------------
  // 2. REJECTION ANALYTICS
  // -------------------------------------------------------------
  public recordRejection(reason: RejectionReason, instrument: string): void {
    const existing = this.rejections.get(reason) || { count: 0, sampleInstruments: [], lastOccurredAt: Date.now() };
    const instruments = Array.from(new Set([...existing.sampleInstruments, instrument])).slice(-5);

    this.rejections.set(reason, {
      count: existing.count + 1,
      sampleInstruments: instruments,
      lastOccurredAt: Date.now()
    });
  }

  public getRejectionAnalytics(): RejectionAnalyticsItem[] {
    const total = Array.from(this.rejections.values()).reduce((sum, item) => sum + item.count, 0) || 1;
    const items: RejectionAnalyticsItem[] = [];

    this.rejections.forEach((val, reason) => {
      items.push({
        reason,
        count: val.count,
        percentageOfTotalRejections: Number(((val.count / total) * 100).toFixed(1)),
        sampleInstruments: val.sampleInstruments,
        lastOccurredAt: val.lastOccurredAt
      });
    });

    return items.sort((a, b) => b.count - a.count);
  }

  // -------------------------------------------------------------
  // 3. PAPER EXECUTION QUALITY
  // -------------------------------------------------------------
  public recordExecutionQuality(log: PaperExecutionQualityLog): void {
    this.executionLogs.unshift(log);
    if (this.executionLogs.length > 200) this.executionLogs.pop();
  }

  public listExecutionQualityLogs(limit: number = 50): PaperExecutionQualityLog[] {
    return this.executionLogs.slice(0, limit);
  }

  public getExecutionQualitySummary() {
    if (this.executionLogs.length === 0) {
      return {
        averageLatencyMs: 0,
        averageSpreadPips: 0,
        averageSlippagePips: 0,
        totalExecutions: 0
      };
    }

    const n = this.executionLogs.length;
    const avgLatency = this.executionLogs.reduce((acc, l) => acc + l.executionLatencyMs, 0) / n;
    const avgSpread = this.executionLogs.reduce((acc, l) => acc + l.spreadPips, 0) / n;
    const avgSlippage = this.executionLogs.reduce((acc, l) => acc + l.slippagePips, 0) / n;

    return {
      averageLatencyMs: Number(avgLatency.toFixed(1)),
      averageSpreadPips: Number(avgSpread.toFixed(2)),
      averageSlippagePips: Number(avgSlippage.toFixed(2)),
      totalExecutions: n
    };
  }
}

export const signalAnalyticsEngine = new SignalAnalyticsEngine();
