// ============================================================================
// PHASE 5 — POSITION & ORDER RECONCILIATION ENGINE
// ============================================================================

import {
  PositionReconciliationReport,
  PositionReconciliationItem,
  OrderReconciliationReport,
  OrderReconciliationItem,
  ReconciliationMismatchType
} from './types';
import { BrokerType, TradingEnvironment } from '../brokers/types';

export class PositionReconciliationEngine {
  private reconciliationHistory: PositionReconciliationReport[] = [];

  public reconcilePositions(
    broker: BrokerType,
    environment: TradingEnvironment,
    internalPositions: Array<{ id: string; instrument: string; side: 'BUY' | 'SELL'; quantity: number; entryPrice: number; status: string }>,
    brokerPositions: Array<{ id: string; instrument: string; side: 'BUY' | 'SELL'; quantity: number; entryPrice: number; status: string }>
  ): PositionReconciliationReport {
    const items: PositionReconciliationItem[] = [];
    const internalMap = new Map(internalPositions.map(p => [p.instrument, p]));
    const brokerMap = new Map(brokerPositions.map(p => [p.instrument, p]));

    // All unique instruments across both sides
    const allInstruments = Array.from(new Set([...internalPositions.map(p => p.instrument), ...brokerPositions.map(p => p.instrument)]));

    let matchedCount = 0;
    let mismatchedCount = 0;

    for (const inst of allInstruments) {
      const internal = internalMap.get(inst);
      const brokerPos = brokerMap.get(inst);

      if (internal && !brokerPos) {
        mismatchedCount++;
        items.push({
          instrument: inst,
          internalPosition: internal,
          mismatchType: 'MISSING_IN_BROKER',
          isMatched: false,
          discrepancyNotes: `Internal position ${internal.id} exists but missing from ${broker} active account`
        });
      } else if (!internal && brokerPos) {
        mismatchedCount++;
        items.push({
          instrument: inst,
          brokerPosition: brokerPos,
          mismatchType: 'UNEXPECTED_IN_BROKER',
          isMatched: false,
          discrepancyNotes: `Broker has active position ${brokerPos.id} not tracked internally`
        });
      } else if (internal && brokerPos) {
        const qtyDiff = Math.abs(internal.quantity - brokerPos.quantity);
        const priceDiff = Math.abs(internal.entryPrice - brokerPos.entryPrice);
        const statusDiff = internal.status !== brokerPos.status;

        if (qtyDiff > 0.0001) {
          mismatchedCount++;
          items.push({
            instrument: inst,
            internalPosition: internal,
            brokerPosition: brokerPos,
            mismatchType: 'QUANTITY_MISMATCH',
            isMatched: false,
            discrepancyNotes: `Quantity divergence: Internal=${internal.quantity}, Broker=${brokerPos.quantity}`
          });
        } else if (priceDiff > (inst.includes('JPY') ? 0.5 : 0.005)) {
          mismatchedCount++;
          items.push({
            instrument: inst,
            internalPosition: internal,
            brokerPosition: brokerPos,
            mismatchType: 'PRICE_MISMATCH',
            isMatched: false,
            discrepancyNotes: `Entry price divergence: Internal=${internal.entryPrice}, Broker=${brokerPos.entryPrice}`
          });
        } else if (statusDiff) {
          mismatchedCount++;
          items.push({
            instrument: inst,
            internalPosition: internal,
            brokerPosition: brokerPos,
            mismatchType: 'STATUS_MISMATCH',
            isMatched: false,
            discrepancyNotes: `Status divergence: Internal=${internal.status}, Broker=${brokerPos.status}`
          });
        } else {
          matchedCount++;
          items.push({
            instrument: inst,
            internalPosition: internal,
            brokerPosition: brokerPos,
            isMatched: true,
            discrepancyNotes: 'Perfect synchronization'
          });
        }
      }
    }

    const report: PositionReconciliationReport = {
      reconciledAt: Date.now(),
      broker,
      environment,
      totalPositionsEvaluated: allInstruments.length,
      matchedCount,
      mismatchedCount,
      items,
      status: mismatchedCount === 0 ? 'CLEAN' : mismatchedCount > 2 ? 'CRITICAL_ERROR' : 'DISCREPANCY_DETECTED'
    };

    this.reconciliationHistory.unshift(report);
    if (this.reconciliationHistory.length > 50) this.reconciliationHistory.pop();

    return report;
  }

  public getLatestReport(): PositionReconciliationReport | null {
    return this.reconciliationHistory[0] || null;
  }
}

export class OrderReconciliationEngine {
  private orderReconciliationHistory: OrderReconciliationReport[] = [];

  public reconcileOrders(
    broker: BrokerType,
    environment: TradingEnvironment,
    internalOrders: Array<{ orderId: string; clientOrderId?: string; instrument: string; status: string; filledQty: number; avgPrice?: number }>,
    brokerOrders: Array<{ orderId: string; clientOrderId?: string; instrument: string; status: string; filledQty: number; avgPrice?: number }>
  ): OrderReconciliationReport {
    const items: OrderReconciliationItem[] = [];
    const internalMap = new Map(internalOrders.map(o => [o.orderId, o]));
    const brokerMap = new Map(brokerOrders.map(o => [o.orderId, o]));

    const allOrderIds = Array.from(new Set([...internalOrders.map(o => o.orderId), ...brokerOrders.map(o => o.orderId)]));

    let matchedCount = 0;
    let mismatchedCount = 0;

    for (const orderId of allOrderIds) {
      const internal = internalMap.get(orderId);
      const brokerOrd = brokerMap.get(orderId);

      if (internal && !brokerOrd) {
        mismatchedCount++;
        items.push({
          orderId,
          instrument: internal.instrument,
          internalState: internal,
          mismatchType: 'MISSING_IN_BROKER',
          isMatched: false,
          notes: 'Internal order missing on broker orderbook'
        });
      } else if (!internal && brokerOrd) {
        mismatchedCount++;
        items.push({
          orderId,
          instrument: brokerOrd.instrument,
          brokerState: brokerOrd,
          mismatchType: 'UNEXPECTED_IN_BROKER',
          isMatched: false,
          notes: 'Broker orderbook contains untracked execution'
        });
      } else if (internal && brokerOrd) {
        if (internal.status !== brokerOrd.status) {
          mismatchedCount++;
          items.push({
            orderId,
            instrument: internal.instrument,
            internalState: internal,
            brokerState: brokerOrd,
            mismatchType: 'STATUS_MISMATCH',
            isMatched: false,
            notes: `Status mismatch: Internal=${internal.status}, Broker=${brokerOrd.status}`
          });
        } else if (Math.abs(internal.filledQty - brokerOrd.filledQty) > 0.0001) {
          mismatchedCount++;
          items.push({
            orderId,
            instrument: internal.instrument,
            internalState: internal,
            brokerState: brokerOrd,
            mismatchType: 'PARTIAL_FILL',
            isMatched: false,
            notes: `Filled quantity mismatch: Internal=${internal.filledQty}, Broker=${brokerOrd.filledQty}`
          });
        } else {
          matchedCount++;
          items.push({
            orderId,
            instrument: internal.instrument,
            internalState: internal,
            brokerState: brokerOrd,
            isMatched: true,
            notes: 'Synchronized'
          });
        }
      }
    }

    const report: OrderReconciliationReport = {
      reconciledAt: Date.now(),
      broker,
      environment,
      totalOrdersEvaluated: allOrderIds.length,
      matchedCount,
      mismatchedCount,
      items,
      status: mismatchedCount === 0 ? 'CLEAN' : 'DISCREPANCY_DETECTED'
    };

    this.orderReconciliationHistory.unshift(report);
    if (this.orderReconciliationHistory.length > 50) this.orderReconciliationHistory.pop();

    return report;
  }

  public getLatestReport(): OrderReconciliationReport | null {
    return this.orderReconciliationHistory[0] || null;
  }
}

export const positionReconciliationEngine = new PositionReconciliationEngine();
export const orderReconciliationEngine = new OrderReconciliationEngine();
