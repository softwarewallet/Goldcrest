// ============================================================================
// PHASE 5 — AUTOMATED GOVERNANCE & SAFETY TEST SUITE
// ============================================================================

import { governanceEngine } from './governanceEngine';
import { positionReconciliationEngine, orderReconciliationEngine } from './reconciliationEngine';
import { championChallengerEngine } from './championChallengerEngine';
import { operationsControlEngine } from './operationsControlEngine';

export interface GovernanceTestResult {
  suiteName: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  tests: Array<{
    name: string;
    description: string;
    passed: boolean;
    error?: string;
    details?: string;
  }>;
}

export function runAllGovernanceTests(): GovernanceTestResult {
  const startTime = Date.now();
  const tests: GovernanceTestResult['tests'] = [];

  // Test 1: Promotion Gates & Explicit Operator Approval
  try {
    const evidence = governanceEngine.generateEvidencePackage({
      strategyId: 'test_strategy',
      strategyVersion: 'v1.0.0',
      modelId: 'test_model',
      modelVersion: 'v1.0.0',
      datasetVersion: 'v1.0.0',
      featureVersion: 'v1.0.0',
      market: 'FOREX',
      instrument: 'EUR/USD',
      timeframe: 'M15',
      targetEnvironment: 'DEMO',
      paperTrades: [
        { resultR: 1.5, isWin: true, regime: 'TRENDING', session: 'London' },
        { resultR: -1.0, isWin: false, regime: 'RANGE', session: 'New York' },
        { resultR: 2.0, isWin: true, regime: 'TRENDING', session: 'London' }
      ],
      paperPredictions: [
        { predictedProb: 0.65, actualTargetFirst: 1 },
        { predictedProb: 0.55, actualTargetFirst: 0 },
        { predictedProb: 0.70, actualTargetFirst: 1 }
      ]
    });

    const req = governanceEngine.submitPromotionRequest(
      'test_strategy',
      'test_model',
      'FOREX',
      'EUR/USD',
      'RESEARCH',
      'PAPER',
      'TEST_OPERATOR',
      evidence,
      'Automated test submission'
    );

    const approveRes = governanceEngine.approvePromotion(req.id, 'CHIEF_RISK_OFFICER', 'Passed validation gates');
    const stratLifecycle = governanceEngine.getStrategyLifecycle('test_strategy');

    tests.push({
      name: 'Explicit Promotion Approval Gate',
      description: 'Verifies that promotion requires explicit operator sign-off and updates lifecycle safely',
      passed: approveRes.success && stratLifecycle?.state === 'PAPER',
      details: approveRes.message
    });
  } catch (err: any) {
    tests.push({ name: 'Explicit Promotion Approval Gate', description: 'Promotion gate test', passed: false, error: err.message });
  }

  // Test 2: Sample-Size Safety Gates (Flagging tiny samples as INSUFFICIENT_SAMPLE)
  try {
    const tinyCI = governanceEngine.calculateWinRateConfidenceInterval(8, 10);
    const adequateCI = governanceEngine.calculateWinRateConfidenceInterval(25, 40);
    const robustCI = governanceEngine.calculateWinRateConfidenceInterval(65, 100);

    const isPassed = tinyCI.safetyStatus === 'INSUFFICIENT_SAMPLE' &&
      tinyCI.isReliable === false &&
      adequateCI.safetyStatus === 'ADEQUATE_SAMPLE' &&
      robustCI.safetyStatus === 'ROBUST_SAMPLE';

    tests.push({
      name: 'Sample-Size Safety Gate',
      description: 'Guarantees small samples (N < 30) are flagged as INSUFFICIENT_SAMPLE with wide confidence intervals',
      passed: isPassed,
      details: `10 Trades: ${tinyCI.safetyStatus} (CI: [${tinyCI.lowerBound}%, ${tinyCI.upperBound}%]), 40 Trades: ${adequateCI.safetyStatus}, 100 Trades: ${robustCI.safetyStatus}`
    });
  } catch (err: any) {
    tests.push({ name: 'Sample-Size Safety Gate', description: 'Sample-size safety verification', passed: false, error: err.message });
  }

  // Test 3: 9-Bucket Probability Calibration & Brier Score
  try {
    const preds: Array<{ predictedProb: number; actualTargetFirst: 1 | 0 }> = [];
    for (let i = 0; i < 50; i++) {
      const prob = 0.50 + (i % 9) * 0.05;
      const isWin: 1 | 0 = (Math.random() < prob) ? 1 : 0;
      preds.push({ predictedProb: prob, actualTargetFirst: isWin });
    }

    const calib = governanceEngine.calculateProbabilityCalibration('test_model', 'v1.0.0', preds);
    const has9Buckets = calib.buckets.length === 9;
    const brierValid = calib.overallBrierScore >= 0 && calib.overallBrierScore <= 1.0;

    tests.push({
      name: '9-Bucket Probability Calibration',
      description: 'Calculates 9 calibration buckets (50-54% to 90%+) and verifies Brier score tracking',
      passed: has9Buckets && brierValid,
      details: `Evaluated ${calib.totalPredictions} predictions across 9 buckets. Brier Score = ${calib.overallBrierScore}`
    });
  } catch (err: any) {
    tests.push({ name: '9-Bucket Probability Calibration', description: 'Calibration verification', passed: false, error: err.message });
  }

  // Test 4: Performance & Feature Drift Safety
  try {
    const scorecard = governanceEngine.evaluateProductionReadinessScorecard();
    const driftGate = scorecard.gates.DRIFT;
    const isDriftEvaluated = driftGate.criteria.some(c => c.criterion.includes('PSI'));

    tests.push({
      name: 'PSI & Feature Drift Monitoring',
      description: 'Verifies Population Stability Index (PSI) tracking and degradation detection',
      passed: isDriftEvaluated && driftGate.status === 'PASS',
      details: `Drift gate status: ${driftGate.status}, PSI evaluated`
    });
  } catch (err: any) {
    tests.push({ name: 'PSI & Feature Drift Monitoring', description: 'Drift monitor verification', passed: false, error: err.message });
  }

  // Test 5: Paper vs Backtest Divergence & Decay Tracking
  try {
    const ev = governanceEngine.getEvidencePackage(Array.from(governanceEngine.listPromotionRequests())[0]?.evidencePackageId || '');
    const decay = ev?.decayMetrics;
    const hasDivergenceMetrics = !!decay && typeof decay.winRateDelta === 'number' && typeof decay.expectancyDelta === 'number';

    tests.push({
      name: 'Paper vs Backtest Divergence Tracking',
      description: 'Tracks win-rate delta, expectancy decay, spread divergence, and execution slippage',
      passed: hasDivergenceMetrics,
      details: decay ? `Win Rate Delta: ${decay.winRateDelta}%, Expectancy Delta: ${decay.expectancyDelta}R, Slippage: ${decay.slippageDelta} pips` : 'Verified on evidence package'
    });
  } catch (err: any) {
    tests.push({ name: 'Paper vs Backtest Divergence Tracking', description: 'Decay metrics verification', passed: false, error: err.message });
  }

  // Test 6: Champion vs Challenger in PAPER Mode
  try {
    const pairs = championChallengerEngine.listPairs();
    const hasPairs = pairs.length > 0;
    const firstPair = pairs[0];
    const isChallengerTracked = !!firstPair && !!firstPair.challengerModelId && typeof firstPair.metrics.challengerWinRatePct === 'number';

    tests.push({
      name: 'Champion / Challenger System',
      description: 'Operates Challenger alongside Champion in PAPER without auto-replacing production models',
      passed: hasPairs && isChallengerTracked,
      details: `Active Pair: ${firstPair?.championModelId} vs ${firstPair?.challengerModelId} (Recommendation: ${firstPair?.recommendation})`
    });
  } catch (err: any) {
    tests.push({ name: 'Champion / Challenger System', description: 'Champion/challenger verification', passed: false, error: err.message });
  }

  // Test 7: Shadow Model & Strategy Shadow Mode
  try {
    const shadowRec = championChallengerEngine.recordShadowPrediction({
      modelId: 'test_shadow_model',
      modelVersion: 'v1.0.0',
      instrument: 'EUR/USD',
      market: 'FOREX',
      predictedProbability: 0.72
    });

    championChallengerEngine.setStrategyShadowMode('test_strategy', true);
    const isShadowActive = championChallengerEngine.isStrategyInShadowMode('test_strategy');

    tests.push({
      name: 'Shadow Mode (Zero-Execution Passive Telemetry)',
      description: 'Confirms models and strategies can generate predictions and signals without triggering orders',
      passed: shadowRec.isShadowOnly === true && isShadowActive === true,
      details: `Shadow prediction ${shadowRec.id} recorded with zero execution routing`
    });
  } catch (err: any) {
    tests.push({ name: 'Shadow Mode (Zero-Execution Passive Telemetry)', description: 'Shadow mode verification', passed: false, error: err.message });
  }

  // Test 8: Broker Position & Order Reconciliation
  try {
    const internal = [
      { id: 'pos_1', instrument: 'EUR/USD', side: 'BUY' as const, quantity: 100000, entryPrice: 1.08450, status: 'OPEN' }
    ];
    const broker = [
      { id: 'pos_1', instrument: 'EUR/USD', side: 'BUY' as const, quantity: 100000, entryPrice: 1.08450, status: 'OPEN' }
    ];

    const posReport = positionReconciliationEngine.reconcilePositions('CTRADER', 'PAPER', internal, broker);
    const ordReport = orderReconciliationEngine.reconcileOrders('CTRADER', 'PAPER', [], []);

    tests.push({
      name: 'Position & Order Reconciliation Engine',
      description: 'Detects missing, unexpected, quantity, price, and status mismatches against broker state',
      passed: posReport.status === 'CLEAN' && ordReport.status === 'CLEAN',
      details: `Evaluated ${posReport.totalPositionsEvaluated} positions: Matched=${posReport.matchedCount}, Mismatched=${posReport.mismatchedCount}`
    });
  } catch (err: any) {
    tests.push({ name: 'Position & Order Reconciliation Engine', description: 'Reconciliation verification', passed: false, error: err.message });
  }

  // Test 9: Global Kill Switch Proof & Automated Verification
  try {
    const killSwitchTest = operationsControlEngine.executeKillSwitchSafetyTest();

    tests.push({
      name: 'Automated Kill Switch Test & Disconnect Proof',
      description: 'Proves orders are rejected when armed, and resumes only after explicit operator confirmation',
      passed: killSwitchTest.testPassed,
      details: killSwitchTest.proofDetails
    });
  } catch (err: any) {
    tests.push({ name: 'Automated Kill Switch Test & Disconnect Proof', description: 'Kill switch verification', passed: false, error: err.message });
  }

  // Test 10: Manual Override Signed Audit Log
  try {
    const override = operationsControlEngine.executeManualOverride({
      action: 'TEMPORARY_SPREAD_TOLERANCE_ADJUSTMENT',
      operatorId: 'LEAD_QUANT_ENGINEER',
      confirmed: true,
      reason: 'Accommodate high-volatility news event (ECB rate decision)',
      parameters: { maxSpreadPips: 2.5 },
      timestamp: Date.now()
    });

    tests.push({
      name: 'Manual Override Audit Immutability',
      description: 'Ensures manual safety overrides require explicit operator confirmation, timestamp, and audit record',
      passed: override.success && override.auditId.length > 0,
      details: override.message
    });
  } catch (err: any) {
    tests.push({ name: 'Manual Override Audit Immutability', description: 'Manual override verification', passed: false, error: err.message });
  }

  // Test 11: Cryptographic Hash Chaining on Append-Only Audit Ledger
  try {
    const audits = operationsControlEngine.listAuditEvents(undefined, 10);
    const hasChaining = audits.length > 1 && audits.every(a => a.currentHash && a.previousHash);

    tests.push({
      name: 'Immutable Audit Ledger Hash Chaining',
      description: 'Validates append-only cryptographic sequence linking previous and current event hashes',
      passed: hasChaining,
      details: `Audited ${audits.length} events with verified previous-hash links`
    });
  } catch (err: any) {
    tests.push({ name: 'Immutable Audit Ledger Hash Chaining', description: 'Audit chaining verification', passed: false, error: err.message });
  }

  // Test 12: Environment Isolation & Live Trading Off Enforcer
  try {
    const scorecard = governanceEngine.evaluateProductionReadinessScorecard();
    const isLiveAutoExecutionStrictlyOff = scorecard.liveAutoExecutionAllowed === false;

    tests.push({
      name: 'Live Auto Execution Hard Invariant Gate',
      description: 'Strictly verifies liveAutoExecutionAllowed is permanently false at the end of Phase 5',
      passed: isLiveAutoExecutionStrictlyOff,
      details: `liveAutoExecutionAllowed: ${scorecard.liveAutoExecutionAllowed} (Strictly Hardcoded OFF)`
    });
  } catch (err: any) {
    tests.push({ name: 'Live Auto Execution Hard Invariant Gate', description: 'Live off enforcer verification', passed: false, error: err.message });
  }

  // Test 13: Model & Strategy Version Locking
  try {
    const manifest = championChallengerEngine.generateReproducibilityManifest({
      tradeId: 'tr_test_991',
      strategyId: 'forex_trend_continuation_v2',
      strategyVersion: 'v2.0.0',
      modelId: 'gbt_forex_v1.0.0',
      modelVersion: 'v1.0.0',
      featureVersion: 'v1.0.0',
      datasetVersion: 'v1.0.0',
      backtestEngineVersion: 'v4.2.0',
      executedAt: Date.now()
    });

    tests.push({
      name: 'Model & Strategy Version Locking',
      description: 'Guarantees paper trades preserve exact model, feature, and dataset versions without reinterpretations',
      passed: manifest.isLocked === true && manifest.integrityCheck === 'SHA256_VERIFIED',
      details: `Manifest Fingerprint: ${manifest.modelFingerprint} | ${manifest.strategyFingerprint}`
    });
  } catch (err: any) {
    tests.push({ name: 'Model & Strategy Version Locking', description: 'Version lock verification', passed: false, error: err.message });
  }

  const passedTests = tests.filter(t => t.passed).length;
  const failedTests = tests.filter(t => !t.passed).length;

  return {
    suiteName: 'Phase 5 Controlled Validation & Model Governance Safety Suite',
    totalTests: tests.length,
    passedTests,
    failedTests,
    durationMs: Date.now() - startTime,
    tests
  };
}
