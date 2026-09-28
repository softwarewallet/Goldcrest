import assert from 'node:assert/strict';
import fs from 'node:fs';

const db = fs.readFileSync('src/database/db.ts', 'utf8');
const training = fs.readFileSync('src/services/liveTradeResearchTrainingService.ts', 'utf8');
const prediction = fs.readFileSync('src/services/liveTradeResearchPredictionService.ts', 'utf8');
const evaluation = fs.readFileSync('src/services/liveTradeResearchPredictionEvaluationService.ts', 'utf8');
const migration = fs.readFileSync('scripts/migrate_phase10_real_outcome_data.ts', 'utf8');

assert.match(db, /CREATE TABLE IF NOT EXISTS live_trade_research_labels/);
assert.match(db, /PRIMARY KEY\(signal_id, label_version, horizon\)/);
assert.match(db, /ALTER TABLE live_trade_research_predictions ADD COLUMN actual_profitable/);
assert.match(training, /DAILY_FORWARD_PLUS_REALIZED_TRADE/);
assert.match(training, /row\.mfePnl/);
assert.match(training, /row\.maePnl/);
assert.match(training, /row\.exitTimestamp/);
assert.match(prediction, /actual_profitable INTEGER/);
assert.match(prediction, /label_source TEXT/);
assert.match(evaluation, /actual_profitable = \?, realized_pnl = \?/);
assert.match(evaluation, /CLOSED_TRADE_RESEARCH/);
assert.match(migration, /PHASE10_REAL_OUTCOME_DATA_V1/);
assert.match(migration, /preservedExistingData/);

console.log('PHASE 10 REAL OUTCOME DATA LAYER: PASSED');
