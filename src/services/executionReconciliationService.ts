import { executeQuery, executeRun } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { BrokerType, NormalizedOrder, OrderStatus } from '../brokers/types';
import { normalizeBrokerError } from '../brokers/errors';
import {
  completeExecutionIntent,
  failExecutionIntent
} from './executionIntentService';

const TERMINAL_STATES: OrderStatus[] = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'];
const MAX_AGE_MS = 15 * 60_000;

function parseResult(raw: any): any {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function brokerOrderIdFromResult(result: any): string | undefined {
  return result?.brokerOrderId || result?.order?.brokerOrderId || result?.id || result?.order?.id;
}

export async function reconcileExecutionIntent(idempotencyKey: string): Promise<NormalizedOrder | null> {
  const rows = await executeQuery<any>(
    'SELECT * FROM execution_intents WHERE idempotency_key = ?',
    [idempotencyKey]
  );
  const row = rows[0];
  if (!row || !['PENDING', 'IN_FLIGHT'].includes(String(row.state))) return null;

  const stored = parseResult(row.result_json);
  const brokerOrderId = brokerOrderIdFromResult(stored);
  if (!brokerOrderId) return null;

  const broker = String(row.broker) as BrokerType;
  if (broker !== 'CTRADER' && broker !== 'FIVE_PAISA') return null;

  try {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    const status = await adapter.getOrderStatus(String(brokerOrderId));
    const merged = {
      ...stored,
      brokerOrderId: status.brokerOrderId || brokerOrderId,
      brokerStatus: status.status,
      filledQuantity: status.filledQuantity,
      averageFillPrice: status.averageFillPrice,
      commission: status.commission,
      reconciledAt: Date.now(),
      order: status
    };

    if (status.status === 'FILLED') {
      await completeExecutionIntent(idempotencyKey, merged);
    } else if (status.status === 'CANCELLED' || status.status === 'REJECTED' || status.status === 'EXPIRED') {
      await failExecutionIntent(idempotencyKey, merged);
    } else {
      await executeRun(
        'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?)',
        ['IN_FLIGHT', JSON.stringify(merged), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT']
      );
    }
    return status;
  } catch (err: any) {
    const normalized = normalizeBrokerError(err, broker, 'LIVE');
    const age = Date.now() - Number(row.created_at || Date.now());

    // A transient broker/API lookup failure must not turn an accepted live order
    // into a false rejection. Keep it durable and retry on the next reconciliation cycle.
    const merged = {
      ...stored,
      brokerOrderId,
      reconciliationError: normalized.message,
      reconciliationErrorCode: normalized.code,
      reconciledAt: Date.now()
    };

    if (age >= MAX_AGE_MS) {
      merged.reconciliationTimedOutAt = merged.reconciliationTimedOutAt || Date.now();
    }
    await executeRun(
      'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?)',
      ['IN_FLIGHT', JSON.stringify(merged), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT']
    );
    return null;
  }
}

export async function reconcileInFlightExecutionIntents(limit = 100): Promise<void> {
  const rows = await executeQuery<any>(
    'SELECT idempotency_key FROM execution_intents WHERE state IN (?, ?) ORDER BY updated_at ASC LIMIT ?',
    ['PENDING', 'IN_FLIGHT', limit]
  );
  for (const row of rows) {
    try {
      await reconcileExecutionIntent(String(row.idempotency_key));
    } catch (err: any) {
      console.warn(
        '[Goldcrest] execution reconciliation failed',
        String(row.idempotency_key),
        err?.message || err
      );
    }
  }
}
