import { executeQuery, executeRun } from '../database/db';

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

// Compatibility API retained so existing callers continue to work.
// Persistence is SQLite-only; no Firestore network calls are made.

export async function getOrCreatePaperPortfolio(user: LocalUser): Promise<CloudPaperPortfolio> {
  const rows = await executeQuery<any>('SELECT balance, equity, margin_used, free_margin, currency FROM portfolio WHERE id = ?', ['paper_account']);
  if (rows.length) {
    return {
      userId: user.uid,
      balance: Number(rows[0].balance),
      equity: Number(rows[0].equity),
      marginUsed: Number(rows[0].margin_used),
      freeMargin: Number(rows[0].free_margin),
      currency: String(rows[0].currency),
      updatedAt: Date.now()
    };
  }
  throw new Error('LOCAL_PORTFOLIO_UNAVAILABLE');
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

export async function resetPaperPortfolioInCloud(user: LocalUser): Promise<void> {
  await executeRun(
    'UPDATE portfolio SET balance = 100000, equity = 100000, margin_used = 0, free_margin = 100000, currency = ? WHERE id = ?',
    ['USD', 'paper_account']
  );
}

export async function subscribeOpenPaperTrades(
  userId: string,
  onUpdate: (trades: CloudPaperTrade[]) => void,
  onError?: (err: any) => void
): Promise<() => void> {
  let active = true;
  const poll = async () => {
    try {
      const rows = await executeQuery<any>(
        'SELECT id, instrument AS symbol, instrument, direction, entry_price, exit_price, size AS quantity, stop_loss, take_profit, pnl, status, entry_time, exit_time FROM trades ORDER BY entry_time DESC'
      );
      const trades = rows.map(r => ({
        id: r.id,
        userId,
        symbol: r.symbol,
        market: 'LOCAL',
        type: r.direction,
        entryPrice: Number(r.entry_price),
        exitPrice: r.exit_price == null ? undefined : Number(r.exit_price),
        quantity: Number(r.quantity),
        stopLoss: Number(r.stop_loss || 0),
        takeProfit: Number(r.take_profit || 0),
        pnl: Number(r.pnl || 0),
        status: r.status === 'OPEN' ? 'OPEN' : 'CLOSED',
        openedAt: Number(r.entry_time),
        closedAt: r.exit_time == null ? undefined : Number(r.exit_time)
      })) as CloudPaperTrade[];
      if (active) onUpdate(trades);
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function createCloudPaperTrade(trade: Omit<CloudPaperTrade, 'id' | 'userId' | 'openedAt'>): Promise<string> {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await executeRun(
    'INSERT INTO trades (id, signal_id, instrument, direction, entry_price, size, status, entry_time, pnl) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0)',
    [id, trade.symbol, trade.type, trade.entryPrice, trade.quantity, 'OPEN', Date.now()]
  );
  return id;
}

export async function closeCloudPaperTrade(tradeId: string, exitPrice: number, pnl: number): Promise<void> {
  await executeRun(
    'UPDATE trades SET status = ?, exit_price = ?, pnl = ?, exit_time = ? WHERE id = ?',
    ['CLOSED', exitPrice, pnl, Date.now(), tradeId]
  );
}

export async function subscribeCloudTrackedSignals(
  _userId: string,
  onUpdate: (signals: CloudTrackedSignal[]) => void,
  onError?: (err: any) => void
): Promise<() => void> {
  let active = true;
  const poll = async () => {
    try {
      const rows = await executeQuery<any>(
        'SELECT id, pair, direction, entry_price, current_price, stop_loss, tp1, tp2, tp3, unrealized_pnl_pips, status, last_updated_timestamp FROM paper_tracking ORDER BY last_updated_timestamp DESC'
      );
      if (active) onUpdate(rows.map(r => ({
        id: r.id,
        userId: _userId,
        pair: r.pair,
        direction: r.direction,
        entryPrice: Number(r.entry_price),
        currentPrice: Number(r.current_price),
        stopLoss: Number(r.stop_loss),
        tp1: Number(r.tp1),
        tp2: Number(r.tp2),
        tp3: Number(r.tp3),
        unrealizedPnlPips: Number(r.unrealized_pnl_pips),
        status: r.status,
        timestamp: Number(r.last_updated_timestamp)
      })));
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function addCloudTrackedSignal(signal: Omit<CloudTrackedSignal, 'id' | 'userId' | 'timestamp'>): Promise<string> {
  const id = `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await executeRun(
    'INSERT INTO paper_tracking (id, signal_id, pair, direction, entry_price, current_price, stop_loss, tp1, tp2, tp3, unrealized_pnl_pips, unrealized_pnl_usd, status, entry_timestamp, last_updated_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, '', signal.pair, signal.direction, signal.entryPrice, signal.currentPrice, signal.stopLoss, signal.tp1, signal.tp2 || 0, signal.tp3 || 0, signal.unrealizedPnlPips, 0, signal.status, Date.now(), Date.now()]
  );
  return id;
}

export function subscribeCloudTradeNotes(
  _userId: string,
  onUpdate: (notes: CloudTradeNote[]) => void,
  onError?: (err: any) => void
): () => void {
  let active = true;
  const poll = async () => {
    try {
      const rows = await executeQuery<any>('SELECT id, title, content, symbol, created_at, updated_at FROM trade_notes ORDER BY created_at DESC');
      if (active) onUpdate(rows.map(r => ({ id: r.id, userId: _userId, title: r.title, content: r.content, symbol: r.symbol || undefined, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) })));
    } catch (err) {
      if (active && onError) onError(err);
    }
  };
  void poll();
  const timer = setInterval(poll, 15000);
  return () => { active = false; clearInterval(timer); };
}

export async function addCloudTradeNote(title: string, content: string, symbol?: string): Promise<string> {
  const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  await executeRun('INSERT INTO trade_notes (id, title, content, symbol, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, title, content, symbol || null, now, now]);
  return id;
}

export async function deleteCloudTradeNote(noteId: string): Promise<void> {
  await executeRun('DELETE FROM trade_notes WHERE id = ?', [noteId]);
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
