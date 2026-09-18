import React, { useState, useEffect } from 'react';
import { OptionChainSummary, OptionChainStrikeRow } from '../markets/common/types';
import { PayoffChart } from './PayoffChart';
import { calculateStrategyPayoff } from '../markets/india_options/strategySkeleton';
import { Layers, ShieldCheck, TrendingUp, Info, ChevronDown } from 'lucide-react';

interface OptionsDashboardProps {
  initialSymbol?: string;
}

export const OptionsDashboard: React.FC<OptionsDashboardProps> = ({
  initialSymbol = 'NIFTY'
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
  const [strikeDepth, setStrikeDepth] = useState<number>(7);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [chain, setChain] = useState<OptionChainSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeStrategy, setActiveStrategy] = useState<'BULL_CALL_SPREAD' | 'LONG_CALL' | 'BEAR_PUT_SPREAD'>('BULL_CALL_SPREAD');

  useEffect(() => {
    setSelectedSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    fetchChain();
  }, [selectedSymbol, selectedExpiry, strikeDepth]);

  const fetchChain = async () => {
    setLoading(true);
    try {
      let url = `/api/options/chain/${selectedSymbol}?depth=${strikeDepth}`;
      if (selectedExpiry) url += `&expiry=${selectedExpiry}`;
      const res = await fetch(url);
      const data = await res.json();
      setChain(data);
      if (!selectedExpiry && data.expiry) {
        setSelectedExpiry(data.expiry);
      }
    } catch (err) {
      console.error('Error fetching option chain:', err);
    } finally {
      setLoading(false);
    }
  };

  const underlyingSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];

  const atmRow = chain?.rows.find(r => r.isATM);
  const otmCallRow = chain?.rows.find(r => r.distanceFromAtm === 1);
  const otmPutRow = chain?.rows.find(r => r.distanceFromAtm === -1);

  // Derive active strategy payoff
  const payoffData = React.useMemo(() => {
    if (!chain || !atmRow) return null;
    const spot = chain.spotPrice;

    if (activeStrategy === 'BULL_CALL_SPREAD' && otmCallRow) {
      return calculateStrategyPayoff({
        strategyType: 'BULL_CALL_SPREAD',
        underlying: chain.underlying,
        spotPrice: spot,
        strike1: atmRow.strike,
        premium1: atmRow.call.ltp,
        strike2: otmCallRow.strike,
        premium2: otmCallRow.call.ltp
      });
    } else if (activeStrategy === 'LONG_CALL') {
      return calculateStrategyPayoff({
        strategyType: 'LONG_CALL',
        underlying: chain.underlying,
        spotPrice: spot,
        strike1: atmRow.strike,
        premium1: atmRow.call.ltp
      });
    } else if (activeStrategy === 'BEAR_PUT_SPREAD' && otmPutRow) {
      return calculateStrategyPayoff({
        strategyType: 'BEAR_PUT_SPREAD',
        underlying: chain.underlying,
        spotPrice: spot,
        strike1: otmPutRow.strike,
        premium1: otmPutRow.put.ltp,
        strike2: atmRow.strike,
        premium2: atmRow.put.ltp
      });
    }
    return null;
  }, [chain, atmRow, otmCallRow, otmPutRow, activeStrategy]);

  return (
    <div id="options_dashboard_view" className="space-y-4 font-sans text-slate-200">
      {/* Top Configuration & Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        {/* Underlying Selector */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Underlying:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono text-xs">
            {underlyingSymbols.map(sym => (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                className={`px-2.5 py-1 rounded transition ${
                  selectedSymbol === sym
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Expiry Selector */}
        {chain?.availableExpiries && (
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono text-slate-400">Expiry:</span>
            <select
              value={selectedExpiry}
              onChange={e => setSelectedExpiry(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            >
              {chain.availableExpiries.map(exp => (
                <option key={exp} value={exp}>{exp}</option>
              ))}
            </select>
          </div>
        )}

        {/* Strike Depth Selector */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Depth:</span>
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 font-mono text-xs">
            {[5, 7, 10].map(d => (
              <button
                key={d}
                onClick={() => setStrikeDepth(d)}
                className={`px-2 py-0.5 rounded text-[11px] transition ${
                  strikeDepth === d ? 'bg-slate-800 text-white font-bold' : 'text-slate-400'
                }`}
              >
                ±{d} Strikes
              </button>
            ))}
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center space-x-1.5 text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800/80">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Greeks: Black-Scholes Model-Derived</span>
        </div>
      </div>

      {/* Spot & Market Sentiment Bar */}
      {chain && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase">Spot Price</div>
            <div className="text-lg font-bold text-white mt-0.5">{chain.spotPrice.toLocaleString()}</div>
            <div className="text-[10px] text-emerald-400">ATM Strike: {chain.atmStrike}</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase">Put / Call Ratio (PCR)</div>
            <div className="text-lg font-bold text-amber-400 mt-0.5">{chain.pcr}</div>
            <div className="text-[10px] text-slate-400">{chain.pcr > 1 ? 'Bullish Put Base' : 'Bearish Call Bias'}</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase">Call Resistance Zone</div>
            <div className="text-lg font-bold text-rose-400 mt-0.5">{chain.callResistanceStrike} CE</div>
            <div className="text-[10px] text-slate-400">Highest Open Interest</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase">Put Support Zone</div>
            <div className="text-lg font-bold text-emerald-400 mt-0.5">{chain.putSupportStrike} PE</div>
            <div className="text-[10px] text-slate-400">Strongest Put Base</div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 uppercase">Total Chain OI</div>
            <div className="text-sm font-bold text-slate-300 mt-1">
              Calls: {(chain.totalCallOI / 100000).toFixed(2)}L
            </div>
            <div className="text-[10px] text-slate-400">
              Puts: {(chain.totalPutOI / 100000).toFixed(2)}L
            </div>
          </div>
        </div>
      )}

      {/* Option Chain Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
        <div className="p-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold">
            <span>CALL OPTIONS (CE)</span>
          </div>
          <div className="text-slate-400">
            Center: Strike & Distance • Highlighted: ATM / S&R
          </div>
          <div className="flex items-center space-x-2 text-rose-400 font-bold">
            <span>PUT OPTIONS (PE)</span>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-center text-[11px] font-mono">
            <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
              <tr>
                {/* Calls */}
                <th className="py-2 px-1 text-slate-400">Delta</th>
                <th className="py-2 px-1 text-slate-400">IV%</th>
                <th className="py-2 px-1 text-slate-400">Vol</th>
                <th className="py-2 px-1 text-slate-400">ΔOI</th>
                <th className="py-2 px-2 text-slate-300">Call OI</th>
                <th className="py-2 px-2 text-emerald-400">Call LTP</th>
                {/* Strike */}
                <th className="py-2 px-3 bg-slate-900 text-white font-bold border-x border-slate-800">STRIKE</th>
                {/* Puts */}
                <th className="py-2 px-2 text-rose-400">Put LTP</th>
                <th className="py-2 px-2 text-slate-300">Put OI</th>
                <th className="py-2 px-1 text-slate-400">ΔOI</th>
                <th className="py-2 px-1 text-slate-400">Vol</th>
                <th className="py-2 px-1 text-slate-400">IV%</th>
                <th className="py-2 px-1 text-slate-400">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {chain?.rows.map((row: OptionChainStrikeRow) => {
                const isATM = row.isATM;
                const isCallITM = row.call.isITM;
                const isPutITM = row.put.isITM;
                const isCallResistance = row.strike === chain.callResistanceStrike;
                const isPutSupport = row.strike === chain.putSupportStrike;

                return (
                  <tr
                    key={row.strike}
                    className={`transition hover:bg-slate-800/40 ${
                      isATM ? 'bg-amber-950/20 font-bold' : ''
                    }`}
                  >
                    {/* CALL SIDE */}
                    <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} text-slate-400`}>
                      {row.call.greeks.delta}
                    </td>
                    <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} text-slate-400`}>
                      {row.call.iv}%
                    </td>
                    <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} text-slate-400`}>
                      {row.call.volume.toLocaleString()}
                    </td>
                    <td className={`py-1.5 px-1 ${isCallITM ? 'bg-emerald-950/20' : ''} ${row.call.changeOI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.call.changeOI > 0 ? '+' : ''}{row.call.changeOI.toLocaleString()}
                    </td>
                    <td className={`py-1.5 px-2 ${isCallITM ? 'bg-emerald-950/20' : ''} ${isCallResistance ? 'text-rose-400 font-bold bg-rose-950/30' : 'text-slate-200'}`}>
                      {row.call.oi.toLocaleString()}
                    </td>
                    <td className={`py-1.5 px-2 font-bold ${isCallITM ? 'bg-emerald-950/20' : ''} text-emerald-400`}>
                      ₹{row.call.ltp}
                    </td>

                    {/* CENTER STRIKE */}
                    <td className={`py-1.5 px-3 font-bold border-x border-slate-800 ${
                      isATM
                        ? 'bg-amber-500/20 text-amber-300'
                        : isCallResistance
                        ? 'text-rose-400'
                        : isPutSupport
                        ? 'text-emerald-400'
                        : 'bg-slate-950 text-slate-100'
                    }`}>
                      <div className="flex items-center justify-center space-x-1">
                        <span>{row.strike}</span>
                        {isATM && <span className="text-[9px] bg-amber-500 text-black px-1 rounded font-extrabold">ATM</span>}
                      </div>
                    </td>

                    {/* PUT SIDE */}
                    <td className={`py-1.5 px-2 font-bold ${isPutITM ? 'bg-rose-950/20' : ''} text-rose-400`}>
                      ₹{row.put.ltp}
                    </td>
                    <td className={`py-1.5 px-2 ${isPutITM ? 'bg-rose-950/20' : ''} ${isPutSupport ? 'text-emerald-400 font-bold bg-emerald-950/30' : 'text-slate-200'}`}>
                      {row.put.oi.toLocaleString()}
                    </td>
                    <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} ${row.put.changeOI >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.put.changeOI > 0 ? '+' : ''}{row.put.changeOI.toLocaleString()}
                    </td>
                    <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} text-slate-400`}>
                      {row.put.volume.toLocaleString()}
                    </td>
                    <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} text-slate-400`}>
                      {row.put.iv}%
                    </td>
                    <td className={`py-1.5 px-1 ${isPutITM ? 'bg-rose-950/20' : ''} text-slate-400`}>
                      {row.put.greeks.delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payoff Visualizer Skeleton & Strategy Selection */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-bold text-white font-sans">Options Strategy Payoff Simulator</h4>
            <span className="text-xs font-mono text-slate-400">(Pre-Trade Risk Architecture)</span>
          </div>

          <div className="flex items-center bg-slate-950 rounded border border-slate-800 p-0.5 text-xs font-mono">
            <button
              onClick={() => setActiveStrategy('BULL_CALL_SPREAD')}
              className={`px-3 py-1 rounded transition ${
                activeStrategy === 'BULL_CALL_SPREAD' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              Bull Call Spread
            </button>
            <button
              onClick={() => setActiveStrategy('LONG_CALL')}
              className={`px-3 py-1 rounded transition ${
                activeStrategy === 'LONG_CALL' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              Long Call
            </button>
            <button
              onClick={() => setActiveStrategy('BEAR_PUT_SPREAD')}
              className={`px-3 py-1 rounded transition ${
                activeStrategy === 'BEAR_PUT_SPREAD' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'
              }`}
            >
              Bear Put Spread
            </button>
          </div>
        </div>

        {payoffData && chain && (
          <PayoffChart payoff={payoffData} currentSpot={chain.spotPrice} />
        )}
      </div>
    </div>
  );
};
