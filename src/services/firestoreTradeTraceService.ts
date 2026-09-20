import { executeQuery, executeRun } from '../database/db';

export type ExecutionEnvironment = 'LIVE';
export type TraceStatus = 'PENDING' | 'EXECUTED' | 'RECONCILED' | 'RECONCILIATION_MISMATCH' | 'FAILED';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: Record<string, any>;
}

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: { userId: 'local_trader_01', authenticated: true }
  };
  throw new Error(JSON.stringify(errInfo));
}

export interface TradeTraceData {
  tradeTraceId: string;
  signalId: string;
  environment: ExecutionEnvironment;
  broker: string;
  marketDataSnapshotId: string;
  featureSnapshotId: string;
  deterministicAnalysisId: string;
  mlPredictionId: string;
  decisionFusionState: string;
  riskDecisionId: string;
  orderProposalId: string;
  brokerOrderId?: string;
  fillIds: string[];
  positionId?: string;
  exitIds: string[];
  tradeOutcomeId?: string;
  researchRecordId: string;
  datasetVersion: string;
  strategyVersion: string;
  modelVersion: string;
  status: TraceStatus;
  timestamp: number;
  userId?: string;
  updatedAt?: number;
}

export interface TradeTraceLifecycleNode {
  nodeId: string;
  tradeTraceId: string;
  nodeType:
    | 'MARKET_SNAPSHOT' | 'FEATURE_SNAPSHOT' | 'PREDICTION' | 'SIGNAL'
    | 'RISK_DECISION' | 'TRADE_PROPOSAL' | 'BROKER_ORDER' | 'FILL'
    | 'POSITION' | 'MANAGEMENT' | 'EXIT' | 'TRADE_RESULT'
    | 'RECONCILIATION' | 'AUDIT_EVENT';
  environment: ExecutionEnvironment;
  broker: string;
  payload: Record<string, any>;
  timestamp: number;
  userId?: string;
}

class LocalTraceStore {
  private traces = new Map<string, TradeTraceData>();
  private nodes = new Map<string, TradeTraceLifecycleNode[]>();

  public saveTrace(trace: TradeTraceData): void {
    this.traces.set(trace.tradeTraceId, { ...trace });
  }

  public getTrace(id: string): TradeTraceData | undefined {
    return this.traces.get(id);
  }

  public saveNode(node: TradeTraceLifecycleNode): void {
    const list = this.nodes.get(node.tradeTraceId) || [];
    if (!list.some(n => n.nodeId === node.nodeId)) list.push({ ...node });
    this.nodes.set(node.tradeTraceId, list);
  }

  public getNodes(id: string): TradeTraceLifecycleNode[] {
    return this.nodes.get(id) || [];
  }

  public getAllTraces(): TradeTraceData[] {
    return Array.from(this.traces.values());
  }

  public clear(): void {
    this.traces.clear();
    this.nodes.clear();
  }
}

export class FirestoreTradeTraceService {
  private localStore = new LocalTraceStore();

  public sanitizePayload(payload: any): any {
    if (!payload || typeof payload !== 'object') return payload;
    const clean = Array.isArray(payload) ? [...payload] : { ...payload };
    const sensitiveKeys = ['apikey', 'key', 'secret', 'password', 'token', 'accesstoken', 'refreshtoken', 'privatekey', 'clientsecret', 'userkey', 'encryptionkey', 'authorization', 'auth', 'credential'];
    for (const key of Object.keys(clean)) {
      const lower = key.toLowerCase();
      if (sensitiveKeys.some(s => lower.includes(s))) clean[key] = '[REDACTED_SECRET]';
      else if (typeof clean[key] === 'object' && clean[key] !== null) clean[key] = this.sanitizePayload(clean[key]);
    }
    return clean;
  }

  public async saveTradeTrace(trace: TradeTraceData): Promise<{ success: boolean; mode: 'SQLITE' }> {
    const sanitized = this.sanitizePayload({ ...trace, updatedAt: Date.now() }) as TradeTraceData;
    this.localStore.saveTrace(sanitized);
    await executeRun(
      'INSERT OR REPLACE INTO trade_traces (trade_trace_id, payload_json, timestamp, updated_at) VALUES (?, ?, ?, ?)',
      [sanitized.tradeTraceId, JSON.stringify(sanitized), sanitized.timestamp, sanitized.updatedAt]
    );
    return { success: true, mode: 'SQLITE' };
  }

  public async saveLifecycleNode(node: TradeTraceLifecycleNode): Promise<{ success: boolean; mode: 'SQLITE' }> {
    const sanitized = this.sanitizePayload(node) as TradeTraceLifecycleNode;
    this.localStore.saveNode(sanitized);
    await executeRun(
      'INSERT OR REPLACE INTO trade_trace_nodes (node_id, trade_trace_id, payload_json, timestamp) VALUES (?, ?, ?, ?)',
      [sanitized.nodeId, sanitized.tradeTraceId, JSON.stringify(sanitized), sanitized.timestamp]
    );
    return { success: true, mode: 'SQLITE' };
  }

  public async getTradeTrace(id: string): Promise<TradeTraceData | null> {
    const rows = await executeQuery<any>('SELECT payload_json FROM trade_traces WHERE trade_trace_id = ?', [id]);
    if (rows.length) return JSON.parse(rows[0].payload_json) as TradeTraceData;
    return this.localStore.getTrace(id) || null;
  }

  public async getLifecycleNodes(id: string): Promise<TradeTraceLifecycleNode[]> {
    const rows = await executeQuery<any>('SELECT payload_json FROM trade_trace_nodes WHERE trade_trace_id = ? AND node_id NOT LIKE "recon-%" ORDER BY timestamp ASC', [id]);
    if (rows.length) return rows.map(r => JSON.parse(r.payload_json) as TradeTraceLifecycleNode);
    return this.localStore.getNodes(id).filter(n => !n.nodeId.startsWith('recon-'));
  }

  public async getRecentTraces(limitCount = 20): Promise<TradeTraceData[]> {
    const rows = await executeQuery<any>('SELECT payload_json FROM trade_traces ORDER BY timestamp DESC LIMIT ?', [limitCount]);
    return rows.map(r => JSON.parse(r.payload_json) as TradeTraceData);
  }

  public getLocalStore(): LocalTraceStore {
    return this.localStore;
  }

  public clearLocalStore(): void {
    this.localStore.clear();
  }
}

export const firestoreTradeTraceService = new FirestoreTradeTraceService();
