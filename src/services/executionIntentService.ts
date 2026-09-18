import { executeQuery, executeRun } from '../database/db';

export type ExecutionIntentState = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ExecutionIntentRecord {
  idempotencyKey: string;
  broker: string;
  market: string;
  symbol: string;
  side: string;
  state: ExecutionIntentState;
  payload: unknown;
  result?: unknown;
}

export async function claimExecutionIntent(
  idempotencyKey: string,
  metadata: Omit<ExecutionIntentRecord, 'idempotencyKey' | 'state' | 'result'>
): Promise<{ claimed: boolean; existing?: ExecutionIntentRecord }> {
  const existingRows = await executeQuery<any>(
    'SELECT * FROM execution_intents WHERE idempotency_key = ?',
    [idempotencyKey]
  );
  if (existingRows[0]) {
    const row = existingRows[0];
    const payload = JSON.parse(row.payload_json || 'null');
    if (JSON.stringify(payload) !== JSON.stringify(metadata.payload ?? null)) {
      throw new Error('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    }
    return {
      claimed: false,
      existing: {
        idempotencyKey: row.idempotency_key, broker: row.broker, market: row.market,
        symbol: row.symbol, side: row.side, state: row.state, payload,
        result: row.result_json ? JSON.parse(row.result_json) : undefined
      }
    };
  }
  const now = Date.now();
  await executeRun(
    'INSERT OR IGNORE INTO execution_intents (idempotency_key, broker, market, symbol, side, state, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [idempotencyKey, metadata.broker, metadata.market, metadata.symbol, metadata.side, 'PENDING', JSON.stringify(metadata.payload ?? null), now, now]
  );
  const rows = await executeQuery<any>('SELECT * FROM execution_intents WHERE idempotency_key = ?', [idempotencyKey]);
  const row = rows[0];
  if (!row) throw new Error('EXECUTION_INTENT_NOT_PERSISTED');
  const claimed = Number(row.created_at) === now;
  return { claimed, existing: {
    idempotencyKey: row.idempotency_key, broker: row.broker, market: row.market,
    symbol: row.symbol, side: row.side, state: row.state,
    payload: JSON.parse(row.payload_json || 'null'),
    result: row.result_json ? JSON.parse(row.result_json) : undefined
  }};
}

export async function completeExecutionIntent(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun('UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ?',
    ['COMPLETED', JSON.stringify(result), Date.now(), idempotencyKey]);
}

export async function failExecutionIntent(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun('UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ?',
    ['FAILED', JSON.stringify(result), Date.now(), idempotencyKey]);
}
