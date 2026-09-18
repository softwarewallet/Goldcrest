import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  limit,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { firestoreTradeTraceService, TradeTraceData } from './firestoreTradeTraceService';

export type ReconciliationStatus = 
  | 'MATCHED'
  | 'RECONCILIATION_MISMATCH'
  | 'ORPHAN_INTERNAL'
  | 'ORPHAN_BROKER'
  | 'ORPHAN_CLOUD'
  | 'CLOUDDIVERGENCE';

export interface InternalStateItem {
  id: string;
  symbol: string;
  quantity: number;
  direction: string;
  status: string;
  price: number;
}

export interface BrokerStateItem {
  id: string;
  symbol: string;
  quantity: number;
  direction: string;
  status: string;
  price: number;
}

export interface FirestoreStateItem {
  tradeTraceId: string;
  signalId: string;
  status: string;
  environment: string;
  brokerOrderId?: string;
}

export interface ReconciliationDiscrepancy {
  entityId: string;
  type: ReconciliationStatus;
  field?: string;
  internalValue?: any;
  brokerValue?: any;
  cloudValue?: any;
  message: string;
}

export interface ReconciliationRecord {
  reconciliationId: string;
  tradeTraceId: string;
  status: ReconciliationStatus;
  internalState: Record<string, any>;
  brokerState: Record<string, any>;
  firestoreState: Record<string, any>;
  discrepancies: ReconciliationDiscrepancy[];
  timestamp: number;
  userId?: string;
}

export class ReconciliationService {
  private localRecords: Map<string, ReconciliationRecord> = new Map();

  /**
   * Run 3-Way Reconciliation comparing Internal, Broker, and Firestore Cloud states
   */
  public async reconcileThreeWay(
    tradeTraceId: string,
    internalItem?: InternalStateItem | null,
    brokerItem?: BrokerStateItem | null,
    firestoreTrace?: TradeTraceData | null
  ): Promise<ReconciliationRecord> {
    const reconciliationId = `RECON-${tradeTraceId}-${Date.now()}`;
    const discrepancies: ReconciliationDiscrepancy[] = [];

    // 1. Fetch Cloud trace if not supplied
    let cloudTrace = firestoreTrace;
    if (!cloudTrace && tradeTraceId) {
      cloudTrace = await firestoreTradeTraceService.getTradeTrace(tradeTraceId);
    }

    // 2. Perform Orphan & Partial Presence Checks
    const count = (internalItem ? 1 : 0) + (brokerItem ? 1 : 0) + (cloudTrace ? 1 : 0);
    
    if (count === 1) {
      if (internalItem) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'ORPHAN_INTERNAL',
          message: 'Record exists in internal execution engine but is missing from Broker and Cloud Firestore.'
        });
      } else if (brokerItem) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'ORPHAN_BROKER',
          message: 'Record exists on Broker but is missing from Internal engine and Cloud Firestore.'
        });
      } else if (cloudTrace) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'ORPHAN_CLOUD',
          message: 'Record exists in Cloud Firestore but is missing from Internal engine and Broker.'
        });
      }
    } else if (count === 2) {
      if (internalItem && cloudTrace && !brokerItem) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          message: 'Record exists in Internal engine and Cloud Firestore, but is missing from Broker.'
        });
      } else if (brokerItem && cloudTrace && !internalItem) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          message: 'Record exists on Broker and Cloud Firestore, but is missing from Internal execution engine.'
        });
      } else if (internalItem && brokerItem && !cloudTrace) {
        // First run field comparison to check for quantity/symbol/direction mismatches
        const hasFieldMismatch = 
          internalItem.symbol !== brokerItem.symbol ||
          Math.abs(internalItem.quantity - brokerItem.quantity) > 0.0001 ||
          internalItem.direction !== brokerItem.direction ||
          Math.abs(internalItem.price - brokerItem.price) > 0.001 ||
          internalItem.status !== brokerItem.status;
        
        if (!hasFieldMismatch) {
          discrepancies.push({
            entityId: tradeTraceId,
            type: 'CLOUDDIVERGENCE',
            message: 'Record exists in Internal engine and Broker, but is missing from Cloud Firestore.'
          });
        }
      }
    }

    // 3. Field Comparisons if items exist
    if (internalItem && brokerItem) {
      if (internalItem.symbol !== brokerItem.symbol) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          field: 'symbol',
          internalValue: internalItem.symbol,
          brokerValue: brokerItem.symbol,
          message: `Symbol mismatch: Internal (${internalItem.symbol}) vs Broker (${brokerItem.symbol})`
        });
      }

      if (Math.abs(internalItem.quantity - brokerItem.quantity) > 0.0001) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          field: 'quantity',
          internalValue: internalItem.quantity,
          brokerValue: brokerItem.quantity,
          message: `Quantity mismatch: Internal (${internalItem.quantity}) vs Broker (${brokerItem.quantity})`
        });
      }

      if (internalItem.direction !== brokerItem.direction) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          field: 'direction',
          internalValue: internalItem.direction,
          brokerValue: brokerItem.direction,
          message: `Direction mismatch: Internal (${internalItem.direction}) vs Broker (${brokerItem.direction})`
        });
      }

      if (Math.abs(internalItem.price - brokerItem.price) > 0.001) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          field: 'price',
          internalValue: internalItem.price,
          brokerValue: brokerItem.price,
          message: `Price mismatch: Internal (${internalItem.price}) vs Broker (${brokerItem.price})`
        });
      }

      if (internalItem.status !== brokerItem.status) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'RECONCILIATION_MISMATCH',
          field: 'status',
          internalValue: internalItem.status,
          brokerValue: brokerItem.status,
          message: `Status mismatch: Internal (${internalItem.status}) vs Broker (${brokerItem.status})`
        });
      }
    }

    // 4. Cloud Trace Divergence Checks
    if (cloudTrace && internalItem) {
      if (cloudTrace.brokerOrderId && brokerItem?.id && cloudTrace.brokerOrderId !== brokerItem.id) {
        discrepancies.push({
          entityId: tradeTraceId,
          type: 'CLOUDDIVERGENCE',
          field: 'brokerOrderId',
          internalValue: brokerItem.id,
          cloudValue: cloudTrace.brokerOrderId,
          message: `Broker Order ID in Cloud (${cloudTrace.brokerOrderId}) differs from Broker item (${brokerItem.id})`
        });
      }
    }

    // Determine aggregate status
    let finalStatus: ReconciliationStatus = 'MATCHED';
    if (discrepancies.length > 0) {
      const primaryType = discrepancies[0].type;
      finalStatus = primaryType;
    }

    const record: ReconciliationRecord = {
      reconciliationId,
      tradeTraceId,
      status: finalStatus,
      internalState: internalItem ? { ...internalItem } : {},
      brokerState: brokerItem ? { ...brokerItem } : {},
      firestoreState: cloudTrace ? { ...cloudTrace } : {},
      discrepancies,
      timestamp: Date.now(),
      userId: auth?.currentUser?.uid || 'local_user'
    };

    // Store in local records map
    this.localRecords.set(reconciliationId, record);

    // Save to Firestore
    try {
      if (db) {
        const ref = doc(db, 'reconciliation_records', reconciliationId);
        await setDoc(ref, {
          ...record,
          timestamp: serverTimestamp()
        }, { merge: true });

        // Also update trace status if mismatch detected
        if (finalStatus !== 'MATCHED' && cloudTrace) {
          await firestoreTradeTraceService.saveTradeTrace({
            ...cloudTrace,
            status: 'RECONCILIATION_MISMATCH'
          });
        }
      }
    } catch (error) {
      console.warn('Reconciliation record save to Firestore failed, stored locally:', error);
    }

    return record;
  }

  public getLocalRecord(reconciliationId: string): ReconciliationRecord | undefined {
    return this.localRecords.get(reconciliationId);
  }

  public getAllLocalRecords(): ReconciliationRecord[] {
    return Array.from(this.localRecords.values());
  }
}

export const reconciliationService = new ReconciliationService();
