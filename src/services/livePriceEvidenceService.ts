import { executeQuery, executeRun } from '../database/db';

export const LIVE_PRICE_EVIDENCE_INTERVAL_MS = 5_000;
export const LIVE_PRICE_EVIDENCE_CHECKPOINTS = [
  { checkpoint: 'SIGNAL', offsetMs: 0, phase: 'SIGNAL' },
  { checkpoint: 'SIGNAL_PLUS_5S', offsetMs: 5_000, phase: 'SIGNAL_RELATIVE' },
  { checkpoint: 'SIGNAL_PLUS_10S', offsetMs: 10_000, phase: 'SIGNAL_RELATIVE' },
  { checkpoint: 'SIGNAL_PLUS_20S', offsetMs: 20_000, phase: 'SIGNAL_RELATIVE' },
  { checkpoint: 'SIGNAL_PLUS_30S', offsetMs: 30_000, phase: 'SIGNAL_RELATIVE' },
  { checkpoint: 'EXECUTION_PLUS_30S', offsetMs: 30_000, phase: 'POST_EXECUTION' },
  { checkpoint: 'EXECUTION_PLUS_1M', offsetMs: 60_000, phase: 'POST_EXECUTION' },
  { checkpoint: 'EXECUTION_PLUS_5M', offsetMs: 300_000, phase: 'POST_EXECUTION' },
  { checkpoint: 'EXECUTION_PLUS_15M', offsetMs: 900_000, phase: 'POST_EXECUTION' }
] as const;

function json(value: unknown): string {
  try { return JSON.stringify(value ?? null); } catch { return JSON.stringify({ serializationError: true }); }
}

export type EvidenceClassification =
  | 'CORRECT_DIRECTION' | 'WRONG_DIRECTION' | 'INSUFFICIENT_MOVEMENT'
  | 'SIGNAL_STALE' | 'EXECUTION_TOO_LATE' | 'EXCESSIVE_ENTRY_DEVIATION'
  | 'SL_TOO_TIGHT' | 'TP_TOO_FAR' | 'EXIT_MANAGEMENT'
  | 'NEWS_OR_REGIME_FAILURE' | 'INSUFFICIENT_EVIDENCE';

export function getDueEvidenceCheckpoints(signalTimestamp: number, executionTimestamp: number | null, now: number) {
  return LIVE_PRICE_EVIDENCE_CHECKPOINTS
    .filter(item => item.checkpoint !== 'SIGNAL')
    .flatMap(item => {
      const base = item.phase === 'POST_EXECUTION' ? executionTimestamp : signalTimestamp;
      if (!Number.isFinite(Number(base)) || now < Number(base) + item.offsetMs) return [];
      return [{ checkpoint: item.checkpoint, targetTimestamp: Number(base) + item.offsetMs, phase: item.phase }];
    });
}

export function classifyEvidence(input: {
  direction: string; signalTimestamp: number; executionTimestamp: number | null;
  signalPrice: number | null; executionPrice: number | null;
  stopLoss: number | null; takeProfit: number | null; outcome: string | null;
  quoteEvidence: Array<{ checkpoint: string; mid: number | null; observedAt: number }>;
}): { classification: EvidenceClassification; reasons: string[] } {
  const direction = String(input.direction || '').toUpperCase();
  const sign = direction.includes('SELL') || direction === 'DOWN' ? -1 : 1;
  const execution = Number(input.executionPrice);
  const signal = Number(input.signalPrice);
  const stopDistance = Math.abs(execution - Number(input.stopLoss));
  const targetDistance = Math.abs(Number(input.takeProfit) - execution);
  if (!Number.isFinite(execution) || !Number.isFinite(signal)) return { classification: 'INSUFFICIENT_EVIDENCE', reasons: ['Signal or execution price is unavailable.'] };
  const moves = input.quoteEvidence.map(point => Number(point.mid)).filter(Number.isFinite).map(price => sign * (price - execution));
  const maxFavorable = moves.length ? Math.max(...moves) : 0;
  const maxAdverse = moves.length ? Math.min(...moves) : 0;
  const delayMs = input.executionTimestamp == null ? null : Number(input.executionTimestamp) - Number(input.signalTimestamp);
  const entryDeviation = Math.abs(execution - signal);
  const reasons: string[] = [];
  if (delayMs != null && delayMs > 30_000) reasons.push(`Signal-to-execution delay ${Math.round(delayMs / 1000)}s exceeded the 30s freshness budget.`);
  if (entryDeviation > 0 && stopDistance > 0 && entryDeviation > stopDistance * 0.5) reasons.push('Execution price deviated materially from the signal-time price relative to stop distance.');
  if (!moves.length) return { classification: 'INSUFFICIENT_EVIDENCE', reasons: [...reasons, 'No high-resolution quote evidence was captured.'] };
  if (input.outcome === 'WIN') return {
    classification: delayMs != null && delayMs > 30_000 ? 'EXECUTION_TOO_LATE' : maxFavorable > 0 ? 'CORRECT_DIRECTION' : 'EXIT_MANAGEMENT',
    reasons: reasons.length ? reasons : ['Trade was profitable and captured favorable movement.']
  };
  if (delayMs != null && delayMs > 30_000) return { classification: 'EXECUTION_TOO_LATE', reasons };
  if (entryDeviation > 0 && stopDistance > 0 && entryDeviation > stopDistance * 0.5) return { classification: 'EXCESSIVE_ENTRY_DEVIATION', reasons };
  if (stopDistance > 0 && targetDistance > 0 && maxFavorable > 0 && maxFavorable < targetDistance && maxAdverse <= -stopDistance) return { classification: 'SL_TOO_TIGHT', reasons };
  if (targetDistance > 0 && maxFavorable > 0 && maxFavorable < targetDistance) return { classification: 'TP_TOO_FAR', reasons };
  if (maxFavorable > 0) return { classification: 'CORRECT_DIRECTION', reasons: [...reasons, 'Price moved favorably after execution but the trade was not profitable.'] };
  return { classification: 'WRONG_DIRECTION', reasons: [...reasons, 'Captured post-execution movement was adverse to the signal direction.'] };
}

export async function ensureLivePriceEvidenceSchema(): Promise<void> {
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
}

export async function recordSignalEvidence(params: {
  signalId: string; symbol: string; signalTimestamp: number;
  quote?: { bid: number; ask: number; spread: number; timestamp: number; source?: string } | null;
}): Promise<void> {
  await ensureLivePriceEvidenceSchema();
  const q = params.quote;
  await executeRun(`INSERT OR IGNORE INTO live_trade_research_price_evidence
    (id, signal_id, symbol, phase, checkpoint, target_timestamp, observed_at, bid, ask, mid, spread, source, status)
    VALUES (?, ?, ?, 'SIGNAL', 'SIGNAL', ?, ?, ?, ?, ?, ?, ?, ?)`, [
    `evidence-${params.signalId}-SIGNAL`, params.signalId, params.symbol, params.signalTimestamp,
    q?.timestamp ?? Date.now(), q?.bid ?? null, q?.ask ?? null,
    q ? (Number(q.bid) + Number(q.ask)) / 2 : null, q?.spread ?? null,
    q?.source ?? 'AUTO_LIVE_SIGNAL', q ? 'CAPTURED' : 'UNAVAILABLE'
  ]);
}

export async function recordPriceEvidence(params: {
  signalId: string; symbol: string; checkpoint: string; phase: string;
  targetTimestamp: number; quote?: { bid: number; ask: number; spread: number; timestamp: number; source?: string } | null;
}): Promise<void> {
  await ensureLivePriceEvidenceSchema();
  const q = params.quote;
  await executeRun(`INSERT OR IGNORE INTO live_trade_research_price_evidence
    (id, signal_id, symbol, phase, checkpoint, target_timestamp, observed_at, bid, ask, mid, spread, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    `evidence-${params.signalId}-${params.checkpoint}`, params.signalId, params.symbol, params.phase,
    params.checkpoint, params.targetTimestamp, q?.timestamp ?? Date.now(), q?.bid ?? null, q?.ask ?? null,
    q ? (Number(q.bid) + Number(q.ask)) / 2 : null, q?.spread ?? null,
    q?.source ?? 'CTRADER_LIVE', q ? 'CAPTURED' : 'UNAVAILABLE'
  ]);
}

export async function getMissingEvidenceCheckpoints(signalId: string, signalTimestamp: number, executionTimestamp: number | null, now = Date.now()) {
  const existing = await executeQuery<{ checkpoint: string }>(
    'SELECT checkpoint FROM live_trade_research_price_evidence WHERE signal_id = ?', [signalId]
  );
  const done = new Set(existing.map(row => String(row.checkpoint)));
  return getDueEvidenceCheckpoints(signalTimestamp, executionTimestamp, now).filter(item => !done.has(item.checkpoint));
}

export async function captureDueLivePriceEvidence(
  quoteFetcher: (symbol: string) => Promise<{ bid: number; ask: number; spread: number; timestamp: number; source?: string } | null>,
  now = Date.now()
): Promise<{ signals: number; points: number }> {
  await ensureLivePriceEvidenceSchema();
  const rows = await executeQuery<any>(`SELECT signal_id, symbol, signal_timestamp, execution_timestamp
    FROM live_trade_research
    WHERE lifecycle_status IN ('OPEN','CLOSED') AND execution_timestamp IS NOT NULL
      AND execution_timestamp >= ?`, [now - 15 * 60_000]);
  const symbols = [...new Set(rows.map(row => String(row.symbol).toUpperCase()))];
  const quotes = new Map<string, any>();
  for (const symbol of symbols) {
    try { quotes.set(symbol, await quoteFetcher(symbol)); } catch { quotes.set(symbol, null); }
  }
  let points = 0;
  for (const trade of rows) {
    const missing = await getMissingEvidenceCheckpoints(
      String(trade.signal_id), Number(trade.signal_timestamp),
      trade.execution_timestamp == null ? null : Number(trade.execution_timestamp), now
    );
    for (const checkpoint of missing) {
      await recordPriceEvidence({
        signalId: String(trade.signal_id), symbol: String(trade.symbol),
        checkpoint: checkpoint.checkpoint, phase: checkpoint.phase,
        targetTimestamp: checkpoint.targetTimestamp, quote: quotes.get(String(trade.symbol).toUpperCase()) || null
      });
      points++;
    }
  }
  return { signals: rows.length, points };
}

export async function finalizeLivePriceEvidence(signalId: string): Promise<void> {
  await ensureLivePriceEvidenceSchema();
  const rows = await executeQuery<any>(`SELECT r.signal_id, r.direction, r.signal_timestamp, r.execution_timestamp,
      r.executed_entry_price, r.stop_loss, r.take_profit_1, r.outcome,
      e.checkpoint, e.mid, e.observed_at
    FROM live_trade_research r
    LEFT JOIN live_trade_research_price_evidence e ON e.signal_id = r.signal_id
    WHERE r.signal_id = ?`, [signalId]);
  if (!rows.length || rows[0].executed_entry_price == null) return;
  const first = rows[0];
  const signalEvidence = rows.find(row => row.checkpoint === 'SIGNAL');
  const points = rows.filter(row => row.checkpoint && row.checkpoint !== 'SIGNAL');
  const result = classifyEvidence({
    direction: String(first.direction), signalTimestamp: Number(first.signal_timestamp),
    executionTimestamp: first.execution_timestamp == null ? null : Number(first.execution_timestamp),
    signalPrice: signalEvidence?.mid == null ? null : Number(signalEvidence.mid),
    executionPrice: Number(first.executed_entry_price),
    stopLoss: first.stop_loss == null ? null : Number(first.stop_loss),
    takeProfit: first.take_profit_1 == null ? null : Number(first.take_profit_1),
    outcome: first.outcome == null ? null : String(first.outcome),
    quoteEvidence: points.map(row => ({ checkpoint: String(row.checkpoint), mid: row.mid == null ? null : Number(row.mid), observedAt: Number(row.observed_at) }))
  });
  const moves = points.map(row => Number(row.mid)).filter(Number.isFinite).map(price => {
    const sign = String(first.direction).toUpperCase().includes('SELL') || String(first.direction).toUpperCase() === 'DOWN' ? -1 : 1;
    return sign * (price - Number(first.executed_entry_price));
  });
  await executeRun(`INSERT OR REPLACE INTO live_trade_research_evidence_summaries
    (signal_id, classification, reasons_json, max_favorable_move, max_adverse_move, captured_points, classified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    signalId, result.classification, json(result.reasons), moves.length ? Math.max(...moves) : null,
    moves.length ? Math.min(...moves) : null, points.filter(row => Number.isFinite(Number(row.mid))).length, Date.now()
  ]);
}
