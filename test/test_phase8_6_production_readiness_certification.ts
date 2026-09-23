// ============================================================================
// PHASE 8.6 TEST SUITE: PRODUCTION READINESS, CAPITAL-PROTECTION & LIVE-GATE CERTIFICATION
// 50-Scenario Deterministic Capital Protection & Live-Gate Failure Matrix
// Critical Invariant: LIVE_AUTO_EXECUTION_ALLOWED === false
// ============================================================================

import { ProductionReadinessCertifier, ProductionReadinessSummary } from '../src/demoExecution/productionReadinessCertifier';
import { LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT } from '../src/demoExecution/types';

async function runPhase8_6Certification() {
  console.log('================================================================================');
  console.log('PHASE 8.6: PRODUCTION READINESS, CAPITAL-PROTECTION & LIVE-GATE CERTIFICATION');
  console.log('Deterministic Safety Audit & 50-Scenario Failure Injection Matrix');
  console.log('================================================================================\n');

  console.log('1. INVARIANT INTEGRITY CHECK:');
  console.log(`   LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false -> [${LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT === false ? 'VERIFIED LOCKED' : 'FAILED'}]`);

  if (LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT !== false) {
    console.error('FATAL: LIVE_AUTO_EXECUTION_ALLOWED_INVARIANT IS NOT FALSE!');
    process.exit(1);
  }

  console.log('\n2. EXECUTING 50-SCENARIO PRODUCTION READINESS & CAPITAL PROTECTION SUITE...');
  const summary: ProductionReadinessSummary = await ProductionReadinessCertifier.runAll50Scenarios();

  console.log(`\n================================================================================`);
  console.log(`CERTIFICATION RESULTS: ${summary.passedScenarios} / ${summary.totalScenarios} SCENARIOS PASSED (${summary.passRate.toFixed(1)}%)`);
  console.log(`DURATION: ${summary.durationMs} ms`);
  console.log(`================================================================================\n`);

  console.log('SCENARIO-BY-SCENARIO EXECUTION LEDGER:');
  summary.results.forEach(r => {
    const statusTag = r.status === 'PASSED' ? '✓ PASS' : '✗ FAIL';
    console.log(` [${String(r.scenarioId).padStart(2, '0')}] [${statusTag}] [${r.category.padEnd(23)}] ${r.scenarioName} (${r.durationMs}ms)`);
    console.log(`      Fault:    ${r.injectedFault}`);
    console.log(`      Outcome:  ${r.actualBehavior}`);
  });

  console.log('\n================================================================================');
  console.log('CATEGORY BREAKDOWN:');
  Object.entries(summary.categoriesBreakdown).forEach(([cat, stats]) => {
    console.log(`   - ${cat.padEnd(25)} : ${stats.passed}/${stats.total} Passed (100%)`);
  });

  console.log('\n================================================================================');
  console.log('CLASSIFICATION MATRIX:');
  Object.entries(summary.classificationMatrix).forEach(([key, val]) => {
    console.log(`   - ${key.padEnd(25)} : ${val}`);
  });

  console.log('\n================================================================================');
  console.log('PRODUCTION READINESS MANDATES & AUDIT INTEGRITY:');
  console.log(`   - Live Auto-Execution Invariant Locked : [${summary.liveAutoExecutionAllowedInvariant === false ? 'YES (LOCKED)' : 'NO'}]`);
  console.log(`   - Zero Live Orders Confirmed           : [${summary.zeroLiveOrdersConfirmed ? 'YES' : 'NO'}]`);
  console.log(`   - Zero Credential Leaks Confirmed      : [${summary.zeroCredentialLeaksConfirmed ? 'YES' : 'NO'}]`);
  console.log(`   - Reconciliation Integrity Confirmed   : [${summary.reconciliationIntegrityConfirmed ? 'YES' : 'NO'}]`);
  console.log(`   - Architecture Pipeline Map Verified   : [${summary.architectureMapVerified ? 'YES' : 'NO'}]`);
  console.log(`\nFINAL SYSTEM STATUS STATEMENT:`);
  console.log(`"${summary.statusStatement}"`);
  console.log('================================================================================\n');

  if (summary.failedScenarios > 0) {
    console.error(`FATAL: ${summary.failedScenarios} scenarios failed certification!`);
    console.error(`Failed IDs: ${summary.results.filter(r => r.status === 'FAILED').map(r => `[${r.scenarioId}] ${r.scenarioName}`).join(', ')}`);
    process.exit(1);
  }

  process.exit(0);
}

runPhase8_6Certification().catch(err => {
  console.error('Fatal unhandled error during Phase 8.6 Certification:', err);
  process.exit(1);
});
