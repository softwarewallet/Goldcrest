import { executeQuery, executeRun } from '../src/database/db';
import { materializeLiveTradeResearchTrainingDataset } from '../src/services/liveTradeResearchTrainingService';

async function migrate(): Promise<void> {
  // Additive migration for preexisting live_trade_research databases.
  // These columns are part of the current schema but older database files may predate them.
  for (const [name, type] of [
    ['mfe_pnl', 'REAL'], ['mae_pnl', 'REAL'], ['holding_duration_ms', 'INTEGER'],
    ['execution_status', 'TEXT'], ['execution_code', 'TEXT'], ['execution_reason', 'TEXT'],
    ['broker_order_id', 'TEXT'], ['executed_entry_price', 'REAL'], ['executed_quantity', 'REAL'],
    ['commission', 'REAL'], ['broker_status', 'TEXT'], ['execution_timestamp', 'INTEGER'],
    ['realized_pnl', 'REAL'], ['exit_price', 'REAL'], ['exit_timestamp', 'INTEGER'], ['outcome', 'TEXT']
  ] as const) {
    const columns = await executeQuery<{ name: string }>('PRAGMA table_info(live_trade_research)');
    if (!columns.some(column => column.name === name)) {
      await executeRun(`ALTER TABLE live_trade_research ADD COLUMN ${name} ${type}`);
    }
  }

  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_labels (
    signal_id TEXT NOT NULL,
    label_version TEXT NOT NULL,
    horizon TEXT NOT NULL,
    label_source TEXT NOT NULL,
    actual_direction TEXT,
    forward_return_pct REAL,
    profitable INTEGER,
    realized_pnl REAL,
    outcome_label TEXT,
    entry_price REAL,
    exit_price REAL,
    stop_loss REAL,
    take_profit REAL,
    stop_hit INTEGER,
    target_hit INTEGER,
    mfe_pnl REAL,
    mae_pnl REAL,
    holding_duration_ms INTEGER,
    exit_timestamp INTEGER,
    labeled_at INTEGER NOT NULL,
    PRIMARY KEY(signal_id, label_version, horizon)
  )`);
  await executeRun('CREATE INDEX IF NOT EXISTS idx_live_trade_research_labels_symbol_horizon ON live_trade_research_labels(horizon, actual_direction, profitable)');
  await executeRun('CREATE INDEX IF NOT EXISTS idx_live_trade_research_labels_labeled_at ON live_trade_research_labels(labeled_at DESC)');

  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_predictions (
    prediction_id TEXT PRIMARY KEY,
    model_version TEXT NOT NULL,
    prediction_source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    signal_id TEXT,
    predicted_at INTEGER NOT NULL,
    horizon TEXT NOT NULL,
    predicted_direction TEXT NOT NULL,
    confidence REAL NOT NULL,
    feature_hash TEXT NOT NULL,
    model_agreement REAL,
    reasoning TEXT,
    invalidation TEXT,
    actual_direction TEXT,
    actual_return_pct REAL,
    outcome_status TEXT,
    evaluated_at INTEGER,
    created_at INTEGER NOT NULL,
    feature_snapshot_json TEXT,
    prediction_context TEXT NOT NULL DEFAULT 'RESEARCH',
    actual_profitable INTEGER,
    realized_pnl REAL,
    outcome_label TEXT,
    label_source TEXT
  )`);

  for (const [name, type] of [
    ['actual_profitable', 'INTEGER'],
    ['realized_pnl', 'REAL'],
    ['outcome_label', 'TEXT'],
    ['label_source', 'TEXT']
  ] as const) {
    const columns = await executeQuery<{ name: string }>('PRAGMA table_info(live_trade_research_predictions)');
    if (!columns.some(column => column.name === name)) {
      try { await executeRun(`ALTER TABLE live_trade_research_predictions ADD COLUMN ${name} ${type}`); } catch {}
    }
  }

  const result = await materializeLiveTradeResearchTrainingDataset();
  const counts = await executeQuery<any>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN label_source = 'DAILY_FORWARD_PLUS_REALIZED_TRADE' THEN 1 ELSE 0 END) AS forward_labels,
      SUM(CASE WHEN profitable = 1 THEN 1 ELSE 0 END) AS profitable_labels,
      SUM(CASE WHEN profitable = 0 THEN 1 ELSE 0 END) AS non_profitable_labels
    FROM live_trade_research_labels
  `);

  console.log(JSON.stringify({
    migration: 'PHASE10_REAL_OUTCOME_DATA_V1',
    preservedExistingData: true,
    rowsProcessed: result.rowsProcessed,
    labels: counts[0] || { total: 0 },
    completedAt: new Date().toISOString()
  }, null, 2));
}

migrate().catch(error => {
  console.error('Phase 10 outcome-data migration failed:', error?.message || error);
  process.exitCode = 1;
});
