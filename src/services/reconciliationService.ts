import { executeQuery, executeRun } from '../database/db';
import { brokerRegistry } from '../brokers/registry';
import { firestoreTradeTraceService, TradeTraceData } from './firestoreTradeTraceService';

export type ReconciliationStatus =
  | 'MATCHED' | 'RECONCILIATION_MISMATCH' | 'ORPHAN_INTERNAL'
  | 'ORPHAN_BROKER' | 'ORPHAN_CLOUD' | 'CLOUDDIVERGENCE';

export interface InternalStateItem { id:string; symbol:string; quantity:number; direction:string; status:string; price:number; }
export interface BrokerStateItem { id:string; symbol:string; quantity:number; direction:string; status:string; price:number; }
export interface FirestoreStateItem { tradeTraceId:string; signalId:string; status:string; environment:string; brokerOrderId?:string; }
export interface ReconciliationDiscrepancy {
  entityId:string; type:ReconciliationStatus; field?:string;
  internalValue?:any; brokerValue?:any; cloudValue?:any; message:string;
}
export interface ReconciliationRecord {
  reconciliationId:string; tradeTraceId:string; status:ReconciliationStatus;
  internalState:Record<string,any>; brokerState:Record<string,any>;
  firestoreState:Record<string,any>; discrepancies:ReconciliationDiscrepancy[];
  timestamp:number; userId?:string;
}

export class ReconciliationService {
  private localRecords = new Map<string, ReconciliationRecord>();

  public async reconcileThreeWay(
    tradeTraceId:string,
    internalItem?:InternalStateItem|null,
    brokerItem?:BrokerStateItem|null,
    firestoreTrace?:TradeTraceData|null
  ):Promise<ReconciliationRecord> {
    const reconciliationId = `RECON-${tradeTraceId}-${Date.now()}`;
    const discrepancies:ReconciliationDiscrepancy[] = [];
    const localTrace = firestoreTrace || await firestoreTradeTraceService.getTradeTrace(tradeTraceId);
    const cloudTrace = localTrace;

    const count = (internalItem?1:0)+(brokerItem?1:0)+(cloudTrace?1:0);
    if (count === 1) {
      if (internalItem) discrepancies.push({entityId:tradeTraceId,type:'ORPHAN_INTERNAL',message:'Record exists in internal execution state but is missing from broker and SQLite trace persistence.'});
      else if (brokerItem) discrepancies.push({entityId:tradeTraceId,type:'ORPHAN_BROKER',message:'Record exists on broker but is missing from internal state and SQLite trace persistence.'});
      else discrepancies.push({entityId:tradeTraceId,type:'ORPHAN_CLOUD',message:'Trace record exists in SQLite but is missing from internal state and broker.'});
    } else if (count === 2 && internalItem && brokerItem && !cloudTrace) {
      discrepancies.push({entityId:tradeTraceId,type:'CLOUDDIVERGENCE',message:'Record exists in internal state and broker but is missing from SQLite trace persistence.'});
    } else if (count === 2 && internalItem && cloudTrace && !brokerItem) {
      discrepancies.push({entityId:tradeTraceId,type:'RECONCILIATION_MISMATCH',message:'Record exists in internal state and SQLite but is missing from broker.'});
    } else if (count === 2 && brokerItem && cloudTrace && !internalItem) {
      discrepancies.push({entityId:tradeTraceId,type:'RECONCILIATION_MISMATCH',message:'Record exists on broker and SQLite but is missing from internal state.'});
    }

    if (internalItem && brokerItem) {
      const checks:[keyof InternalStateItem,string][]=[
        ['symbol','symbol'],['quantity','quantity'],['direction','direction'],['price','price'],['status','status']
      ];
      for (const [field,label] of checks) {
        const a=(internalItem as any)[field], b=(brokerItem as any)[field];
        const mismatch = field==='quantity' ? Math.abs(a-b)>0.0001 : field==='price' ? Math.abs(a-b)>0.001 : a!==b;
        if (mismatch) discrepancies.push({
          entityId:tradeTraceId,type:'RECONCILIATION_MISMATCH',field:label,
          internalValue:a,brokerValue:b,message:`${label} mismatch: Internal (${a}) vs Broker (${b})`
        });
      }
    }

    if (cloudTrace?.brokerOrderId && brokerItem?.id && cloudTrace.brokerOrderId !== brokerItem.id) {
      discrepancies.push({
        entityId:tradeTraceId,type:'CLOUDDIVERGENCE',field:'brokerOrderId',
        brokerValue:brokerItem.id,cloudValue:cloudTrace.brokerOrderId,
        message:`Broker Order ID in SQLite trace (${cloudTrace.brokerOrderId}) differs from Broker item (${brokerItem.id})`
      });
    }

    const record:ReconciliationRecord={
      reconciliationId, tradeTraceId,
      status:discrepancies.length ? discrepancies[0].type : 'MATCHED',
      internalState:internalItem?{...internalItem}:{},
      brokerState:brokerItem?{...brokerItem}:{},
      firestoreState:cloudTrace?{...cloudTrace}:{},
      discrepancies,timestamp:Date.now(),userId:'local_user'
    };
    this.localRecords.set(reconciliationId,record);
    await executeRun(
      'INSERT OR REPLACE INTO trade_trace_nodes (node_id, trade_trace_id, payload_json, timestamp) VALUES (?, ?, ?, ?)',
      [`recon-${reconciliationId}`, tradeTraceId, JSON.stringify(record), record.timestamp]
    );
    return record;
  }

  public async captureBrokerSnapshot(broker: 'CTRADER' | 'FIVE_PAISA'): Promise<any> {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    if (!adapter) return null;

    try {
      const [account, positions, orders] = await Promise.all([
        adapter.getAccount(),
        adapter.getPositions(),
        adapter.getOpenOrders()
      ]);
      const timestamp = Date.now();
      const snapshot = {
        id: `BROKER-SNAPSHOT-${broker}-${timestamp}`,
        broker,
        environment: 'LIVE',
        timestamp,
        account,
        positions,
        orders,
        status: 'CAPTURED'
      };
      await executeRun(
        'INSERT INTO broker_reconciliation_snapshots (id, broker, environment, timestamp, account_json, positions_json, orders_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [snapshot.id, broker, 'LIVE', timestamp, JSON.stringify(account), JSON.stringify(positions), JSON.stringify(orders), snapshot.status]
      );
      return snapshot;
    } catch (err: any) {
      const isUnconfigured = err?.code === 'AUTHENTICATION_FAILED' ||
                             err?.message?.includes('access token is unavailable') ||
                             err?.message?.includes('credentials missing') ||
                             err?.message?.includes('ACCOUNT_NOT_FOUND');
      const timestamp = Date.now();
      const status = isUnconfigured ? 'UNCONFIGURED' : 'FAILED';
      const snapshot = {
        id: `BROKER-SNAPSHOT-${broker}-${timestamp}`,
        broker,
        environment: 'LIVE',
        timestamp,
        account: null,
        positions: [],
        orders: [],
        status,
        reason: err?.message || String(err)
      };
      await executeRun(
        'INSERT INTO broker_reconciliation_snapshots (id, broker, environment, timestamp, account_json, positions_json, orders_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [snapshot.id, broker, 'LIVE', timestamp, JSON.stringify(null), JSON.stringify([]), JSON.stringify([]), snapshot.status]
      );
      return snapshot;
    }
  }

  public async loadBrokerSnapshots(limit=50): Promise<any[]> {
    const rows = await executeQuery<any>(
      'SELECT id, broker, environment, timestamp, account_json, positions_json, orders_json, status FROM broker_reconciliation_snapshots ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    return rows.map(r => ({
      id: r.id,
      broker: r.broker,
      environment: r.environment,
      timestamp: Number(r.timestamp),
      account: JSON.parse(r.account_json),
      positions: JSON.parse(r.positions_json),
      orders: JSON.parse(r.orders_json),
      status: r.status
    }));
  }


  /**
   * Returns a conservative broker-balance-based loss measure for the current
   * local calendar day. Balance excludes unrealized P/L, so a decline from the
   * first authoritative snapshot of the day is treated as realized/net loss.
   * If no baseline exists yet, the current balance is treated as the baseline.
   */
  public async getDailyLoss(broker: 'CTRADER' | 'FIVE_PAISA', currentBalance: number): Promise<number> {
    const adapter = brokerRegistry.getAdapter(broker, 'LIVE');
    if (typeof adapter.getDailyRealizedPnL === 'function') {
      try {
        const realizedPnL = await adapter.getDailyRealizedPnL();
        if (Number.isFinite(realizedPnL)) {
          return Math.max(0, -Number(realizedPnL));
        }
      } catch (err: any) {
        console.warn('[Goldcrest] authoritative daily PnL unavailable; using reconciliation baseline:', err?.message || err);
      }
    }

    // Conservative fallback for brokers that do not expose a reliable daily
    // realized-P/L field: compare against the first authoritative balance
    // snapshot captured during the local calendar day.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = await executeQuery<any>(
      'SELECT account_json FROM broker_reconciliation_snapshots WHERE broker = ? AND environment = ? AND timestamp >= ? AND status = ? ORDER BY timestamp ASC LIMIT 1',
      [broker, 'LIVE', startOfDay.getTime(), 'CAPTURED']
    );
    if (!rows.length) return 0;

    try {
      const account = JSON.parse(rows[0].account_json || '{}');
      const baselineBalance = Number(account?.balance);
      if (!Number.isFinite(baselineBalance) || !Number.isFinite(currentBalance)) return 0;
      return Math.max(0, baselineBalance - currentBalance);
    } catch {
      return 0;
    }
  }

  public getLocalRecord(id:string){ return this.localRecords.get(id); }
  public getAllLocalRecords(){ return Array.from(this.localRecords.values()); }

  public async loadRecentRecords(limit=100):Promise<ReconciliationRecord[]> {
    const rows=await executeQuery<any>(
      'SELECT payload_json FROM trade_trace_nodes WHERE node_id LIKE ? ORDER BY timestamp DESC LIMIT ?',
      ['recon-RECON-%',limit]
    );
    return rows.map(r=>JSON.parse(r.payload_json) as ReconciliationRecord);
  }
}

export const reconciliationService = new ReconciliationService();
