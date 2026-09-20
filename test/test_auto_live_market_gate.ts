import assert from 'node:assert/strict';
import { getAutoLiveMarketGate } from '../src/services/marketOpenGate';

// Sunday 12:00 UTC: Forex is in the weekend closure and NSE is closed.
const weekend = getAutoLiveMarketGate(new Date('2026-09-20T12:00:00.000Z'));
assert.equal(weekend.forex.isOpen, false);
assert.equal(weekend.india.isOpen, false);
assert.equal(weekend.anyMarketOpen, false);
assert.equal(weekend.bothMarketsClosed, true);

// Monday 12:00 UTC / 17:30 IST: both supported market sessions are open.
const weekday = getAutoLiveMarketGate(new Date('2026-09-21T12:00:00.000Z'));
assert.equal(weekday.forex.isOpen, true);
assert.equal(weekday.india.isOpen, true);
assert.equal(weekday.anyMarketOpen, true);
assert.equal(weekday.bothMarketsClosed, false);

console.log('AUTO LIVE MARKET OPEN GATE TEST PASSED');
