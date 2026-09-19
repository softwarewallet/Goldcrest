import crypto from 'node:crypto';
import { executeRun, executeTransaction } from '../database/db';

export type ExecutionIntentState = 'PENDING' | 'IN_FLIGHT' | 'RECONCILIATION_TIMEOUT' | 'COMPLETED' | 'FAILED';

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
  const claimToken = crypto.randomUUID();
  const payloadJson = JSON.stringify(metadata.payload ?? null);

  return executeTransaction((db) => {
    const readExisting = () => {
      const stmt = db.prepare('SELECT * FROM execution_intents WHERE idempotency_key = ?');
      try {
        stmt.bind([idempotencyKey]);
        if (!stmt.step()) return undefined;
        return stmt.getAsObject() as any;
      } finally {
        stmt.free();
      }
    };

    const existing = readExisting();
    if (!existing) {
      const now = Date.now();
      db.run(
        'INSERT INTO execution_intents (idempotency_key, claim_token, broker, market, symbol, side, state, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [idempotencyKey, claimToken, metadata.broker, metadata.market, metadata.symbol, metadata.side, 'PENDING', payloadJson, now, now]
      );
    }

    const row = readExisting();
    if (!row) throw new Error('EXECUTION_INTENT_NOT_PERSISTED');

    const storedPayload = JSON.parse(row.payload_json || 'null');
    if (JSON.stringify(storedPayload) !== payloadJson) {
      throw new Error('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    }

    return {
      claimed: row.claim_token === claimToken,
      existing: {
        idempotencyKey: row.idempotency_key,
        broker: row.broker,
        market: row.market,
        symbol: row.symbol,
        side: row.side,
        state: row.state,
        payload: storedPayload,
        result: row.result_json ? JSON.parse(row.result_json) : undefined
      }
    };
  });
}

export async function markExecutionIntentInFlight(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state = ?',
    ['IN_FLIGHT', JSON.stringify(result), Date.now(), idempotencyKey, 'PENDING']
  );
}

export async function completeExecutionIntent(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun('UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ?',
    ['COMPLETED', JSON.stringify(result), Date.now(), idempotencyKey]);
}

export async function failExecutionIntent(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun('UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ?',
    ['FAILED', JSON.stringify(result), Date.now(), idempotencyKey]);
}

export async function markExecutionIntentReconciliationTimeout(idempotencyKey: string, result: unknown): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?)',
    ['RECONCILIATION_TIMEOUT', JSON.stringify(result), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT']
  );
}

export async function resumeExecutionIntentReconciliation(idempotencyKey: string): Promise<void> {
  await executeRun(
    'UPDATE execution_intents SET state = ?, updated_at = ? WHERE idempotency_key = ? AND state = ?',
    ['IN_FLIGHT', Date.now(), idempotencyKey, 'RECONCILIATION_TIMEOUT']
  );
}
