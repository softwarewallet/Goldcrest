export interface LocalUser {
  uid: string;
  email?: string | null;
}

export interface CloudPaperPortfolio {
  userId: string;
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  currency: string;
  updatedAt?: number;
}

export interface CloudPaperTrade {
  id?: string;
  userId: string;
  symbol: string;
  market: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: number;
  closedAt?: number;
}

export interface CloudTrackedSignal {
  id?: string;
  userId: string;
  pair: string;
  direction: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  unrealizedPnlPips: number;
  status: string;
  timestamp: number;
}

export interface CloudTradeNote {
  id?: string;
  userId: string;
  title: string;
  content: string;
  symbol?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FirestoreStatus {
  connected: boolean;
  projectId: string;
  databaseId: string;
  userId: string | null;
  latencyMs: number;
  error?: string;
  lastPingTime?: number;
}

// Client-side API service connecting React UI to Express SQLite routes
export async function getOrCreatePaperPortfolio(user: LocalUser): Promise<CloudPaperPortfolio> {
  try {
    const res = await fetch('/api/paper/portfolio');
    if (!res.ok) throw new Error('Failed to fetch paper portfolio');
    const data = await res.json();
    return { ...data, userId: user.uid };
  } catch {
    return {
      userId: user.uid,
      balance: 100000,
      equity: 100000,
      marginUsed: 0,
      freeMargin: 100000,
      currency: 'USD',
      updatedAt: Date.now()
    };
  }
}

export function subscribePaperPortfolio(
  userId: string,
  onUpdate: (portfolio: CloudPaperPortfolio) => void,
  onError?: (err: any) => void
): () => void {
  let active = true;
  const poll = async () => {
    try {
      const portfolio = await getOrCreatePaperPortfolio({ uid: userId });
      if (active) onUpdate(portfolio);
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function resetPaperPortfolioInCloud(_user: LocalUser): Promise<void> {
  await fetch('/api/paper/portfolio/reset', { method: 'POST' });
}

export function subscribeOpenPaperTrades(
  userId: string,
  onUpdate: (trades: CloudPaperTrade[]) => void,
  onError?: (err: any) => void
): () => void {
  let active = true;
  const poll = async () => {
    try {
      const res = await fetch('/api/paper/trades');
      if (res.ok) {
        const trades = await res.json();
        if (active) onUpdate(trades.map((t: any) => ({ ...t, userId })));
      }
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function createCloudPaperTrade(trade: Omit<CloudPaperTrade, 'id' | 'userId' | 'openedAt'>): Promise<string> {
  const res = await fetch('/api/paper/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade)
  });
  const data = await res.json();
  return data.id || `local_${Date.now()}`;
}

export async function closeCloudPaperTrade(tradeId: string, exitPrice: number, pnl: number): Promise<void> {
  await fetch('/api/paper/trades/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tradeId, exitPrice, pnl })
  });
}

export function subscribeCloudTrackedSignals(
  _userId: string,
  onUpdate: (signals: CloudTrackedSignal[]) => void,
  onError?: (err: any) => void
): () => void {
  let active = true;
  const poll = async () => {
    try {
      const res = await fetch('/api/forex/paper/tracked');
      if (res.ok) {
        const tracked = await res.json();
        if (active) onUpdate(tracked.map((r: any) => ({
          id: r.id,
          userId: _userId,
          pair: r.pair || r.instrument,
          direction: r.direction,
          entryPrice: Number(r.entryPrice || r.entry_price || 0),
          currentPrice: Number(r.currentPrice || r.current_price || 0),
          stopLoss: Number(r.stopLoss || r.stop_loss || 0),
          tp1: Number(r.tp1 || 0),
          tp2: Number(r.tp2 || 0),
          tp3: Number(r.tp3 || 0),
          unrealizedPnlPips: Number(r.unrealizedPnlPips || r.unrealized_pnl_pips || 0),
          status: r.status || 'TRACKING',
          timestamp: Number(r.timestamp || r.last_updated_timestamp || Date.now())
        })));
      }
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function addCloudTrackedSignal(signal: Omit<CloudTrackedSignal, 'id' | 'userId' | 'timestamp'>): Promise<string> {
  const res = await fetch('/api/forex/paper/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signal: {
        id: `sig_${Date.now()}`,
        pair: signal.pair,
        action: signal.direction,
        qualified: true,
        tradePlan: {
          entryPreferred: signal.entryPrice,
          stopLoss: signal.stopLoss,
          target1: signal.tp1
        }
      },
      currentPrice: signal.currentPrice
    })
  });
  const data = await res.json();
  return data.id || `track_${Date.now()}`;
}

export function subscribeCloudTradeNotes(
  _userId: string,
  onUpdate: (notes: CloudTradeNote[]) => void,
  onError?: (err: any) => void
): () => void {
  let active = true;
  const poll = async () => {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const notes = await res.json();
        if (active) onUpdate(notes.map((n: any) => ({ ...n, userId: _userId })));
      }
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function addCloudTradeNote(title: string, content: string, symbol?: string): Promise<string> {
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, symbol })
  });
  const data = await res.json();
  return data.id || `note_${Date.now()}`;
}

export async function deleteCloudTradeNote(noteId: string): Promise<void> {
  await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
}

export async function checkFirestoreConnection(): Promise<FirestoreStatus> {
  return {
    connected: false,
    projectId: 'disabled',
    databaseId: 'sqlite',
    userId: null,
    latencyMs: 0,
    error: 'FIRESTORE_DISABLED_SQLITE_ONLY'
  };
}
