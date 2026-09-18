// ============================================================================
// PHASE 4 — HISTORICAL DATA, ADVANCED BACKTESTING, MONTE CARLO & PAPER VALIDATION TYPES
// ============================================================================

import { MarketType as CommonMarketType } from '../../markets/common/types';
import { PredictionOutcomeLabel } from '../types';

export type MarketType = CommonMarketType | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS' | 'INDIAN_FUTURES';
export type PerformanceMetricsSummary = ModePerformanceMetrics;

// -------------------------------------------------------------
// 1. DATA AUDIT & SUFFICIENCY TYPES
// -------------------------------------------------------------

export type DataSufficiencyStatus = 'SUFFICIENT' | 'INSUFFICIENT';

export interface InstrumentAuditSummary {
  instrument: string;
  market: MarketType;
  timeframe: string;
  firstTimestamp: number;
  lastTimestamp: number;
  firstDateUtc: string;
  lastDateUtc: string;
  candleCount: number;
  missingCandles: number;
  duplicateCandles: number;
  gapCount: number;
  missingFieldsCount: number;
  averageSpread: number;
  optionChainSnapshotsCount?: number;
  signalCount: number;
  predictionCount: number;
  outcomeCount: number;
  tradeCount: number;
  sufficiencyStatus: DataSufficiencyStatus;
  sufficiencyReason: string;
  minimumRequiredCandles: number;
  usableRecordCount: number;
}

export interface DataAuditReport {
  reportId: string;
  generatedAt: number;
  generatedAtUtc: string;
  totalInstrumentsAudited: number;
  marketSummaries: {
    forex: {
      instrumentCount: number;
      totalCandles: number;
      sufficiency: DataSufficiencyStatus;
      instruments: string[];
    };
    indianEquitiesAndIndices: {
      instrumentCount: number;
      totalCandles: number;
      sufficiency: DataSufficiencyStatus;
      instruments: string[];
    };
    optionsChains: {
      snapshotCount: number;
      totalContracts: number;
      sufficiency: DataSufficiencyStatus;
      underlyings: string[];
    };
  };
  overallSufficiency: {
    forexML: DataSufficiencyStatus;
    forexReason: string;
    indianIndexML: DataSufficiencyStatus;
    indianIndexReason: string;
    optionsML: DataSufficiencyStatus;
    optionsReason: string;
  };
  instruments: InstrumentAuditSummary[];
  detectedGaps: DataGapReportItem[];
}

export interface DataGapReportItem {
  instrument: string;
  market: MarketType;
  timeframe: string;
  gapStartTimestamp: number;
  gapEndTimestamp: number;
  gapDurationMinutes: number;
  missingExpectedCandles: number;
  gapType: 'SESSION_GAP' | 'WEEKEND' | 'HOLIDAY' | 'MARKET_CLOSURE' | 'UNEXPECTED_MISSING_DATA' | 'PROVIDER_OUTAGE';
  isLegitimateMarketClosure: boolean;
}

// -------------------------------------------------------------
// 2. HISTORICAL INGESTION & DATASET REGISTRY TYPES
// -------------------------------------------------------------

export interface HistoricalDataProviderMetadata {
  provider: string;
  instrument: string;
  market: MarketType;
  timeframe: string;
  start: number;
  end: number;
  timezone: string;
  sourceVersion: string;
  retrievedAt: number;
}

export interface RawHistoricalCandle {
  timestamp: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string;
  spread?: number | string;
  bid?: number | string;
  ask?: number | string;
  vwap?: number | string;
  oi?: number | string;
  timezone?: string;
}

export interface NormalizedHistoricalCandle {
  instrument: string;
  market: MarketType;
  timeframe: string;
  utcTimestamp: number;
  localTimestamp: number;
  exchangeTimezone: string;
  isoUtc: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spread: number;
  bid?: number;
  ask?: number;
  vwap?: number;
  oi?: number;
  deltaOi?: number;
  iv?: number;
}

export interface DatasetRegistryEntry {
  datasetId: string;
  datasetVersion: string;
  market: MarketType;
  instrument: string;
  timeframe: string;
  provider: string;
  startDate: string;
  endDate: string;
  startTimestamp: number;
  endTimestamp: number;
  recordCount: number;
  qualityScore: number; // 0 to 100
  status: 'ACTIVE' | 'ARCHIVED' | 'CORRECTED' | 'DEPRECATED';
  sourceVersion: string;
  correctionReason?: string;
  createdAt: number;
  immutableHash: string;
}

export interface IngestionValidationResult {
  valid: boolean;
  totalRecords: number;
  acceptedRecords: number;
  rejectedRecords: number;
  duplicateRecords: number;
  gapCount: number;
  errors: string[];
  warnings: string[];
  normalizedCandles: NormalizedHistoricalCandle[];
  datasetMetadata: DatasetRegistryEntry;
}

// -------------------------------------------------------------
// 3. ADVANCED BACKTESTING & COST MODEL TYPES
// -------------------------------------------------------------

export type BacktestMode = 'DETERMINISTIC_ONLY' | 'ML_ONLY' | 'COMBINED';
export type SlippageModelType = 'FIXED' | 'PERCENTAGE' | 'ATR_BASED' | 'SPREAD_BASED';

export interface TransactionCostModel {
  // Forex specifics
  brokerCommissionPerLot: number;
  bidAskSpreadPips: number;
  overnightSwapPipsPerDay: number;

  // Indian market specifics
  brokeragePerOrderInr: number;
  sttPercentage: number;          // Securities Transaction Tax
  exchangeTurnoverChargePct: number;
  gstPercentage: number;          // 18% on Brokerage + Exchange charges
  sebiTurnoverChargesPct: number;
  stampDutyPct: number;
}

export interface SlippageConfig {
  modelType: SlippageModelType;
  fixedPips?: number;
  fixedInr?: number;
  percentageRate?: number;       // e.g. 0.0005 (0.05%)
  atrMultiplier?: number;        // e.g. 0.1 * ATR(14)
  spreadFraction?: number;       // e.g. 0.5 * spread
}

export interface LargeScaleBacktestConfig {
  backtestId?: string;
  market: MarketType;
  instrument: string;
  timeframe: string;
  startDate?: string;
  endDate?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  strategyName?: string;
  mode?: BacktestMode;
  modes?: BacktestMode[];
  initialCapital?: number;
  riskPerTradePct?: number;
  positionSize?: number;
  maxHoldingPeriodCandles?: number;
  signalThreshold?: number;
  mlThreshold?: number;
  costModel?: TransactionCostModel;
  transactionCosts?: TransactionCostModel;
  slippageConfig?: SlippageConfig;
  slippage?: SlippageConfig;
  datasetId?: string;
  datasetVersion?: string;
  strategyVersion?: string;
  modelVersion?: string;
  featureVersion?: string;
}

export interface BacktestTradeAudit {
  tradeId: string;
  signalTimestamp: number;
  signalDateUtc: string;
  instrument: string;
  market: MarketType;
  direction: 'BUY' | 'SELL';
  mode: BacktestMode;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  grossPnl: number;
  netPnl: number;
  realizedR: number;
  holdingCandles: number;
  outcome: PredictionOutcomeLabel;
  mfe: number;
  mae: number;
  costs: {
    brokerage: number;
    spreadCost: number;
    slippageCost: number;
    sttAndTaxes: number;
    totalCost: number;
  };
  regime: string;
  session: string;
  deterministicScore: number;
  mlProbability?: number;
  fusedDecision: string;
  optionsContractDetails?: {
    strike: number;
    expiryDate: string;
    dte: number;
    optionType: 'CALL' | 'PUT';
    lotSize: number;
    entryIv: number;
    entryDelta: number;
  };
}

export interface ModePerformanceMetrics {
  mode: BacktestMode;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRatePct: number;
  averageR: number;
  medianR: number;
  expectancyR: number;
  profitFactor: number;
  grossPnl: number;
  netPnl: number;
  totalCostsPaid: number;
  maxDrawdownAmount: number;
  maxDrawdownPct: number;
  averageDrawdownPct: number;
  maxDrawdownDurationCandles: number;
  recoveryTimeCandles: number;
  sharpeRatio: number;
  sortinoRatio: number;
  averageHoldingPeriodCandles: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  equityCurve: Array<{
    timestamp: number;
    grossEquity: number;
    netEquity: number;
    drawdownPct: number;
  }>;
}

export interface MultiModeBacktestResult {
  backtestId: string;
  datasetId: string;
  datasetVersion: string;
  strategyVersion: string;
  modelVersion?: string;
  featureVersion: string;
  instrument: string;
  market: MarketType;
  timeframe: string;
  startDate: string;
  endDate: string;
  config: LargeScaleBacktestConfig;
  deterministicMetrics: ModePerformanceMetrics;
  mlMetrics: ModePerformanceMetrics;
  combinedMetrics: ModePerformanceMetrics;
  trades: BacktestTradeAudit[];
  regimeAnalysis: Record<string, SubGroupPerformance>;
  sessionAnalysis: Record<string, SubGroupPerformance>;
  dteAnalysis?: Record<string, SubGroupPerformance>;
  strategyAnalysis?: Record<string, SubGroupPerformance>;
  createdAt: number;
}

export interface SubGroupPerformance {
  groupKey: string;
  totalTrades: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  netPnl: number;
  avgDrawdownPct: number;
}

// -------------------------------------------------------------
// 4. MONTE CARLO RISK SIMULATION TYPES
// -------------------------------------------------------------

export interface MonteCarloConfig {
  simulationId?: string;
  iterations: number; // e.g. 1,000 to 10,000
  resampleWithReplacement: boolean;
  confidenceIntervalLevel: number; // e.g. 0.95
  initialCapital: number;
  ruinThresholdPct: number; // e.g. 0.30 (30% drawdown considered ruin)
}

export interface MonteCarloSimulationResult {
  simulationId: string;
  sourceBacktestId: string;
  tradeCount: number;
  iterations: number;
  medianFinalNetPnl: number;
  p5NetPnl: number; // 5th percentile (worst 5%)
  p25NetPnl: number;
  p75NetPnl: number;
  p95NetPnl: number; // 95th percentile
  expectedMaxDrawdownPct: number;
  p95MaxDrawdownPct: number;
  p99MaxDrawdownPct: number;
  probabilityOfRuinPct: number;
  expectedWorstLosingStreak: number;
  p95WorstLosingStreak: number;
  sharpeDistribution: {
    mean: number;
    stdDev: number;
    ciLower: number;
    ciUpper: number;
  };
  sampleSizeSufficiency: {
    sampleSize: number;
    isStatisticallySignificant: boolean;
    standardError: number;
    marginOfErrorPct: number;
    confidenceStatement: string;
  };
  simulatedDrawdownDistribution: Array<{
    drawdownBinPct: string;
    frequency: number;
    probabilityPct: number;
  }>;
  simulatedEquityCurvesSample: Array<Array<{ step: number; equity: number }>>;
}

// -------------------------------------------------------------
// 5. PAPER TRADING VALIDATION & CALIBRATION TYPES
// -------------------------------------------------------------

export type ModelLifecycleStatus = 'RESEARCH' | 'CANDIDATE' | 'PAPER' | 'PRODUCTION' | 'DEGRADED' | 'RETIRED';

export interface PaperValidationSignal {
  paperSignalId: string;
  timestamp: number;
  dateUtc: string;
  market: MarketType;
  instrument: string;
  strategy: string;
  signalDirection: 'BUY' | 'SELL';
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  tp1Price?: number;
  mlPredictionId?: string;
  mlProbability: number;
  featureVersion: string;
  modelVersion: string;
  marketRegime: string;
  dataSource: string;
  executionStatus: 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED';
}

export interface PaperExecutionRecord {
  executionId: string;
  paperSignalId: string;
  submittedAt: number;
  filledAt: number;
  executedPrice: number;
  slippagePips: number;
  slippageCost: number;
  spreadPips: number;
  spreadCost: number;
  commissionPaid: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice?: number;
  closedAt?: number;
  holdingTimeMinutes?: number;
  grossPnl?: number;
  netPnl?: number;
  realizedR?: number;
  outcome?: PredictionOutcomeLabel;
}

export interface CalibrationBucket {
  bucketRange: '50-59%' | '60-69%' | '70-79%' | '80-89%' | '90%+';
  minProb: number;
  maxProb: number;
  predictedProbabilityAvg: number;
  sampleCount: number;
  actualTargetFirstCount: number;
  actualTargetFirstRatePct: number;
  calibrationErrorPct: number;
  brierComponent: number;
}

export interface CalibrationReport {
  reportId: string;
  modelVersion: string;
  market: MarketType;
  totalEvaluatedPredictions: number;
  overallBrierScore: number;
  maxCalibrationErrorPct: number;
  isCalibrated: boolean;
  buckets: CalibrationBucket[];
  evaluatedAt: number;
}

export interface PaperVsBacktestComparison {
  comparisonId: string;
  instrument: string;
  market: MarketType;
  timeWindowDays: number;
  backtestMetrics: {
    sampleCount: number;
    winRatePct: number;
    expectancyR: number;
    avgSpreadPips: number;
    avgSlippagePips: number;
    profitFactor: number;
  };
  paperMetrics: {
    sampleCount: number;
    winRatePct: number;
    expectancyR: number;
    avgSpreadPips: number;
    avgSlippagePips: number;
    profitFactor: number;
    avgExecutionDelayMs: number;
  };
  divergence: {
    winRateDiffPct: number;
    expectancyDiffR: number;
    slippageDiffPips: number;
    isPerformanceDriftDetected: boolean;
    driftFlag: 'PAPER_PERFORMANCE_DRIFT' | 'NORMAL_VARIANCE' | 'INSUFFICIENT_SAMPLE';
    driftExplanation: string;
  };
  evaluatedAt: number;
}

export interface PaperPromotionGateEvaluation {
  modelVersion: string;
  market: MarketType;
  timestamp: number;
  isEligibleForProduction: boolean;
  requirements: Array<{
    criterion: string;
    requirement: string;
    actualValue: string;
    passed: boolean;
  }>;
  overallDecision: 'PROMOTE_TO_PAPER' | 'KEEP_IN_RESEARCH' | 'REJECT_CANDIDATE' | 'READY_FOR_OPERATOR_APPROVAL';
  operatorApprovalRequired: boolean;
  operatorApproved: boolean;
  operatorApprovedBy?: string;
  operatorApprovedAt?: number;
}

// -------------------------------------------------------------
// 6. RESEARCH REPORTS & EXPORT TYPES
// -------------------------------------------------------------

export interface DailyResearchSummary {
  reportDate: string;
  generatedAt: number;
  signalsGeneratedToday: number;
  qualifiedSignalsToday: number;
  rejectedSignalsToday: number;
  mlPredictionsMadeToday: number;
  paperTradesExecutedToday: number;
  paperWinsToday: number;
  paperLossesToday: number;
  paperRealizedPnlToday: number;
  winRateTodayPct: number;
  expectancyTodayR: number;
  marketRegimesObserved: string[];
  averageFeaturePsi: number;
  modelDriftStatus: 'HEALTHY' | 'MODERATE_DRIFT' | 'SEVERE_DRIFT';
  calibrationSummary: string;
}

export interface WeeklyResearchReport {
  reportWeek: string;
  generatedAt: number;
  deterministicPerformance: SubGroupPerformance;
  mlPerformance: SubGroupPerformance;
  combinedPerformance: SubGroupPerformance;
  performanceByInstrument: Record<string, SubGroupPerformance>;
  performanceByStrategy: Record<string, SubGroupPerformance>;
  performanceByRegime: Record<string, SubGroupPerformance>;
  performanceBySession: Record<string, SubGroupPerformance>;
  performanceByProbabilityBucket: Record<string, SubGroupPerformance>;
  featureStabilitySummary: string;
  actionableInsights: string[];
}
