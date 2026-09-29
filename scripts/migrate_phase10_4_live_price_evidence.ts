import { executeQuery, executeRun } from '../src/database/db';

async function main(): Promise<void> {
  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_price_evidence (
    id TEXT PRIMARY KEY, signal_id TEXT NOT NULL, symbol TEXT NOT NULL, phase TEXT NOT NULL,
    checkpoint TEXT NOT NULL, target_timestamp INTEGER NOT NULL, observed_at INTEGER NOT NULL,
    bid REAL, ask REAL, mid REAL, spread REAL, source TEXT, status TEXT NOT NULL,
    UNIQUE(signal_id, checkpoint)
  )`);
  await executeRun('CREATE INDEX IF NOT EXISTS idx_live_trade_research_price_evidence_signal_time ON live_trade_research_price_evidence(signal_id, target_timestamp)');
  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_evidence_summaries (
    signal_id TEXT PRIMARY KEY, classification TEXT NOT NULL, reasons_json TEXT NOT NULL,
    max_favorable_move REAL, max_adverse_move REAL, captured_points INTEGER NOT NULL, classified_at INTEGER NOT NULL
  )`);
  const evidence = await executeQuery<{ count: number }>('SELECT COUNT(*) AS count FROM live_trade_research_price_evidence');
  const summaries = await executeQuery<{ count: number }>('SELECT COUNT(*) AS count FROM live_trade_research_evidence_summaries');
  console.log(JSON.stringify({
    migration: 'PHASE10_4_LIVE_PRICE_EVIDENCE_V1',
    preservedExistingData: true,
    evidenceRows: Number(evidence[0]?.count || 0),
    summaryRows: Number(summaries[0]?.count || 0),
    completedAt: new Date().toISOString()
  }, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
