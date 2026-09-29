import { executeQuery } from '../src/database/db';

type CountRow = { count: number | string | null };
type TimestampAuditRow = { valid: number | string | null; invalid: number | string | null; future: number | string | null };
type PnlAuditRow = { populated: number | string | null; null_count: number | string | null };
type EntryExitAuditRow = { entry_populated: number | string | null; exit_populated: number | string | null };
type StatusRow = { lifecycle_status: string | null; count: number | string };
type OutcomeRow = { outcome: string | null; count: number | string };
type Audit = {
  audit: string;
  database: {
    tables: Record<string, boolean>;
    liveTradeResearch: {
      total: number;
      byLifecycleStatus: Array<{ status: string; count: number }>;
      signalTimestamps: { valid: number; invalid: number; future: number };
      realizedPnl: { populated: number; null: number };
      outcomes: Array<{ outcome: string; count: number }>;
      entryExit: { entryPopulated: number; exitPopulated: number };
      eligibleClosedRows: number;
    };
    phase10: {
      features: number;
      training: number;
      predictions: number;
      labels: number;
    };
  };
  diagnosis: string[];
  generatedAt: string;
};

async function countTable(name: string): Promise<number> {
  const rows = await executeQuery<CountRow>(`SELECT COUNT(*) AS count FROM ${name}`);
  return Number(rows[0]?.count || 0);
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await executeQuery<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [name]
  );
  return rows.length > 0;
}

async function audit(): Promise<void> {
  const tables = [
    'live_trade_research',
    'live_trade_research_features',
    'live_trade_research_training',
    'live_trade_research_predictions',
    'live_trade_research_labels'
  ];
  const exists = Object.fromEntries(await Promise.all(tables.map(async name => [name, await tableExists(name)])));

  if (!exists.live_trade_research) {
    console.log(JSON.stringify({
      audit: 'PHASE10_REAL_OUTCOME_DATA_AUDIT_V1',
      database: { tables: exists },
      diagnosis: ['live_trade_research table does not exist; no Phase 10 research rows can currently be labeled.'],
      generatedAt: new Date().toISOString()
    }, null, 2));
    return;
  }

  const total = await countTable('live_trade_research');
  const statusRows = await executeQuery<StatusRow>(
    'SELECT lifecycle_status, COUNT(*) AS count FROM live_trade_research GROUP BY lifecycle_status ORDER BY count DESC'
  );
  const timestampRows = await executeQuery<TimestampAuditRow>(
    `SELECT
       SUM(CASE WHEN typeof(signal_timestamp)='integer' AND signal_timestamp > 0 THEN 1 ELSE 0 END) AS valid,
       SUM(CASE WHEN signal_timestamp > ? THEN 1 ELSE 0 END) AS future,
       SUM(CASE WHEN signal_timestamp IS NULL OR signal_timestamp <= 0 THEN 1 ELSE 0 END) AS invalid
     FROM live_trade_research`,
    [Date.now()]
  );
  const pnlRows = await executeQuery<PnlAuditRow>(
    `SELECT
       SUM(CASE WHEN realized_pnl IS NOT NULL THEN 1 ELSE 0 END) AS populated,
       SUM(CASE WHEN realized_pnl IS NULL THEN 1 ELSE 0 END) AS null_count
     FROM live_trade_research`
  );
  const outcomeRows = await executeQuery<OutcomeRow>(
    `SELECT outcome, COUNT(*) AS count
       FROM live_trade_research
      GROUP BY outcome
      ORDER BY count DESC`
  );
  undefined
       FROM live_trade_research`
  );
  const eligibleRows = await executeQuery<CountRow>(
    "SELECT COUNT(*) AS count FROM live_trade_research WHERE lifecycle_status='CLOSED' AND signal_timestamp >= 0 AND signal_timestamp <= ?",
    [Date.now()]
  );

  const phase10Counts: Record<string, number> = {};
  for (const name of tables.slice(1)) {
    phase10Counts[name.replace('live_trade_research_', '')] = exists[name] ? await countTable(name) : 0;
  }

  const diagnosis: string[] = [];
  if (total === 0) diagnosis.push('live_trade_research is empty.');
  if (total > 0 && Number(eligibleRows[0]?.count || 0) === 0) diagnosis.push("No rows satisfy the current training filter lifecycle_status='CLOSED' with a non-future signal timestamp.");
  if (total > 0 && statusRows.every(row => String(row.lifecycle_status || '').toUpperCase() !== 'CLOSED')) diagnosis.push('No lifecycle_status value is exactly CLOSED; the current training pipeline therefore excludes all rows.');
  if (Number(pnlRows[0]?.populated || 0) === 0) diagnosis.push('No realized_pnl values are populated in live_trade_research.');
  if (Number(entryExitRows[0]?.entry_populated || 0) === 0 || Number(entryExitRows[0]?.exit_populated || 0) === 0) diagnosis.push('Entry/exit price fields are not fully populated, so realized trade-path labels may be unavailable.');
  if (!diagnosis.length) diagnosis.push('Rows exist that satisfy the current CLOSED filter; investigate feature/label materialization next.');

  const result: Audit = {
    audit: 'PHASE10_REAL_OUTCOME_DATA_AUDIT_V1',
    database: {
      tables: exists,
      liveTradeResearch: {
        total,
        byLifecycleStatus: statusRows.map(row => ({ status: String(row.lifecycle_status || 'NULL'), count: Number(row.count) })),
        signalTimestamps: {
          valid: Number(timestampRows[0]?.valid || 0),
          invalid: Number(timestampRows[0]?.invalid || 0),
          future: Number(timestampRows[0]?.future || 0)
        },
        realizedPnl: {
          populated: Number(pnlRows[0]?.populated || 0),
          null: Number(pnlRows[0]?.null_count || 0)
        },
        outcomes: outcomeRows.map(row => ({ outcome: String(row.outcome || 'NULL'), count: Number(row.count) })),
        entryExit: {
          entryPopulated: Number(entryExitRows[0]?.entry_populated || 0),
          exitPopulated: Number(entryExitRows[0]?.exit_populated || 0)
        },
        eligibleClosedRows: Number(eligibleRows[0]?.count || 0)
      },
      phase10: {
        features: phase10Counts.features,
        training: phase10Counts.training,
        predictions: phase10Counts.predictions,
        labels: phase10Counts.labels
      }
    },
    diagnosis,
    generatedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(result, null, 2));
}

audit().catch(error => {
  console.error('Phase 10 real-outcome audit failed:', error?.message || error);
  process.exitCode = 1;
});
