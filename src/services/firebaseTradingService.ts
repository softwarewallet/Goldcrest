import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  Unsubscribe
} from 'firebase/firestore';
import { db, auth, ensureAuthenticatedUser, firebaseConfig, LocalUser } from '../firebase';
import { User } from 'firebase/auth';

export interface CloudPaperPortfolio {
  userId: string;
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  currency: string;
  updatedAt?: any;
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
  openedAt: any;
  closedAt?: any;
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
  timestamp: any;
}

export interface CloudTradeNote {
  id?: string;
  userId: string;
  title: string;
  content: string;
  symbol?: string;
  createdAt: any;
  updatedAt: any;
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

// -------------------------------------------------------------
// PORTFOLIO OPERATIONS
// -------------------------------------------------------------

export async function getOrCreatePaperPortfolio(user: User): Promise<CloudPaperPortfolio> {
  const docRef = doc(db, 'paper_portfolios', user.uid);
  const snap = await getDoc(docRef);

  if (snap.exists()) {
    return snap.data() as CloudPaperPortfolio;
  }

  const initialPortfolio: CloudPaperPortfolio = {
    userId: user.uid,
    balance: 100000.0,
    equity: 100000.0,
    marginUsed: 0.0,
    freeMargin: 100000.0,
    currency: 'USD',
    updatedAt: serverTimestamp()
  };

  await setDoc(docRef, initialPortfolio);
  return initialPortfolio;
}

export function subscribePaperPortfolio(
  userId: string,
  onUpdate: (portfolio: CloudPaperPortfolio) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const docRef = doc(db, 'paper_portfolios', userId);
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as CloudPaperPortfolio);
      } else {
        // Fallback default
        onUpdate({
          userId,
          balance: 100000.0,
          equity: 100000.0,
          marginUsed: 0.0,
          freeMargin: 100000.0,
          currency: 'USD'
        });
      }
    },
    (err) => {
      console.warn('Firestore portfolio sync error:', err);
      if (onError) onError(err);
    }
  );
}

export async function resetPaperPortfolioInCloud(user: User | LocalUser): Promise<void> {
  const docRef = doc(db, 'paper_portfolios', user.uid);
  await setDoc(docRef, {
    userId: user.uid,
    balance: 100000.0,
    equity: 100000.0,
    marginUsed: 0.0,
    freeMargin: 100000.0,
    currency: 'USD',
    updatedAt: serverTimestamp()
  });
}

// -------------------------------------------------------------
// PAPER TRADES & POSITIONS
// -------------------------------------------------------------

export function subscribeOpenPaperTrades(
  userId: string,
  onUpdate: (trades: CloudPaperTrade[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const colRef = collection(db, 'paper_trades');
  const q = query(
    colRef,
    where('userId', '==', userId),
    where('status', '==', 'OPEN')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const trades: CloudPaperTrade[] = [];
      snapshot.forEach((docSnap) => {
        trades.push({
          id: docSnap.id,
          ...docSnap.data()
        } as CloudPaperTrade);
      });
      onUpdate(trades);
    },
    (err) => {
      console.warn('Firestore paper trades sync error:', err);
      if (onError) onError(err);
    }
  );
}

export async function createCloudPaperTrade(
  trade: Omit<CloudPaperTrade, 'id' | 'userId' | 'openedAt'>
): Promise<string> {
  const user = await ensureAuthenticatedUser();
  const colRef = collection(db, 'paper_trades');

  const docRef = await addDoc(colRef, {
    ...trade,
    userId: user.uid,
    status: 'OPEN',
    openedAt: serverTimestamp()
  });

  return docRef.id;
}

export async function closeCloudPaperTrade(
  tradeId: string,
  exitPrice: number,
  pnl: number
): Promise<void> {
  const docRef = doc(db, 'paper_trades', tradeId);
  await updateDoc(docRef, {
    status: 'CLOSED',
    exitPrice,
    pnl,
    closedAt: serverTimestamp()
  });
}

// -------------------------------------------------------------
// TRACKED FOREX & OPTIONS SIGNALS
// -------------------------------------------------------------

export function subscribeCloudTrackedSignals(
  userId: string,
  onUpdate: (signals: CloudTrackedSignal[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const colRef = collection(db, 'paper_signals_tracked');
  const q = query(colRef, where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const signals: CloudTrackedSignal[] = [];
      snapshot.forEach((docSnap) => {
        signals.push({
          id: docSnap.id,
          ...docSnap.data()
        } as CloudTrackedSignal);
      });
      onUpdate(signals);
    },
    (err) => {
      console.warn('Firestore tracked signals sync error:', err);
      if (onError) onError(err);
    }
  );
}

export async function addCloudTrackedSignal(
  signal: Omit<CloudTrackedSignal, 'id' | 'userId' | 'timestamp'>
): Promise<string> {
  const user = await ensureAuthenticatedUser();
  const colRef = collection(db, 'paper_signals_tracked');

  const docRef = await addDoc(colRef, {
    ...signal,
    userId: user.uid,
    timestamp: serverTimestamp()
  });

  return docRef.id;
}

// -------------------------------------------------------------
// TRADE JOURNAL & NOTES
// -------------------------------------------------------------

export function subscribeCloudTradeNotes(
  userId: string,
  onUpdate: (notes: CloudTradeNote[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  const colRef = collection(db, 'trade_notes');
  const q = query(colRef, where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const notes: CloudTradeNote[] = [];
      snapshot.forEach((docSnap) => {
        notes.push({
          id: docSnap.id,
          ...docSnap.data()
        } as CloudTradeNote);
      });
      // Sort newest first
      notes.sort((a, b) => {
        const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now();
        const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.now();
        return tB - tA;
      });
      onUpdate(notes);
    },
    (err) => {
      console.warn('Firestore trade notes sync error:', err);
      if (onError) onError(err);
    }
  );
}

export async function addCloudTradeNote(
  title: string,
  content: string,
  symbol?: string
): Promise<string> {
  const user = await ensureAuthenticatedUser();
  const colRef = collection(db, 'trade_notes');

  const docRef = await addDoc(colRef, {
    userId: user.uid,
    title,
    content,
    symbol: symbol || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return docRef.id;
}

export async function deleteCloudTradeNote(noteId: string): Promise<void> {
  const docRef = doc(db, 'trade_notes', noteId);
  await deleteDoc(docRef);
}

// -------------------------------------------------------------
// FIRESTORE HEALTH & DIAGNOSTICS PING
// -------------------------------------------------------------

export async function checkFirestoreConnection(): Promise<FirestoreStatus> {
  const startTime = Date.now();
  try {
    const user = await ensureAuthenticatedUser();
    // Quick test ping by reading user's own portfolio doc
    const testDoc = doc(db, 'paper_portfolios', user.uid);
    await getDoc(testDoc);

    const latencyMs = Date.now() - startTime;
    return {
      connected: true,
      projectId: firebaseConfig.projectId || 'goldcrestfinman-trading',
      databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
      userId: user.uid,
      latencyMs,
      lastPingTime: Date.now()
    };
  } catch (err: any) {
    return {
      connected: false,
      projectId: firebaseConfig.projectId || 'goldcrestfinman-trading',
      databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
      userId: auth.currentUser?.uid || null,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Failed to ping Firestore'
    };
  }
}
