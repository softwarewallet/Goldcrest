import assert from 'node:assert/strict';
import { autoTradingService } from '../src/services/autoTradingService';
import { LIVE_AUTO_EXECUTION_ALLOWED, refreshAutonomousExecutionPermission } from '../src/brokers/safety/AutoExecutionEngine';

const originalAuto = process.env.GOLDCREST_AUTO_TRADING_ENABLED;
const originalLiveAuto = process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;

delete process.env.GOLDCREST_AUTO_TRADING_ENABLED;
delete process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;

assert.equal(refreshAutonomousExecutionPermission(), false);
assert.equal(LIVE_AUTO_EXECUTION_ALLOWED, false);

const status = autoTradingService.start();
assert.equal(status.state, 'BLOCKED');
assert.equal(status.enabledByEnvironment, false);
assert.match(status.lastCycleResult || '', /Autonomous execution is not enabled|production strategy has not been explicitly approved/i);

autoTradingService.stop();

if (originalAuto === undefined) delete process.env.GOLDCREST_AUTO_TRADING_ENABLED;
else process.env.GOLDCREST_AUTO_TRADING_ENABLED = originalAuto;
if (originalLiveAuto === undefined) delete process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION;
else process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = originalLiveAuto;

console.log('AUTO-TRADING ORCHESTRATOR SAFETY TEST PASSED');
