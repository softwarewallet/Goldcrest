// ============================================================================
// LARGE-SCALE 3-MODE BACKTEST & COST-AWARE VALIDATION TAB
// ============================================================================

import React, { useState } from 'react';
import {
  Play,
  Layers,
  DollarSign,
  TrendingUp,
  Percent,
  ShieldCheck,
  AlertTriangle,
  Activity,
  Award,
  RefreshCw,
  BarChart2
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { MultiModeBacktestResult, PerformanceMetricsSummary } from '../../ml/historical/types';

export const LargeScaleBacktestTab: React.FC = () => {
  const [running, setRunning] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<MultiModeBacktestResult | null>(null);

  // Form State
  const [instrument, setInstrument] = useState<string>('EUR/USD');
  const [market, setMarket] = useState<'FOREX' | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS'>('FOREX');
  const [timeframe, setTimeframe] = useState<string>('M15');
  const [mode, setMode] = useState<'DETERMINISTIC_ONLY' | 'ML_ONLY' | 'COMBINED'>('COMBINED');
  const [initialCapital, setInitialCapital] = useState<number>(100000);
  const [mlThreshold, setMlThreshold] = useState<number>(0.55);
  const [signalThreshold, setSignalThreshold] = useState<number>(55);
  const [spreadPips, setSpreadPips] = useState<number>(1.2);
  const [slippagePips, setSlippagePips] = useState<number>(0.5);

  const [activeSubView, setActiveSubView] = useState<'comparison' | 'regimes' | 'sessions' | 'trades'>('comparison');

  const runBacktest = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/ml/backtest/large-scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument,
          market,
          timeframe,
          mode,
          initialCapital,
          mlThreshold,
          signalThreshold,
          costModel: {
            forexSpreadPips: spreadPips,
            forexCommissionPerStandardLot: 7.0,
            forexOvernightSwapLongPoints: -0.8,
            forexOvernightSwapShortPoints: 0.2,
            indiaBrokeragePerOrder: 20.0,
            indiaSTTPctDelivery: 0.1,
            indiaSTTPctIntraday: 0.025,
            indiaExchangeTurnoverPct: 0.00345,
            indiaGSTPct: 18.0,
            indiaSEBITurnoverPct: 0.0001,
            indiaStampDutyPct: 0.003
          },
          slippageConfig: {
            model: 'SPREAD_BASED',
            fixedPips: slippagePips,
            spreadMultiplier: 0.5,
            percentageOfPrice: 0.02,
            atrPeriod: 14,
            atrMultiplier: 0.05
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        setBacktestResult(data);
      }
    } catch (err) {
      console.error('Failed to run large-scale backtest:', err);
    } finally {
      setRunning(false);
    }
  };

  const renderMetricComparison = (
    title: string,
    det: PerformanceMetricsSummary,
    ml: PerformanceMetricsSummary,
    comb: PerformanceMetricsSummary
  ) => {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-3 bg-slate-950 border-b border-slate-800 font-bold text-white text-xs uppercase tracking-wider flex items-center justify-between">
          <span>{title} — 3-Mode Side-by-Side Comparison</span>
          <span className="text-[11px] font-mono text-cyan-400">Strict Transaction Costs & Slippage Included</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-2.5">Key Performance Metric</th>
                <th className="p-2.5 text-right text-slate-300">Mode A: Deterministic</th>
                <th className="p-2.5 text-right text-indigo-300">Mode B: ML GBDT Only</th>
                <th className="p-2.5 text-right text-cyan-300 font-bold">Mode C: Combined Fusion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Total Trades Executed</td>
                <td className="p-2.5 text-right text-slate-300">{det.totalTrades}</td>
                <td className="p-2.5 text-right text-indigo-300">{ml.totalTrades}</td>
                <td className="p-2.5 text-right text-cyan-400 font-bold">{comb.totalTrades}</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Win Rate %</td>
                <td className="p-2.5 text-right text-slate-300">{det.winRatePct}%</td>
                <td className="p-2.5 text-right text-indigo-300">{ml.winRatePct}%</td>
                <td className="p-2.5 text-right text-emerald-400 font-bold">{comb.winRatePct}%</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Net Expectancy (R / trade)</td>
                <td className="p-2.5 text-right text-slate-300">{det.expectancyR.toFixed(2)} R</td>
                <td className="p-2.5 text-right text-indigo-300">{ml.expectancyR.toFixed(2)} R</td>
                <td className="p-2.5 text-right text-emerald-400 font-bold">{comb.expectancyR.toFixed(2)} R</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Profit Factor</td>
                <td className="p-2.5 text-right text-slate-300">{det.profitFactor.toFixed(2)}</td>
                <td className="p-2.5 text-right text-indigo-300">{ml.profitFactor.toFixed(2)}</td>
                <td className="p-2.5 text-right text-cyan-400 font-bold">{comb.profitFactor.toFixed(2)}</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Gross P&L ($)</td>
                <td className="p-2.5 text-right text-slate-300">${det.grossPnl.toFixed(2)}</td>
                <td className="p-2.5 text-right text-indigo-300">${ml.grossPnl.toFixed(2)}</td>
                <td className="p-2.5 text-right text-cyan-400 font-bold">${comb.grossPnl.toFixed(2)}</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Total Costs (Spread+Comm+Slip)</td>
                <td className="p-2.5 text-right text-rose-400">-${det.totalCostsPaid.toFixed(2)}</td>
                <td className="p-2.5 text-right text-rose-400">-${ml.totalCostsPaid.toFixed(2)}</td>
                <td className="p-2.5 text-right text-rose-400 font-bold">-${comb.totalCostsPaid.toFixed(2)}</td>
              </tr>
              <tr className="hover:bg-slate-800/40 bg-slate-950/40">
                <td className="p-2.5 font-bold text-white">Net Realized P&L ($)</td>
                <td className="p-2.5 text-right text-slate-200 font-bold">${det.netPnl.toFixed(2)}</td>
                <td className="p-2.5 text-right text-indigo-300 font-bold">${ml.netPnl.toFixed(2)}</td>
                <td className="p-2.5 text-right text-emerald-400 font-extrabold text-sm">${comb.netPnl.toFixed(2)}</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Annualized Sharpe Ratio</td>
                <td className="p-2.5 text-right text-slate-300">{det.sharpeRatio.toFixed(2)}</td>
                <td className="p-2.5 text-right text-indigo-300">{ml.sharpeRatio.toFixed(2)}</td>
                <td className="p-2.5 text-right text-emerald-400 font-bold">{comb.sharpeRatio.toFixed(2)}</td>
              </tr>
              <tr className="hover:bg-slate-800/40">
                <td className="p-2.5 font-bold text-slate-300">Maximum Drawdown %</td>
                <td className="p-2.5 text-right text-amber-400">{det.maxDrawdownPct.toFixed(2)}%</td>
                <td className="p-2.5 text-right text-amber-400">{ml.maxDrawdownPct.toFixed(2)}%</td>
                <td className="p-2.5 text-right text-emerald-400 font-bold">{comb.maxDrawdownPct.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Backtest Config Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            <h3 className="font-bold text-white text-base">Cost-Aware Large-Scale Backtest Engine</h3>
          </div>

          <button
            onClick={runBacktest}
            disabled={running}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center space-x-2 transition disabled:opacity-50"
          >
            <Play className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
            <span>{running ? 'Executing Historical Replay...' : 'Run 3-Mode Backtest'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 font-bold mb-1">Market</label>
            <select
              value={market}
              onChange={e => {
                const val = e.target.value as any;
                setMarket(val);
                if (val === 'FOREX') setInstrument('EUR/USD');
                else setInstrument('NIFTY');
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              <option value="FOREX">FOREX</option>
              <option value="INDIAN_EQUITY">INDIAN EQUITIES</option>
              <option value="INDIAN_OPTIONS">INDIAN OPTIONS</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Instrument</label>
            <input
              type="text"
              value={instrument}
              onChange={e => setInstrument(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Timeframe</label>
            <select
              value={timeframe}
              onChange={e => setTimeframe(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            >
              <option value="M5">M5</option>
              <option value="M15">M15</option>
              <option value="H1">H1</option>
              <option value="D1">D1</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={e => setInitialCapital(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">ML Prob Threshold</label>
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="0.9"
              value={mlThreshold}
              onChange={e => setMlThreshold(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Spread (Pips/Pts)</label>
            <input
              type="number"
              step="0.1"
              value={spreadPips}
              onChange={e => setSpreadPips(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Slippage (Pips/Pts)</label>
            <input
              type="number"
              step="0.1"
              value={slippagePips}
              onChange={e => setSlippagePips(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono"
            />
          </div>
        </div>
      </div>

      {backtestResult && (
        <div className="space-y-4">
          {/* Sub Navigation Bar */}
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 text-xs">
            <button
              onClick={() => setActiveSubView('comparison')}
              className={`px-3 py-1.5 rounded transition ${
                activeSubView === 'comparison' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Mode Comparison & Equity Curve
            </button>
            <button
              onClick={() => setActiveSubView('regimes')}
              className={`px-3 py-1.5 rounded transition ${
                activeSubView === 'regimes' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Regime Breakdown
            </button>
            <button
              onClick={() => setActiveSubView('sessions')}
              className={`px-3 py-1.5 rounded transition ${
                activeSubView === 'sessions' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Session Analysis
            </button>
            <button
              onClick={() => setActiveSubView('trades')}
              className={`px-3 py-1.5 rounded transition ${
                activeSubView === 'trades' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Trade Audit Log ({backtestResult.trades.length})
            </button>
          </div>

          {activeSubView === 'comparison' && (
            <div className="space-y-4">
              {renderMetricComparison(
                'Full Dataset Execution',
                backtestResult.deterministicMetrics,
                backtestResult.mlMetrics,
                backtestResult.combinedMetrics
              )}

              {/* Equity Curve Visualizer */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-white text-xs uppercase tracking-wider">
                    Cumulative Equity Trajectory (Gross vs Net with Spread, Commission & Slippage)
                  </span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={backtestResult.equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="tradeIndex" stroke="#64748b" textAnchor="end" tick={{ fontSize: 10 }} />
                      <YAxis stroke="#64748b" domain={['auto', 'auto']} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', fontSize: '11px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Line type="monotone" dataKey="grossEquity" name="Gross Equity ($)" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="netEquity" name="Net Realized Equity ($)" stroke="#06b6d4" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeSubView === 'regimes' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-3">Performance by Market Regime</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {Object.entries(backtestResult.regimeAnalysis || {}).map(([regime, metrics]: [string, any]) => (
                  <div key={regime} className="bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                    <div className="font-bold text-cyan-300 mb-2">{regime}</div>
                    <div className="space-y-1 font-mono text-slate-300">
                      <div>Trades: <span className="font-bold text-white">{metrics.totalTrades}</span></div>
                      <div>Win Rate: <span className="font-bold text-emerald-400">{metrics.winRatePct}%</span></div>
                      <div>Expectancy: <span className="font-bold text-slate-200">{metrics.expectancyR.toFixed(2)} R</span></div>
                      <div>Net P&L: <span className="font-bold text-cyan-400">${metrics.netPnl.toFixed(2)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSubView === 'sessions' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-3">Performance by Trading Session</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {Object.entries(backtestResult.sessionAnalysis || {}).map(([session, metrics]: [string, any]) => (
                  <div key={session} className="bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                    <div className="font-bold text-indigo-300 mb-2">{session}</div>
                    <div className="space-y-1 font-mono text-slate-300">
                      <div>Trades: <span className="font-bold text-white">{metrics.totalTrades}</span></div>
                      <div>Win Rate: <span className="font-bold text-emerald-400">{metrics.winRatePct}%</span></div>
                      <div>Profit Factor: <span className="font-bold text-slate-200">{metrics.profitFactor.toFixed(2)}</span></div>
                      <div>Net P&L: <span className="font-bold text-cyan-400">${metrics.netPnl.toFixed(2)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSubView === 'trades' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <div className="p-3 bg-slate-950 border-b border-slate-800 font-bold text-white text-xs uppercase tracking-wider">
                Historical Trade Audit Log ({backtestResult.trades.length} Executions)
              </div>
              <div className="max-h-96 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="p-2">Timestamp (UTC)</th>
                      <th className="p-2">Dir</th>
                      <th className="p-2 text-right">Entry</th>
                      <th className="p-2 text-right">Exit</th>
                      <th className="p-2 text-right">Costs</th>
                      <th className="p-2 text-right">Realized R</th>
                      <th className="p-2 text-right">Net PnL</th>
                      <th className="p-2 text-center">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {backtestResult.trades.map((t, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="p-2 text-slate-400 text-[11px]">{new Date(t.timestamp).toISOString().substring(0, 16).replace('T', ' ')}</td>
                        <td className={`p-2 font-bold ${t.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.direction}</td>
                        <td className="p-2 text-right text-slate-200">{t.executedPrice.toFixed(4)}</td>
                        <td className="p-2 text-right text-slate-200">{t.exitPrice.toFixed(4)}</td>
                        <td className="p-2 text-right text-rose-400">-${(t.spreadCost + t.commission + t.slippageCost).toFixed(2)}</td>
                        <td className={`p-2 text-right font-bold ${t.realizedR > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{t.realizedR > 0 ? `+${t.realizedR.toFixed(2)}` : t.realizedR.toFixed(2)} R</td>
                        <td className={`p-2 text-right font-bold ${t.netPnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${t.netPnl.toFixed(2)}</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.outcome === 'TARGET_FIRST' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                          }`}>
                            {t.outcome}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
