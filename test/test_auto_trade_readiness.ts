import assert from 'node:assert/strict';
import { autoTradeReadinessService } from '../src/brokers/safety/AutoTradeReadiness';
import { getSystemConfig } from '../src/services/configService';

const config = getSystemConfig();

assert.equal(config.maxDailyLossPct, 3);
assert.equal(config.maxOpenPositions, 5);
assert.equal(config.maxTradesPerDay, 20);
assert.equal(config.maxConsecutiveLosses, 3);
assert.equal(config.maxSpreadBps, 30);
assert.equal(config.signalCooldownMs, 60000);

const blockedReport = {
  state: 'BLOCKED' as const,
  ready: false,
  evaluatedAt: Date.now(),
  checks: { strategyCalibrated: false },
  metrics: {
    dailyLoss: 0,
    dailyLossLimit: 100,
    activePositions: 0,
    maxOpenPositions: 5,
    tradesToday: 0,
    maxTradesPerDay: 20,
    consecutiveLosses: 0,
    maxConsecutiveLosses: 3,
    spreadBps: null,
    maxSpreadBps: 30,
    signalAgeMs: 1000,
    signalMaxAgeMs: 300000
  },
  failedReasons: ['Strategy/model is still marked uncalibrated.']
};

const armBlocked = await autoTradeReadinessService.arm(blockedReport);
assert.equal(armBlocked.ready, false);
assert.equal(armBlocked.state, 'BLOCKED');
assert.match(armBlocked.failedReasons.join(' '), /uncalibrated/i);

const readyReport = {
  ...blockedReport,
  state: 'OFF' as const,
  ready: true,
  checks: { strategyCalibrated: true },
  failedReasons: []
};

const armed = await autoTradeReadinessService.arm(readyReport);
assert.equal(armed.ready, true);
assert.equal(armed.state, 'ARMED');
assert.equal(autoTradeReadinessService.getState(), 'ARMED');

const disarmed = autoTradeReadinessService.disarm();
assert.equal(disarmed?.state, 'OFF');
assert.equal(disarmed?.ready, false);
assert.equal(autoTradeReadinessService.getState(), 'OFF');

console.log('AUTO-TRADE READINESS TESTS PASSED');
