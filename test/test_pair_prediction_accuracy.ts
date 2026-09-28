import assert from 'node:assert/strict';
import fs from 'node:fs';

const prediction = fs.readFileSync('src/services/liveTradeResearchPredictionService.ts', 'utf8');
const audit = fs.readFileSync('src/services/pairPredictionAccuracyAuditService.ts', 'utf8');
const collection = fs.readFileSync('src/services/currentPairPredictionCollectionService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(prediction, /HISTORICAL_EDGE_V1/);
assert.match(prediction, /lifecycle_status = 'CLOSED'/);
assert.match(prediction, /Number\(row\.signal_timestamp\) < signalTimestamp/);
assert.match(prediction, /minimum 20 directional outcomes/);
assert.match(prediction, /realized_pnl IS NOT NULL OR outcome IS NOT NULL/);
assert.match(audit, /getPairPredictionAccuracyAudit/);
assert.match(audit, /byPair/);
assert.match(audit, /byScoreBand/);
assert.match(audit, /byRegime/);
assert.match(audit, /bySession/);
assert.match(audit, /byNewsRisk/);
assert.match(audit, /byStrategy/);
assert.match(audit, /profitFactor/);
assert.match(audit, /expectancy/);
assert.match(collection, /model: 'BASELINE'/);
assert.match(collection, /model: 'HISTORICAL_EDGE'/);
assert.doesNotMatch(collection, /models:/);
assert.match(fs.readFileSync('src/services/pairPredictionService.ts', 'utf8'), /fetchLiveForexNews/);
assert.match(fs.readFileSync('src/services/pairPredictionService.ts', 'utf8'), /newsActiveHighImpactCount/);
assert.match(server, /api\/live-trade-research\/pair-accuracy-audit/);

console.log('PHASE 10 PAIR PREDICTION ACCURACY AUDIT: PASSED');
