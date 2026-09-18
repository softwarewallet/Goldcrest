import { executeQuery, executeRun } from '../database/db';
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
