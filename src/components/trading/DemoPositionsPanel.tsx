import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  History,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap
} from 'lucide-react';
import { DemoPosition, ExitReason } from '../../demoExecution/types';

export const DemoPositionsPanel: React.FC = () => {
  const [positions, setPositions] = useState<DemoPosition[]>([]);
  const [selectedPositionForTimeline, setSelectedPositionForTimeline] = useState<DemoPosition | null>(null);
  const [isSimulatingPrices, setIsSimulatingPrices] = useState<boolean>(true);

  const fetchPositions = async () => {
    try {
      const res = await fetch('/api/demo/positions');
      if (res.ok) {
        const data = await res.json();
        setPositions(data || []);
      }
    } catch (err) {
      console.warn('Demo positions fetch temporarily unavailable:', err);
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, []);

  // Price Simulation Tick Loop (for testing trailing stops & TP/SL hits)
  useEffect(() => {
    if (!isSimulatingPrices) return;
    const tickInterval = setInterval(async () => {
      if (positions.length === 0) return;
      const priceUpdates: Record<string, number> = {};
      positions.forEach(p => {
        if (p.status !== 'CLOSED') {
          const delta = (Math.random() * 0.0006 - 0.0002); // slight random tick
          priceUpdates[p.symbol] = parseFloat((p.currentMarketPrice + delta).toFixed(5));
        }
      });

      if (Object.keys(priceUpdates).length > 0) {
        await fetch('/api/demo/positions/update-prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prices: priceUpdates })
        });
        await fetchPositions();
      }
    }, 2500);

    return () => clearInterval(tickInterval);
  }, [isSimulatingPrices, positions]);

  // Execute Manual Position Exit
  const handleExitPosition = async (positionId: string, reason: ExitReason) => {
    const ok = confirm(`Confirm exit of position ${positionId} via ${reason}?`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/demo/positions/${positionId}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });

      if (res.ok) {
        await fetchPositions();
      } else {
        const err = await res.json();
        alert(`Exit Failed: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Exit Error: ${err.message}`);
    }
  };

  const openPositions = positions.filter(p => p.status !== 'CLOSED');
  const closedPositions = positions.filter(p => p.status === 'CLOSED');

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* 1. HEADER & SIMULATOR CONTROLS */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <Activity className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">Demo Position & Multi-Tier Exit Manager</h3>
            <p className="text-slate-400 text-[11px]">
              Real-time MFE/MAE excursion tracking, TP1 breakeven logic, TP2/TP3 scaling, and trailing stop protection.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsSimulatingPrices(!isSimulatingPrices)}
            className={`px-3 py-1.5 rounded text-[11px] font-bold transition flex items-center space-x-1.5 ${
              isSimulatingPrices
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {isSimulatingPrices ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-slate-400" />}
            <span>{isSimulatingPrices ? 'Live Ticks Streaming' : 'Ticks Paused'}</span>
          </button>

          <button
            onClick={fetchPositions}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. ACTIVE OPEN POSITIONS */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <span className="font-bold text-white text-sm">Open Demo Positions ({openPositions.length})</span>
          <span className="text-slate-500 text-[11px]">Demo Sandbox Environment</span>
        </div>

        {openPositions.length === 0 ? (
          <div className="p-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-lg">
            No active open positions. Execute an order in the Demo Execution & Ticket tab.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2">Symbol / Side</th>
                  <th className="pb-2">Broker</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Entry Price</th>
                  <th className="pb-2">Current Price</th>
                  <th className="pb-2">Stop Loss / Trailing</th>
                  <th className="pb-2">TP1 / Breakeven</th>
                  <th className="pb-2">MFE / MAE</th>
                  <th className="pb-2">Unrealized P&L</th>
                  <th className="pb-2">Protection</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {openPositions.map((pos) => {
                  const isProfitable = pos.unrealizedPnl >= 0;
                  return (
                    <tr key={pos.positionId} className="hover:bg-slate-800/30 transition">
                      <td className="py-2.5">
                        <div className="font-bold text-white">{pos.symbol}</div>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          pos.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {pos.side}
                        </span>
                      </td>

                      <td className="py-2.5 text-slate-300">{pos.broker}</td>
                      <td className="py-2.5 text-slate-200">{pos.currentQuantity}</td>
                      <td className="py-2.5 text-slate-300">{pos.averageEntryPrice.toFixed(5)}</td>
                      <td className="py-2.5 text-white font-bold">{pos.currentMarketPrice.toFixed(5)}</td>

                      {/* SL & Trailing */}
                      <td className="py-2.5">
                        <div className="text-rose-400 font-bold">{pos.stopLoss.toFixed(5)}</div>
                        {pos.trailingStopActive && (
                          <span className="text-[10px] text-amber-300 flex items-center space-x-1">
                            <span>Trail Active (15p)</span>
                          </span>
                        )}
                      </td>

                      {/* TP1 & Breakeven Status */}
                      <td className="py-2.5">
                        <div className="text-emerald-400 font-bold">{pos.takeProfit1.toFixed(5)}</div>
                        <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                          pos.breakevenMoved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {pos.breakevenMoved ? 'BE LOCKED' : 'PENDING'}
                        </span>
                      </td>

                      {/* MFE & MAE */}
                      <td className="py-2.5 text-[10px]">
                        <div className="text-emerald-400">MFE: +{(pos.maximumFavorableExcursion * 10000).toFixed(1)}p</div>
                        <div className="text-rose-400">MAE: -{(pos.maximumAdverseExcursion * 10000).toFixed(1)}p</div>
                      </td>

                      {/* P&L */}
                      <td className="py-2.5">
                        <span className={`text-sm font-bold flex items-center space-x-1 ${
                          isProfitable ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {isProfitable ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          <span>${pos.unrealizedPnl.toFixed(2)}</span>
                        </span>
                      </td>

                      {/* Protection Status */}
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center space-x-1 ${
                          pos.protectionStatus === 'HEALTHY'
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                        }`}>
                          {pos.protectionStatus === 'HEALTHY' ? <ShieldCheck className="w-3 h-3 text-emerald-400" /> : <ShieldAlert className="w-3 h-3 text-rose-400" />}
                          <span>{pos.protectionStatus}</span>
                        </span>
                      </td>

                      {/* Action buttons */}
                      <td className="py-2.5 text-right space-x-1.5">
                        <button
                          onClick={() => setSelectedPositionForTimeline(pos)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        >
                          Events
                        </button>
                        <button
                          onClick={() => handleExitPosition(pos.positionId, 'MANUAL_EXIT')}
                          className="px-2.5 py-1 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-bold"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. CLOSED POSITIONS & REALIZED PERFORMANCE */}
      {closedPositions.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-white text-sm">Closed Demo Positions History ({closedPositions.length})</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Holding Time</th>
                  <th className="pb-2">Realized P&L</th>
                  <th className="pb-2 text-right">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {closedPositions.map((p) => (
                  <tr key={p.positionId} className="hover:bg-slate-800/20">
                    <td className="py-2 text-white font-bold">{p.symbol}</td>
                    <td className="py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        p.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {p.side}
                      </span>
                    </td>
                    <td className="py-2 text-slate-300">{p.averageEntryPrice.toFixed(5)}</td>
                    <td className="py-2 text-slate-400">{Math.round(p.holdingTimeMs / 1000)}s</td>
                    <td className="py-2">
                      <span className={`font-bold ${p.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${p.realizedPnl.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => setSelectedPositionForTimeline(p)}
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white"
                      >
                        Timeline
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Position Event Timeline Modal */}
      {selectedPositionForTimeline && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <History className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-sm">
                  Position Lifecycle Events ({selectedPositionForTimeline.symbol})
                </h3>
              </div>
              <button
                onClick={() => setSelectedPositionForTimeline(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {selectedPositionForTimeline.events.map((evt, idx) => (
                <div key={idx} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-400">{evt.type}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-slate-300">{evt.description}</div>
                  <div className="text-slate-500 text-[10px]">Reference Price: {evt.price}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-800 pt-3 flex justify-end">
              <button
                onClick={() => setSelectedPositionForTimeline(null)}
                className="px-4 py-1.5 rounded bg-slate-800 text-slate-200 font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
