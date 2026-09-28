import assert from 'node:assert/strict';
import { getAutoLiveMarketGate } from '../src/services/marketOpenGate';

const weekend = getAutoLiveMarketGate(new Date('2026-09-20T12:00:00.000Z'));
assert.equal(weekend.forex.isOpen, false);
assert.equal(weekend.anyMarketOpen, false);
assert.equal(weekend.bothMarketsClosed, true);

const weekday = getAutoLiveMarketGate(new Date('2026-09-21T09:30:00.000Z'));
assert.equal(weekday.forex.isOpen, true);
assert.equal(weekday.anyMarketOpen, true);
assert.equal(weekday.bothMarketsClosed, false);

console.log('AUTO LIVE FOREX MARKET OPEN GATE TEST PASSED');
