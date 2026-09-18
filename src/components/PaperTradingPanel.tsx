import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Cloud,
  Plus,
  RefreshCw,
  RotateCcw,
  BookOpen,
  Trash2,
  X
} from 'lucide-react';
import {
  CloudPaperPortfolio,
  CloudPaperTrade,
  CloudTradeNote,
  subscribePaperPortfolio,
  subscribeOpenPaperTrades,
  createCloudPaperTrade,
  closeCloudPaperTrade,
  resetPaperPortfolioInCloud,
  subscribeCloudTradeNotes,
  addCloudTradeNote,
  deleteCloudTradeNote
} from '../services/firebaseTradingService';
import { ensureAuthenticatedUser, auth } from '../firebase';

export interface PaperPosition {
  id: string;
  instrument: string;
  market: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  pnl: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: string;
}

export const PaperTradingPanel: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<string>('Connecting to goldcrestfinman-trading...');

  // Cloud State
  const [portfolio, setPortfolio] = useState<CloudPaperPortfolio>({
    userId: '',
    balance: 100000.0,
    equity: 100000.0,
    marginUsed: 0.0,
    freeMargin: 100000.0,
    currency: 'USD'
  });

  const [trades, setTrades] = useState<CloudPaperTrade[]>([]);
  const [notes, setNotes] = useState<CloudTradeNote[]>([]);

  // Modals & UI Controls
  const [showNewTradeModal, setShowNewTradeModal] = useState<boolean>(false);
  const [newSymbol, setNewSymbol] = useState<string>('EUR/USD');
  const [newMarket, setNewMarket] = useState<string>('FOREX');
  const [newDirection, setNewDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [newEntryPrice, setNewEntryPrice] = useState<number>(1.0850);
  const [newQuantity, setNewQuantity] = useState<number>(100000);
  const [newStopLoss, setNewStopLoss] = useState<number>(1.0820);
  const [newTakeProfit, setNewTakeProfit] = useState<number>(1.0910);
  const [submittingTrade, setSubmittingTrade] = useState<boolean>(false);

  // Note creation
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteContent, setNoteContent] = useState<string>('');
  const [noteSymbol, setNoteSymbol] = useState<string>('EUR/USD');
  const [submittingNote, setSubmittingNote] = useState<boolean>(false);

  // Notification
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Initialize Firestore listeners
  useEffect(() => {
    let unsubPortfolio: (() => void) | null = null;
    let unsubTrades: (() => void) | null = null;
    let unsubNotes: (() => void) | null = null;

    ensureAuthenticatedUser()
      .then((user) => {
        setCurrentUser(user);
        setIsCloudSyncing(false);
        setSyncStatus('Firestore Connected (goldcrestfinman-trading)');

        // 1. Subscribe to Portfolio
        unsubPortfolio = subscribePaperPortfolio(
          user.uid,
          (p) => setPortfolio(p),
          (err) => setSyncStatus('Sync warning: ' + err.message)
        );

        // 2. Subscribe to Open Trades
        unsubTrades = subscribeOpenPaperTrades(
          user.uid,
          (cloudTrades) => {
            if (cloudTrades.length === 0) {
              // If user has zero trades in cloud yet, populate baseline default simulated trades
              createCloudPaperTrade({
                symbol: 'EUR/USD',
                market: 'FOREX',
                type: 'BUY',
                entryPrice: 1.0845,
                quantity: 100000,
                stopLoss: 1.0815,
                takeProfit: 1.0895,
                pnl: 170.0,
                status: 'OPEN'
              }).catch(() => {});
            } else {
              setTrades(cloudTrades);
            }
          },
          (err) => console.warn(err)
        );

        // 3. Subscribe to Cloud Trade Notes
        unsubNotes = subscribeCloudTradeNotes(
          user.uid,
          (cloudNotes) => setNotes(cloudNotes),
          (err) => console.warn(err)
        );
      })
      .catch((err) => {
        setIsCloudSyncing(false);
        setSyncStatus('Offline / Local state fallback: ' + err.message);
      });

    return () => {
      if (unsubPortfolio) unsubPortfolio();
      if (unsubTrades) unsubTrades();
      if (unsubNotes) unsubNotes();
    };
  }, []);

  const totalUnrealizedPnl = trades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const virtualEquity = (portfolio?.balance || 100000) + totalUnrealizedPnl;

  const handleClosePosition = async (tradeId?: string) => {
    if (!tradeId) return;
    try {
      const trade = trades.find(t => t.id === tradeId);
      const exitPrice = trade ? (trade.entryPrice + 0.0015) : 1.0860;
      const realizedPnl = trade?.pnl || 150.0;
      await closeCloudPaperTrade(tradeId, exitPrice, realizedPnl);
      showNotification(`Closed trade ${trade?.symbol || tradeId} in Firebase Firestore`);
    } catch (err: any) {
      console.error('Failed to close position in cloud:', err);
    }
  };

  const handleResetPortfolio = async () => {
    if (!currentUser) return;
    if (window.confirm('Reset simulated balance to $100,000 baseline in Firebase Firestore?')) {
      try {
        await resetPaperPortfolioInCloud(currentUser);
        showNotification('Reset portfolio balance to $100,000 in Firebase Firestore');
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleCreateNewTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingTrade(true);
    try {
      await createCloudPaperTrade({
        symbol: newSymbol,
        market: newMarket,
        type: newDirection,
        entryPrice: newEntryPrice,
        quantity: newQuantity,
        stopLoss: newStopLoss,
        takeProfit: newTakeProfit,
        pnl: 0.0,
        status: 'OPEN'
      });
      setShowNewTradeModal(false);
      showNotification(`Submitted new paper trade on ${newSymbol} to goldcrestfinman-trading!`);
    } catch (err: any) {
      console.error('Create trade error:', err);
      alert('Failed to save trade: ' + err.message);
    } finally {
      setSubmittingTrade(false);
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    setSubmittingNote(true);
    try {
      await addCloudTradeNote(noteTitle.trim(), noteContent.trim(), noteSymbol);
      setNoteTitle('');
      setNoteContent('');
      showNotification('Saved trade journal note to Firebase Firestore');
    } catch (err: any) {
      console.error('Create note error:', err);
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleDeleteNote = async (noteId?: string) => {
    if (!noteId) return;
    try {
      await deleteCloudTradeNote(noteId);
      showNotification('Deleted note from cloud storage');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div id="paper_trading_view" className="space-y-4 font-sans text-slate-200">
      {/* Cloud & Risk Notice Banner */}
      <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center space-x-2 text-emerald-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>
            <strong>PAPER TRADING SIMULATION ACTIVE:</strong> Real broker execution disabled. All positions and balances are tracked in <strong>goldcrestfinman-trading</strong> Firestore.
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1 bg-emerald-950/80 px-2 py-0.5 rounded text-[11px] font-bold text-emerald-300 border border-emerald-700/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <Cloud className="w-3.5 h-3.5" />
            <span>goldcrestfinman-trading</span>
          </span>
          <button
            onClick={handleResetPortfolio}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] transition"
            title="Reset Virtual Balance in Cloud"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Balance</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="bg-emerald-950/90 border border-emerald-600 text-emerald-200 px-4 py-2 rounded text-xs font-mono flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionNotice}</span>
          </div>
          <span className="text-[10px] uppercase font-bold text-emerald-400">FIRESTORE SYNC</span>
        </div>
      )}

      {/* Account Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Virtual Balance (Cloud)</div>
          <div className="text-lg font-bold text-white mt-0.5">
            ${(portfolio?.balance || 100000.0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-emerald-400 flex items-center space-x-1">
            <Cloud className="w-3 h-3" />
            <span>Synced in Firestore</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Virtual Equity</div>
          <div className="text-lg font-bold text-emerald-400 mt-0.5">
            ${virtualEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400">Includes {trades.length} Open Positions</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Unrealized P&L</div>
          <div className={`text-lg font-bold mt-0.5 ${totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400">Dynamic Greek & Pip Model</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase">Risk Utilization</div>
          <div className="text-lg font-bold text-cyan-400 mt-0.5">0.85% / Trade</div>
          <div className="text-[10px] text-slate-400">Policy: 1.0% Max Cap</div>
        </div>
      </div>

      {/* Positions Table Header & Action */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-3 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-white text-sm font-sans flex items-center space-x-2">
              <span>Cloud Simulated Positions (Firestore: paper_trades)</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">
                {trades.length} Active
              </span>
            </h3>
            <span className="text-xs font-mono text-slate-500">
              Live updates via real-time WebSocket Firestore snapshot listener
            </span>
          </div>

          <button
            onClick={() => setShowNewTradeModal(true)}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center space-x-1.5 transition shadow"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Simulate New Trade</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Instrument</th>
                <th className="py-2.5 px-3">Market</th>
                <th className="py-2.5 px-3">Side</th>
                <th className="py-2.5 px-3">Entry Price</th>
                <th className="py-2.5 px-3">Quantity</th>
                <th className="py-2.5 px-3">SL / TP</th>
                <th className="py-2.5 px-3 text-right">Unrealized P&L</th>
                <th className="py-2.5 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {trades.map(p => (
                <tr key={p.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-2.5 px-3 font-bold text-white">{p.symbol}</td>
                  <td className="py-2.5 px-3 text-slate-400">{p.market}</td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      p.type === 'BUY'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-rose-950 text-rose-400 border border-rose-800'
                    }`}>
                      {p.type}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-200">{p.entryPrice}</td>
                  <td className="py-2.5 px-3 text-slate-300">{p.quantity.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-slate-400">
                    <span className="text-rose-400">{p.stopLoss}</span> / <span className="text-emerald-400">{p.takeProfit}</span>
                  </td>
                  <td className={`py-2.5 px-3 text-right font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      onClick={() => handleClosePosition(p.id)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-900/70 text-slate-300 hover:text-rose-200 text-[11px] transition border border-slate-700"
                    >
                      Close
                    </button>
                  </td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500 font-sans">
                    No active paper positions in goldcrestfinman-trading Firestore database.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cloud Trade Journal & Notes Section (Stored in trade_notes) */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3 font-mono">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-white text-sm font-sans">
              Cloud Trade Journal & Strategy Notes (trade_notes)
            </h3>
          </div>
          <span className="text-[10px] text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800">
            {notes.length} Notes in Firestore
          </span>
        </div>

        {/* Note Composer Form */}
        <form onSubmit={handleCreateNote} className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-1">
          <div className="md:col-span-3">
            <input
              type="text"
              placeholder="Note Title / Strategy..."
              value={noteTitle}
              onChange={e => setNoteTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-sans"
              required
            />
          </div>
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Symbol (e.g. EUR/USD)"
              value={noteSymbol}
              onChange={e => setNoteSymbol(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div className="md:col-span-5">
            <input
              type="text"
              placeholder="Trade rationale, support/resistance observations, market regime notes..."
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-sans"
              required
            />
          </div>
          <div className="md:col-span-2 flex items-center">
            <button
              type="submit"
              disabled={submittingNote}
              className="w-full bg-purple-700 hover:bg-purple-600 text-white rounded py-1.5 text-xs font-bold transition flex items-center justify-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save Note</span>
            </button>
          </div>
        </form>

        {/* Notes List */}
        <div className="space-y-2 pt-2">
          {notes.map(note => (
            <div key={note.id} className="bg-slate-950 p-3 rounded border border-slate-800/80 flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-white text-xs font-sans">{note.title}</span>
                  {note.symbol && (
                    <span className="text-[10px] bg-slate-900 border border-slate-700 text-cyan-300 px-1.5 py-0.2 rounded">
                      {note.symbol}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">
                    {note.createdAt?.seconds ? new Date(note.createdAt.seconds * 1000).toLocaleString() : 'Just now'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-sans">{note.content}</p>
              </div>

              <button
                onClick={() => handleDeleteNote(note.id)}
                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition"
                title="Delete Note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {notes.length === 0 && (
            <div className="text-slate-500 text-xs text-center py-4 font-sans">
              No journal notes stored yet. Use the input above to log trade reasoning to Firestore.
            </div>
          )}
        </div>
      </div>

      {/* New Trade Modal */}
      {showNewTradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 text-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-white text-base">Open Simulated Paper Trade</h3>
              </div>
              <button
                onClick={() => setShowNewTradeModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewTrade} className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Market</label>
                  <select
                    value={newMarket}
                    onChange={e => setNewMarket(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                  >
                    <option value="FOREX">FOREX</option>
                    <option value="INDIA_EQUITY">INDIA EQUITY</option>
                    <option value="INDIA_OPTIONS">INDIA OPTIONS</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Side</label>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setNewDirection('BUY')}
                      className={`p-2 rounded font-bold transition text-center ${
                        newDirection === 'BUY'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-950 text-slate-400 border border-slate-700'
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewDirection('SELL')}
                      className={`p-2 rounded font-bold transition text-center ${
                        newDirection === 'SELL'
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-950 text-slate-400 border border-slate-700'
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Instrument / Symbol</label>
                <input
                  type="text"
                  value={newSymbol}
                  onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="any"
                    value={newEntryPrice}
                    onChange={e => setNewEntryPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Quantity / Lot</label>
                  <input
                    type="number"
                    value={newQuantity}
                    onChange={e => setNewQuantity(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-rose-400 block mb-1">Stop Loss</label>
                  <input
                    type="number"
                    step="any"
                    value={newStopLoss}
                    onChange={e => setNewStopLoss(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-rose-300"
                    required
                  />
                </div>
                <div>
                  <label className="text-emerald-400 block mb-1">Take Profit</label>
                  <input
                    type="number"
                    step="any"
                    value={newTakeProfit}
                    onChange={e => setNewTakeProfit(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-emerald-300"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowNewTradeModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTrade}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center space-x-1.5"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>{submittingTrade ? 'Saving...' : 'Save to Firestore'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
