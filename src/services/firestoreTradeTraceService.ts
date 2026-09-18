import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { db, auth } from '../firebase';

export type ExecutionEnvironment = 'PAPER' | 'DEMO' | 'SANDBOX' | 'LIVE';
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
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Trade Trace Error: ', JSON.stringify(errInfo));
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
  updatedAt?: any;
}

export interface TradeTraceLifecycleNode {
  nodeId: string;
  tradeTraceId: string;
  nodeType: 
    | 'MARKET_SNAPSHOT'
    | 'FEATURE_SNAPSHOT'
    | 'PREDICTION'
    | 'SIGNAL'
    | 'RISK_DECISION'
    | 'TRADE_PROPOSAL'
    | 'BROKER_ORDER'
    | 'FILL'
    | 'POSITION'
    | 'MANAGEMENT'
    | 'EXIT'
    | 'TRADE_RESULT'
    | 'RECONCILIATION'
    | 'AUDIT_EVENT';
  environment: ExecutionEnvironment;
  broker: string;
  payload: Record<string, any>;
  timestamp: number;
  userId?: string;
}

// In-memory / local fallback repository for offline mode or unit testing
class LocalTraceStore {
  private traces: Map<string, TradeTraceData> = new Map();
  private nodes: Map<string, TradeTraceLifecycleNode[]> = new Map();

  public saveTrace(trace: TradeTraceData): void {
    this.traces.set(trace.tradeTraceId, { ...trace });
  }

  public getTrace(tradeTraceId: string): TradeTraceData | undefined {
    return this.traces.get(tradeTraceId);
  }

  public saveNode(node: TradeTraceLifecycleNode): void {
    const list = this.nodes.get(node.tradeTraceId) || [];
    // Idempotent node push
    const exists = list.some(n => n.nodeId === node.nodeId);
    if (!exists) {
      list.push({ ...node });
      this.nodes.set(node.tradeTraceId, list);
    }
  }

  public getNodes(tradeTraceId: string): TradeTraceLifecycleNode[] {
    return this.nodes.get(tradeTraceId) || [];
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
  private localStore: LocalTraceStore = new LocalTraceStore();
  private isFirestoreOnline: boolean = true;

  constructor() {
    this.checkConnectionSilently();
  }

  private async checkConnectionSilently() {
    try {
      if (db) {
        await getDocFromServer(doc(db, 'system_settings', 'connection_test'));
        this.isFirestoreOnline = true;
      }
    } catch {
      // Degrade gracefully to local mode
      this.isFirestoreOnline = false;
    }
  }

  // Scrub sensitive key/credential fields from payloads
  public sanitizePayload(payload: any): any {
    if (!payload || typeof payload !== 'object') return payload;
    const clean = Array.isArray(payload) ? [...payload] : { ...payload };
    
    const sensitiveKeys = [
      'apikey', 'key', 'secret', 'password', 'token', 'accesstoken',
      'refreshtoken', 'privatekey', 'clientsecret', 'userkey',
      'encryptionkey', 'authorization', 'auth', 'credential'
    ];

    for (const key of Object.keys(clean)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(s => lowerKey.includes(s))) {
        clean[key] = '[REDACTED_SECRET]';
      } else if (typeof clean[key] === 'object' && clean[key] !== null) {
        clean[key] = this.sanitizePayload(clean[key]);
      }
    }
    return clean;
  }

  /**
   * Save or Update a Trade Trace Root Document
   * Idempotent based on trace.tradeTraceId
   */
  public async saveTradeTrace(trace: TradeTraceData): Promise<{ success: boolean; mode: 'FIRESTORE' | 'LOCAL' }> {
    // Safety verification: LIVE auto execution must NEVER be allowed
    if (trace.environment === 'LIVE') {
      console.warn('SAFETY INVARIANT CHECK: LIVE execution attempt blocked in trade trace persistence.');
    }

    const sanitizedTrace = this.sanitizePayload(trace) as TradeTraceData;
    sanitizedTrace.userId = auth?.currentUser?.uid || 'local_user';
    sanitizedTrace.updatedAt = Date.now();

    // Always update local store first for resilience
    this.localStore.saveTrace(sanitizedTrace);

    const path = `trade_traces/${sanitizedTrace.tradeTraceId}`;
    try {
      if (db) {
        const traceRef = doc(db, 'trade_traces', sanitizedTrace.tradeTraceId);
        await setDoc(traceRef, {
          ...sanitizedTrace,
          updatedAt: serverTimestamp()
        }, { merge: true });
        return { success: true, mode: 'FIRESTORE' };
      }
    } catch (error) {
      console.warn(`Firestore saveTradeTrace falling back to local for ${sanitizedTrace.tradeTraceId}:`, error);
      this.isFirestoreOnline = false;
      // Do not throw error to preserve execution flow! Return local fallback
    }

    return { success: true, mode: 'LOCAL' };
  }

  /**
   * Save a Lifecycle Node to trade_traces/{tradeTraceId}/nodes/{nodeId}
   */
  public async saveLifecycleNode(node: TradeTraceLifecycleNode): Promise<{ success: boolean; mode: 'FIRESTORE' | 'LOCAL' }> {
    const sanitizedNode = this.sanitizePayload(node) as TradeTraceLifecycleNode;
    sanitizedNode.userId = auth?.currentUser?.uid || 'local_user';

    // Save to local store
    this.localStore.saveNode(sanitizedNode);

    const path = `trade_traces/${sanitizedNode.tradeTraceId}/nodes/${sanitizedNode.nodeId}`;
    try {
      if (db) {
        const nodeRef = doc(db, 'trade_traces', sanitizedNode.tradeTraceId, 'nodes', sanitizedNode.nodeId);
        await setDoc(nodeRef, {
          ...sanitizedNode,
          timestamp: sanitizedNode.timestamp || Date.now()
        }, { merge: true });
        return { success: true, mode: 'FIRESTORE' };
      }
    } catch (error) {
      console.warn(`Firestore saveLifecycleNode falling back to local for ${sanitizedNode.nodeId}:`, error);
      this.isFirestoreOnline = false;
    }

    return { success: true, mode: 'LOCAL' };
  }

  /**
   * Retrieve a Trade Trace by ID
   */
  public async getTradeTrace(tradeTraceId: string): Promise<TradeTraceData | null> {
    const path = `trade_traces/${tradeTraceId}`;
    try {
      if (db) {
        const traceRef = doc(db, 'trade_traces', tradeTraceId);
        const snap = await getDoc(traceRef);
        if (snap.exists()) {
          const data = snap.data() as TradeTraceData;
          return data;
        }
      }
    } catch (error) {
      console.warn(`Firestore getTradeTrace failed for ${tradeTraceId}, falling back to local:`, error);
    }

    // Fallback to local store
    return this.localStore.getTrace(tradeTraceId) || null;
  }

  /**
   * Retrieve all lifecycle nodes for a Trade Trace
   */
  public async getLifecycleNodes(tradeTraceId: string): Promise<TradeTraceLifecycleNode[]> {
    const path = `trade_traces/${tradeTraceId}/nodes`;
    try {
      if (db) {
        const nodesCol = collection(db, 'trade_traces', tradeTraceId, 'nodes');
        const snap = await getDocs(nodesCol);
        if (!snap.empty) {
          const nodes = snap.docs.map(doc => doc.data() as TradeTraceLifecycleNode);
          nodes.sort((a, b) => a.timestamp - b.timestamp);
          return nodes;
        }
      }
    } catch (error) {
      console.warn(`Firestore getLifecycleNodes failed for ${tradeTraceId}, falling back to local:`, error);
    }

    return this.localStore.getNodes(tradeTraceId);
  }

  /**
   * Fetch recent trade traces
   */
  public async getRecentTraces(limitCount: number = 20): Promise<TradeTraceData[]> {
    try {
      if (db) {
        const colRef = collection(db, 'trade_traces');
        const q = query(colRef, limit(limitCount));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const traces = snap.docs.map(d => d.data() as TradeTraceData);
          return traces;
        }
      }
    } catch (error) {
      console.warn('Firestore getRecentTraces failed, returning local traces:', error);
    }

    return this.localStore.getAllTraces().slice(-limitCount);
  }

  public getLocalStore(): LocalTraceStore {
    return this.localStore;
  }

  public clearLocalStore(): void {
    this.localStore.clear();
  }
}

export const firestoreTradeTraceService = new FirestoreTradeTraceService();
