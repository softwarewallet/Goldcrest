import crypto from 'node:crypto';
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
    const requestedQuantityHint = Number(stored?.requestedQuantity ?? stored?.quantity ?? stored?.order?.quantity ?? 0);
    const status = await adapter.getOrderStatus(
      String(brokerOrderId),
      requestedQuantityHint > 0 ? requestedQuantityHint : undefined
    );
    const requestedQuantity = requestedQuantityHint > 0 ? requestedQuantityHint : Number(status.quantity || 0);
    const previousFilledQuantity = Math.max(0, Number(stored?.filledQuantity ?? stored?.order?.filledQuantity ?? 0));
    const brokerReportedFilledQuantity = Math.max(0, Number(status.filledQuantity ?? 0));

    // Broker reconciliation is cumulative: a later snapshot must never move the
    // durable fill quantity backwards. This prevents partial-fill state from
    // regressing when a broker endpoint temporarily reports a stale snapshot.
    const filledQuantity = Math.max(previousFilledQuantity, brokerReportedFilledQuantity);

    if (requestedQuantity > 0 && filledQuantity > requestedQuantity) {
      const merged = {
        ...stored,
        brokerOrderId: status.brokerOrderId || brokerOrderId,
        brokerStatus: status.status,
        requestedQuantity,
        filledQuantity: previousFilledQuantity,
        remainingQuantity: Math.max(0, requestedQuantity - Math.min(previousFilledQuantity, requestedQuantity)),
        reconciliationError: 'BROKER_FILLED_QUANTITY_EXCEEDS_REQUESTED_QUANTITY',
        reconciliationErrorCode: 'FILL_QUANTITY_INCONSISTENT',
        brokerReportedFilledQuantity,
        reconciledAt: Date.now(),
        order: status
      };
      await executeRun(
        'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?)',
        ['IN_FLIGHT', JSON.stringify(merged), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT']
      );
      return null;
    }

    const remainingQuantity = requestedQuantity > 0
      ? Math.max(0, requestedQuantity - filledQuantity)
      : undefined;

    const merged = {
      ...stored,
      brokerOrderId: status.brokerOrderId || brokerOrderId,
      brokerStatus: status.status,
      requestedQuantity: requestedQuantity > 0 ? requestedQuantity : undefined,
      filledQuantity,
      remainingQuantity,
      averageFillPrice: status.averageFillPrice,
      commission: status.commission,
      reconciledAt: Date.now(),
      order: status
    };

    // Persist broker-native fill events separately from cumulative snapshots.
    // For cTrader, dealId is the authoritative execution identity, so repeated
    // reconciliation cannot create a second fill for the same broker execution.
    if (Array.isArray(status.fillEvents)) {
      for (const fill of status.fillEvents) {
        if (!fill?.brokerFillId || !(Number(fill.quantity) > 0) || !(Number(fill.price) > 0)) continue;
        const fillId = crypto.createHash('sha256')
          .update([broker, status.brokerOrderId || brokerOrderId, fill.brokerFillId].join('|'))
          .digest('hex');
        await executeRun(
          'INSERT OR IGNORE INTO execution_fill_events (id, idempotency_key, broker, broker_order_id, broker_fill_id, quantity, price, commission, executed_at, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            fillId,
            idempotencyKey,
            broker,
            String(status.brokerOrderId || brokerOrderId),
            String(fill.brokerFillId),
            Number(fill.quantity),
            Number(fill.price),
            fill.commission ?? null,
            Number(fill.timestamp || Date.now()),
            Date.now()
          ]
        );
      }
    }

    // Persist each distinct cumulative-fill observation. The deterministic key
    // makes repeated reconciliation of the same broker state idempotent while
    // retaining an audit trail of fill progression.
    if (filledQuantity > 0) {
      const observationId = crypto.createHash('sha256')
        .update([
          idempotencyKey,
          status.brokerOrderId || brokerOrderId,
          status.status,
          String(filledQuantity),
          String(status.averageFillPrice ?? ''),
          String(status.commission ?? '')
        ].join('|'))
        .digest('hex');
      await executeRun(
        'INSERT OR IGNORE INTO execution_fill_observations (id, idempotency_key, broker, broker_order_id, status, requested_quantity, filled_quantity, remaining_quantity, average_fill_price, commission, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          observationId,
          idempotencyKey,
          broker,
          String(status.brokerOrderId || brokerOrderId),
          status.status,
          requestedQuantity > 0 ? requestedQuantity : null,
          filledQuantity,
          remainingQuantity ?? null,
          status.averageFillPrice ?? null,
          status.commission ?? null,
          Date.now()
        ]
      );
    }

    if (status.status === 'FILLED') {
      // A terminal FILLED state is only durable when the cumulative fill is
      // consistent with the requested quantity. If the broker reports FILLED
      // without a usable quantity, retain IN_FLIGHT for another authoritative
      // reconciliation instead of inventing a completion.
      if (requestedQuantity > 0 && filledQuantity < requestedQuantity) {
        const incompleteTerminal = {
          ...merged,
          reconciliationError: 'BROKER_REPORTED_FILLED_BEFORE_FULL_QUANTITY',
          reconciliationErrorCode: 'FILL_QUANTITY_INCOMPLETE'
        };
        await executeRun(
          'UPDATE execution_intents SET state = ?, result_json = ?, updated_at = ? WHERE idempotency_key = ? AND state IN (?, ?)',
          ['IN_FLIGHT', JSON.stringify(incompleteTerminal), Date.now(), idempotencyKey, 'PENDING', 'IN_FLIGHT']
        );
        return null;
      }
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
