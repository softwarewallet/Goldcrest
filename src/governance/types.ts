// ============================================================================
// PHASE 5 — CONTROLLED PAPER VALIDATION, MODEL GOVERNANCE & PRODUCTION READINESS
// DOMAIN TYPES & INTERFACES
// ============================================================================

import { MarketType as CommonMarketType } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';

export type MarketType = CommonMarketType | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS' | 'INDIAN_FUTURES' | 'INDIAN_INDEX';

// -------------------------------------------------------------
// 1. GLOBAL SYSTEM STATES
// -------------------------------------------------------------
export type GlobalSystemState =
  | 'SYSTEM_HEALTHY'
  | 'DEGRADED'
  | 'DATA_ISSUE'
  | 'MODEL_ISSUE'
  | 'BROKER_ISSUE'
  | 'RISK_LOCKED'
  | 'EMERGENCY_HALTED'
  | 'MAINTENANCE';

// -------------------------------------------------------------
// 2. STRATEGY & MODEL LIFECYCLES
// -------------------------------------------------------------
export type StrategyLifecycleState =
  | 'RESEARCH'
  | 'BACKTEST'
  | 'PAPER'
  | 'DEMO'
  | 'LIVE_CANDIDATE'
  | 'LIVE_APPROVED'
  | 'SUSPENDED'
  | 'RETIRED';

export type ModelLifecycleState =
  | 'RESEARCH'
  | 'CANDIDATE'
  | 'PAPER'
  | 'DEMO'
  | 'PRODUCTION'
  | 'DEGRADED'
  | 'SUSPENDED'
  | 'RETIRED';

export type PromotionStageTransition =
  | 'RESEARCH_TO_PAPER'
  | 'PAPER_TO_DEMO'
  | 'DEMO_TO_LIVE_CANDIDATE'
  | 'LIVE_CANDIDATE_TO_LIVE_APPROVED';

export type PromotionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'REVOKED';

// -------------------------------------------------------------
// 3. PROBABILITY CALIBRATION BUCKETS (9 INSTITUTIONAL BUCKETS)
// -------------------------------------------------------------
export interface CalibrationBucket {
  bucketRange: '50-54%' | '55-59%' | '60-64%' | '65-69%' | '70-74%' | '75-79%' | '80-84%' | '85-89%' | '90%+';
  minProb: number;
  maxProb: number;
  sampleCount: number;
  actualTargetFirstCount: number;
  actualTargetFirstRate: number;
  predictedAvgProb: number;
  calibrationError: number;
  brierContribution: number;
}

export interface ModelCalibrationSummary {
  modelId: string;
  modelVersion: string;
  evaluatedAt: number;
  totalPredictions: number;
  overallBrierScore: number;
  maxCalibrationError: number;
  expectedCalibrationError: number;
  buckets: CalibrationBucket[];
  isWellCalibrated: boolean;
  status: 'CALIBRATED' | 'MODERATELY_MISCALIBRATED' | 'DEGRADED';
}

// -------------------------------------------------------------
// 4. CONFIDENCE INTERVALS & SAMPLE SIZE SAFETY
// -------------------------------------------------------------
export type SampleSizeSafety = 'INSUFFICIENT_SAMPLE' | 'ADEQUATE_SAMPLE' | 'ROBUST_SAMPLE';

export interface ConfidenceInterval {
  pointEstimate: number;
  lowerBound: number;
  upperBound: number;
  confidenceLevel: number; // e.g., 0.95
  sampleSize: number;
  safetyStatus: SampleSizeSafety;
  isReliable: boolean;
}

// -------------------------------------------------------------
// 5. REGIME, SESSION & OPTIONS ROBUSTNESS
// -------------------------------------------------------------
export type RobustnessRegime =
  | 'TRENDING'
  | 'STRONG_TRENDING'
  | 'RANGE'
  | 'HIGH_VOLATILITY'
  | 'BREAKOUT'
  | 'REVERSAL'
  | 'LOW_VOLATILITY';

export type RobustnessForexSession = 'Tokyo' | 'London' | 'New York' | 'London_NY_Overlap';
export type RobustnessIndianSession = 'Opening' | 'Morning' | 'Midday' | 'Afternoon' | 'Closing';

export interface RegimePerformanceMetrics {
  regime: RobustnessRegime;
  sampleCount: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sampleSafety: SampleSizeSafety;
}

export interface SessionPerformanceMetrics {
  session: string;
  sampleCount: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  sampleSafety: SampleSizeSafety;
}

export interface OptionsRobustnessAnalysis {
  moneyness: {
    atm: { trades: number; winRatePct: number; expectancyR: number };
    itm: { trades: number; winRatePct: number; expectancyR: number };
    otm: { trades: number; winRatePct: number; expectancyR: number };
  };
  dteBuckets: {
    expiryDay: { trades: number; winRatePct: number; expectancyR: number };
    oneDte: { trades: number; winRatePct: number; expectancyR: number };
    twoDte: { trades: number; winRatePct: number; expectancyR: number };
    threeToFiveDte: { trades: number; winRatePct: number; expectancyR: number };
    weekly: { trades: number; winRatePct: number; expectancyR: number };
    monthly: { trades: number; winRatePct: number; expectancyR: number };
  };
  volatilityRegimes: {
    lowIv: { trades: number; winRatePct: number; expectancyR: number };
    normalIv: { trades: number; winRatePct: number; expectancyR: number };
    highIv: { trades: number; winRatePct: number; expectancyR: number };
  };
  liquidityProfiles: {
    highOi: { trades: number; winRatePct: number; expectancyR: number };
    lowLiquidity: { trades: number; winRatePct: number; expectancyR: number };
  };
}

// -------------------------------------------------------------
// 6. PAPER MINIMUM OBSERVATION & DECAY TRACKING
// -------------------------------------------------------------
export interface MinimumObservationConfig {
  minSignals: number;          // Default 50
  minTrades: number;            // Default 30
  minTradingDays: number;       // Default 14
  minMarketSessions: number;    // Default 20
  minRegimesObserved: number;   // Default 3 distinct regimes with >= 5 trades
}

export interface PaperObservationStatus {
  currentSignals: number;
  currentTrades: number;
  currentTradingDays: number;
  currentMarketSessions: number;
  distinctRegimesObserved: number;
  requirementsMet: boolean;
  unmetRequirements: string[];
}

export interface PaperVsBacktestDecayMetrics {
  instrument: string;
  market: MarketType;
  backtestTrades: number;
  paperTrades: number;
  backtestWinRatePct: number;
  paperWinRatePct: number;
  winRateDelta: number;         // paper - backtest
  backtestExpectancyR: number;
  paperExpectancyR: number;
  expectancyDelta: number;      // paper - backtest
  backtestAvgR: number;
  paperAvgR: number;
  avgRDelta: number;
  avgSpreadBacktest: number;
  avgSpreadPaper: number;
  spreadDelta: number;
  avgSlippageBacktest: number;
  avgSlippagePaper: number;
  slippageDelta: number;
  avgExecutionDelayMs: number;
  signalFrequencyDeltaPct: number;
  calibrationDelta: number;
  isDivergenceAcceptable: boolean;
  deteriorationWarning: boolean;
}

// -------------------------------------------------------------
// 7. PROMOTION EVIDENCE PACKAGE
// -------------------------------------------------------------
export interface PromotionEvidencePackage {
  id: string;
  requestId: string;
  strategyId: string;
  strategyVersion: string;
  modelId: string;
  modelVersion: string;
  datasetVersion: string;
  featureVersion: string;
  market: MarketType;
  instrument: string;
  timeframe: string;
  targetEnvironment: TradingEnvironment;
  createdAt: number;

  // Time Horizons
  trainingPeriod: { start: string; end: string; candleCount: number };
  validationPeriod: { start: string; end: string; candleCount: number };
  testPeriod: { start: string; end: string; candleCount: number };

  // Core Quantitative Performance
  walkForwardResults: {
    foldsCount: number;
    oosWinRatePct: number;
    oosExpectancyR: number;
    oosProfitFactor: number;
    isPassed: boolean;
  };
  backtestResults: {
    tradesCount: number;
    winRatePct: number;
    expectancyR: number;
    profitFactor: number;
    maxDrawdownPct: number;
    netPnl: number;
    totalCostsPaid: number;
  };
  paperResults: {
    tradesCount: number;
    winRatePct: number;
    expectancyR: number;
    profitFactor: number;
    maxDrawdownPct: number;
    netPnl: number;
    totalSlippagePaid: number;
  };

  // Sample Size & Confidence
  sampleSafety: SampleSizeSafety;
  winRateConfidenceInterval: ConfidenceInterval;
  expectancyConfidenceInterval: ConfidenceInterval;

  // Calibration & Drift
  calibration: ModelCalibrationSummary;
  psiValue: number;
  psiStatus: 'STABLE' | 'MODERATE_DRIFT' | 'SIGNIFICANT_DRIFT';
  featureDriftSummary: {
    featuresTracked: number;
    driftedFeaturesCount: number;
    topDriftedFeatures: Array<{ featureName: string; psi: number }>;
  };

  // Robustness
  regimePerformance: RegimePerformanceMetrics[];
  sessionPerformance: SessionPerformanceMetrics[];
  optionsRobustness?: OptionsRobustnessAnalysis;

  // Costs, Slippage & Risk
  costAndSlippageAnalysis: {
    averageSpreadCost: number;
    averageSlippageCost: number;
    averageCommissionCost: number;
    netRealizedVsExpectedPnlRatio: number;
  };
  monteCarloResults: {
    iterations: number;
    var95Pct: number;
    var99Pct: number;
    cvar95Pct: number;
    p95MaxDrawdownPct: number;
    probabilityOfRuinPct: number;
  };

  // Decay & Minimum Observations
  decayMetrics: PaperVsBacktestDecayMetrics;
  observationStatus: PaperObservationStatus;

  // Operator Decision Tracking
  operatorReview: {
    reviewedBy?: string;
    reviewedAt?: number;
    status: PromotionStatus;
    decisionReason?: string;
    conditionsApproved?: string[];
  };
}

export interface PromotionRequest {
  id: string;
  strategyId: string;
  strategyVersion: string;
  modelId: string;
  modelVersion: string;
  market: MarketType;
  instrument: string;
  fromStage: StrategyLifecycleState | ModelLifecycleState;
  toStage: StrategyLifecycleState | ModelLifecycleState;
  requestedBy: string;
  requestedAt: number;
  status: PromotionStatus;
  evidencePackageId: string;
  notes?: string;
}

// -------------------------------------------------------------
// 8. PRODUCTION READINESS SCORECARD GATES (9 INDEPENDENT GATES)
// -------------------------------------------------------------
export type ReadinessGateStatus = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA' | 'NOT_TESTED';

export interface ProductionReadinessGate {
  gateId: 'DATA' | 'MODEL' | 'STRATEGY' | 'RISK' | 'EXECUTION' | 'CALIBRATION' | 'DRIFT' | 'PAPER' | 'DEMO';
  gateName: string;
  status: ReadinessGateStatus;
  description: string;
  criteria: Array<{
    criterion: string;
    expected: string;
    actual: string;
    passed: boolean;
    isMandatory: boolean;
  }>;
  evaluatedAt: number;
}

export interface ProductionReadinessScorecard {
  evaluatedAt: number;
  overallReadiness: 'READY_FOR_CONTROLLED_DEMO' | 'NOT_READY' | 'INSUFFICIENT_EVALUATION';
  liveAutoExecutionAllowed: false; // STRICT REQUIREMENT: MUST REMAIN FALSE
  gates: Record<'DATA' | 'MODEL' | 'STRATEGY' | 'RISK' | 'EXECUTION' | 'CALIBRATION' | 'DRIFT' | 'PAPER' | 'DEMO', ProductionReadinessGate>;
  passingGatesCount: number;
  failingGatesCount: number;
  insufficientDataCount: number;
  untestedCount: number;
  blockers: string[];
}

// -------------------------------------------------------------
// 9. SIGNAL FUNNEL & REJECTION ANALYTICS
// -------------------------------------------------------------
export type SignalFunnelStage =
  | 'MARKET_DATA'
  | 'VALID_DATA'
  | 'TECHNICAL_SETUP'
  | 'DETERMINISTIC_SIGNAL'
  | 'ML_PREDICTION'
  | 'FUSION_QUALIFICATION'
  | 'RISK_APPROVAL'
  | 'PAPER_EXECUTION'
  | 'OUTCOME';

export interface SignalFunnelMetrics {
  marketDataEvents: number;
  validDataEvents: number;
  technicalSetupsFound: number;
  deterministicSignalsGenerated: number;
  mlPredictionsGenerated: number;
  fusionSignalsQualified: number;
  riskApprovedSignals: number;
  paperExecutionsDispatched: number;
  targetHitOutcomes: number;
  stopHitOutcomes: number;
  conversionRates: {
    marketDataToValidDataPct: number;
    validDataToTechnicalSetupPct: number;
    setupToDeterministicPct: number;
    deterministicToFusedPct: number;
    fusedToRiskApprovedPct: number;
    riskApprovedToExecutedPct: number;
    executedToTargetFirstPct: number;
  };
}

export type RejectionReason =
  | 'WEAK_TREND'
  | 'POOR_RR'
  | 'HIGH_SPREAD'
  | 'STALE_QUOTE'
  | 'TIMEFRAME_CONFLICT'
  | 'ML_PREDICTION_CONFLICT'
  | 'RISK_LIMIT_EXCEEDED'
  | 'DUPLICATE_POSITION'
  | 'INVALID_GEOMETRY'
  | 'DATA_QUALITY_ISSUE'
  | 'OUTSIDE_SESSION'
  | 'KILL_SWITCH_ACTIVE'
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'INSUFFICIENT_MARGIN';

export interface RejectionAnalyticsItem {
  reason: RejectionReason;
  count: number;
  percentageOfTotalRejections: number;
  sampleInstruments: string[];
  lastOccurredAt: number;
}

// -------------------------------------------------------------
// 10. RECONCILIATION TYPES (POSITION & ORDER)
// -------------------------------------------------------------
export type ReconciliationMismatchType =
  | 'MISSING_IN_BROKER'
  | 'UNEXPECTED_IN_BROKER'
  | 'QUANTITY_MISMATCH'
  | 'PRICE_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'PARTIAL_FILL'
  | 'DUPLICATE_ORDER';

export interface PositionReconciliationItem {
  instrument: string;
  internalPosition?: {
    id: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    status: string;
  };
  brokerPosition?: {
    id: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    status: string;
  };
  mismatchType?: ReconciliationMismatchType;
  isMatched: boolean;
  discrepancyNotes?: string;
}

export interface PositionReconciliationReport {
  reconciledAt: number;
  broker: BrokerType;
  environment: TradingEnvironment;
  totalPositionsEvaluated: number;
  matchedCount: number;
  mismatchedCount: number;
  items: PositionReconciliationItem[];
  status: 'CLEAN' | 'DISCREPANCY_DETECTED' | 'CRITICAL_ERROR';
}

export interface OrderReconciliationItem {
  orderId: string;
  clientOrderId?: string;
  instrument: string;
  internalState?: { status: string; filledQty: number; avgPrice?: number };
  brokerState?: { status: string; filledQty: number; avgPrice?: number };
  mismatchType?: ReconciliationMismatchType;
  isMatched: boolean;
  notes?: string;
}

export interface OrderReconciliationReport {
  reconciledAt: number;
  broker: BrokerType;
  environment: TradingEnvironment;
  totalOrdersEvaluated: number;
  matchedCount: number;
  mismatchedCount: number;
  items: OrderReconciliationItem[];
  status: 'CLEAN' | 'DISCREPANCY_DETECTED' | 'CRITICAL_ERROR';
}

// -------------------------------------------------------------
// 11. DEMO READINESS & CONTROLLED DEMO WORKFLOW
// -------------------------------------------------------------
export interface DemoReadinessCheckItem {
  checkId: string;
  name: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
}

export interface DemoReadinessCheckReport {
  checkedAt: number;
  broker: BrokerType;
  overallStatus: 'READY' | 'NOT_READY' | 'DEGRADED';
  checks: DemoReadinessCheckItem[];
}

export interface ControlledDemoTestRun {
  testId: string;
  startedAt: number;
  completedAt?: number;
  instrument: string;
  market: MarketType;
  steps: Array<{
    step: 'MARKET_DATA' | 'SIGNAL_GEN' | 'RISK_VAL' | 'ORDER_CONST' | 'DEMO_BROKER' | 'POSITION_MON' | 'EXIT' | 'FIREBASE_LOG';
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    timestamp: number;
    details: string;
  }>;
  overallResult: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
  errorMessage?: string;
}

// -------------------------------------------------------------
// 12. CHAMPION / CHALLENGER & SHADOW MODE
// -------------------------------------------------------------
export interface ChampionChallengerPair {
  id: string;
  market: MarketType;
  instrument: string;
  championModelId: string;
  championModelVersion: string;
  challengerModelId: string;
  challengerModelVersion: string;
  pairedAt: number;
  metrics: {
    championWinRatePct: number;
    challengerWinRatePct: number;
    championExpectancyR: number;
    challengerExpectancyR: number;
    championBrierScore: number;
    challengerBrierScore: number;
    championDrawdownPct: number;
    challengerDrawdownPct: number;
    sampleTradesCount: number;
  };
  recommendation: 'RETAIN_CHAMPION' | 'CONSIDER_CHALLENGER_PROMOTION' | 'INSUFFICIENT_OBSERVATION';
}

export interface ShadowPredictionRecord {
  id: string;
  modelId: string;
  modelVersion: string;
  instrument: string;
  market: MarketType;
  timestamp: number;
  predictedProbability: number;
  realizedOutcome?: 1 | 0;
  isShadowOnly: true;
}

// -------------------------------------------------------------
// 13. IMMUTABLE AUDIT LOG & MANUAL OVERRIDE
// -------------------------------------------------------------
export type AuditEventCategory =
  | 'AUTHENTICATION'
  | 'ACCOUNT'
  | 'MARKET_DATA'
  | 'OPTIONS_DATA'
  | 'SIGNAL'
  | 'MODEL'
  | 'RISK'
  | 'ORDER'
  | 'POSITION'
  | 'RECONCILIATION'
  | 'FIRESTORE'
  | 'CONFIGURATION'
  | 'SECURITY'
  | 'SAFETY'
  | 'PREDICTION'
  | 'RISK_DECISION'
  | 'ORDER_REJECTION'
  | 'EXIT'
  | 'ENVIRONMENT_CHANGE'
  | 'MODEL_PROMOTION'
  | 'STRATEGY_PROMOTION'
  | 'KILL_SWITCH'
  | 'MANUAL_OVERRIDE'
  | 'CONFIG_CHANGE';

export interface ImmutableAuditEvent {
  sequenceNumber: number;
  eventId: string;
  timestamp: number;
  category: AuditEventCategory;
  action: string;
  environment: TradingEnvironment;
  operatorId: string;
  payload: Record<string, any>;
  previousHash: string;
  currentHash: string;
}

export interface ManualOverrideRequest {
  action: string;
  operatorId: string;
  confirmed: boolean;
  reason: string;
  parameters: Record<string, any>;
  timestamp: number;
}

// -------------------------------------------------------------
// 14. INTERNAL NOTIFICATION & SYSTEM HEALTH
// -------------------------------------------------------------
export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';

export interface InternalSystemAlert {
  id: string;
  timestamp: number;
  severity: NotificationSeverity;
  source: 'DATA' | 'BROKER' | 'MODEL' | 'STRATEGY' | 'RISK' | 'KILL_SWITCH';
  title: string;
  message: string;
  isAcknowledged: boolean;
}

export interface TradingOperationsStatus {
  timestamp: number;
  environment: TradingEnvironment;
  selectedBroker: BrokerType;
  globalState: GlobalSystemState;
  marketDataStatus: 'CONNECTED' | 'STALE' | 'DISCONNECTED';
  signalEngineStatus: 'ACTIVE' | 'PAUSED' | 'DEGRADED';
  mlEngineStatus: 'HEALTHY' | 'DEGRADED' | 'DISABLED';
  paperEngineStatus: 'ACTIVE' | 'ERROR';
  riskEngineStatus: 'PROTECTED' | 'LOCKED' | 'HALTED';
  safetyGateStatus: 'ARMED' | 'TRIPPED';
  killSwitchStatus: 'NORMAL' | 'HALTED';
  dataQualityStatus: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
  systemHealthSummary: string;
  activeAlerts: InternalSystemAlert[];
}
