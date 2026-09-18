// ============================================================================
// PHASE 6: CONTROLLED DEMO EXECUTION & REAL-TIME BROKER VALIDATION TYPES
// ============================================================================

import * as BrokerTypes from '../brokers/types.ts';
type BrokerType = BrokerTypes.BrokerType;
type TradingEnvironment = BrokerTypes.TradingEnvironment;
import * as MarketTypes from '../markets/common/types.ts';
type MarketType = MarketTypes.MarketType;

// Hard Invariant constant (Phase 6 mandate)
export const LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT = false;

export type DemoExecutionMode = 'DEMO_MANUAL' | 'DEMO_ARMED' | 'DEMO_AUTO';

export type DemoReadinessState =
  | 'NOT_READY'
  | 'READY_FOR_MANUAL_DEMO'
  | 'READY_FOR_ARMED_DEMO'
  | 'READY_FOR_AUTO_DEMO'
  | 'BLOCKED';

export type DemoOrderStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'CLOSED';

export type ExitReason =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT_1'
  | 'TAKE_PROFIT_2'
  | 'TAKE_PROFIT_3'
  | 'STRATEGY_EXIT'
  | 'TIME_EXIT'
  | 'MANUAL_EXIT'
  | 'RISK_EXIT'
  | 'EMERGENCY_EXIT'
  | 'BROKER_TRIGGERED'
  | 'SESSION_CLOSE'
  | 'TRAILING_STOP';

export interface OrderFill {
  fillId: string;
  orderId: string;
  clientOrderId: string;
  fillTimestamp: number;
  filledQuantity: number;
  fillPrice: number;
  slippagePipsOrPoints: number;
  liquidityRole: 'MAKER' | 'TAKER';
  fee: number;
}

export interface ImmutableOrderProposal {
  proposalId: string;
  signalId: string;
  strategyId: string;
  strategyVersion: string;
  modelId: string;
  modelVersion: string;
  market: MarketType | 'FOREX' | 'INDIAN_EQUITY' | 'INDIAN_FUTURES' | 'INDIAN_OPTIONS';
  broker: BrokerType;
  environment: TradingEnvironment;
  symbol: string;
  exchange: string;
  instrumentType: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  quantity: number;
  lotSize: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  takeProfit3?: number;
  riskAmount: number;
  riskPercent: number;
  expectedReward: number;
  riskRewardRatio: number;
  marketPrice: number;
  bid: number;
  ask: number;
  spread: number;
  signalTimestamp: number;
  proposalTimestamp: number;
  quoteTimestamp: number;
  featureSnapshotId: string;
  decisionFusionState: string;
  mlProbability: number;
  deterministicScore: number;
  riskGateResult: 'PASS' | 'FAIL';
  safetyGateResult: 'PASS' | 'FAIL';
  signatureHash: string;
}

export interface PreOrderValidationResult {
  passed: boolean;
  timestamp: number;
  checks: {
    environmentValidation: boolean;
    brokerValidation: boolean;
    marketCompatibility: boolean;
    instrumentValidation: boolean;
    credentialValidation: boolean;
    marketDataFreshness: boolean;
    quoteFreshness: boolean;
    spreadThreshold: boolean;
    tradingSession: boolean;
    signalValidity: boolean;
    entryGeometry: boolean;
    stopLossGeometry: boolean;
    takeProfitGeometry: boolean;
    riskReward: boolean;
    quantityRules: boolean;
    lotSizeRules: boolean;
    marginAvailability: boolean;
    maximumPositionLimit: boolean;
    maximumExposure: boolean;
    duplicatePositionProtection: boolean;
    dailyLossLimit: boolean;
    strategyStatus: boolean;
    modelStatus: boolean;
    killSwitchStatus: boolean;
    brokerConnectivity: boolean;
  };
  rejectionReasons: string[];
}

export interface DemoOrder {
  orderId: string;
  clientOrderId: string;
  brokerOrderId?: string;
  proposalId: string;
  signalId: string;
  strategyId: string;
  modelId: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  requestedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  limitPrice?: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  averageFillPrice?: number;
  status: DemoOrderStatus;
  fills: OrderFill[];
  createdAt: number;
  submittedAt?: number;
  acknowledgedAt?: number;
  filledAt?: number;
  closedAt?: number;
  rejectCode?: string;
  rejectMessage?: string;
  latencies: {
    signalToOrderMs: number;
    submissionMs: number;
    brokerAckMs: number;
    fillMs: number;
    totalMs: number;
  };
  executionQuality: {
    expectedPrice: number;
    actualPrice: number;
    slippage: number;
    spread: number;
    priceImprovement: number;
    isAdverse: boolean;
  };
}

export interface DemoPosition {
  positionId: string;
  brokerPositionId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  market: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  side: 'BUY' | 'SELL';
  initialQuantity: number;
  currentQuantity: number;
  averageEntryPrice: number;
  currentMarketPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  takeProfit3?: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  breakevenMoved: boolean;
  trailingStopActive: boolean;
  trailingStopDistance?: number;
  trailingStopHighWaterMark?: number;
  maximumFavorableExcursion: number; // MFE (pips/points)
  maximumAdverseExcursion: number;  // MAE (pips/points)
  openedAt: number;
  lastUpdatedAt: number;
  closedAt?: number;
  holdingTimeMs: number;
  strategyId: string;
  modelId: string;
  signalId: string;
  protectionStatus: 'HEALTHY' | 'PROTECTION_FAILURE';
  status: 'OPEN' | 'PARTIALLY_CLOSED' | 'CLOSED';
  events: Array<{
    timestamp: number;
    type: string;
    description: string;
    price: number;
    quantity?: number;
    pnl?: number;
  }>;
}

export interface StrategyArmingConfig {
  strategyId: string;
  modelId: string;
  market: string;
  instrument: string;
  maxTrades: number;
  maxExposure: number;
  maxDailyLoss: number;
  expirationTimestamp: number;
  isArmed: boolean;
  armedAt?: number;
  tradesExecuted: number;
  currentDailyLoss: number;
  autoDisarmReason?: string;
}

export interface SignalToOrderTrace {
  traceId: string;
  signalId: string;
  marketDataSnapshotId: string;
  featureSnapshotId: string;
  deterministicAnalysisId: string;
  mlPredictionId: string;
  decisionFusionState: string;
  riskDecisionId: string;
  orderProposalId: string;
  brokerOrderId?: string;
  fillIds: string[];
  positionId?: string;
  exitIds: string[];
  tradeOutcomeId?: string;
  researchRecordId: string;
  datasetVersion: string;
  strategyVersion: string;
  modelVersion: string;
  timestamp: number;
}

export interface CorrelatedExposureGroup {
  groupName: string;
  instruments: string[];
  currentExposure: number;
  maxExposureLimit: number;
  openPositionsCount: number;
  utilizationPct: number;
}

export interface DemoTestCenterTestResult {
  testId: number;
  testName: string;
  category: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_TESTED';
  durationMs: number;
  description: string;
  details: string;
  timestamp: number;
}

export interface FailureRecoveryTestResult {
  scenarioId: string;
  scenarioName: string;
  expectedBehavior: string;
  actualOutcome: string;
  status: 'PASSED' | 'FAILED';
  recoveryDurationMs: number;
  details: string;
}

export interface PaperVsDemoComparisonItem {
  signalId: string;
  instrument: string;
  market: string;
  timestamp: number;
  expectedEntry: number;
  paperEntry: number;
  demoEntry: number;
  expectedSL: number;
  expectedTP: number;
  paperSlippage: number;
  demoSlippage: number;
  paperSpread: number;
  demoSpread: number;
  paperLatencyMs: number;
  demoLatencyMs: number;
  paperPnl: number;
  demoPnl: number;
  executionOutcome: 'IDENTICAL' | 'DEMO_SLIGHT_DECAY' | 'DEMO_BETTER_FILL' | 'REJECTED';
}
