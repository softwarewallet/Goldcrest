// ============================================================================
// MONTE CARLO RISK & RESAMPLING SIMULATION TAB
// ============================================================================

import React, { useState } from 'react';
import {
  Shuffle,
  ShieldAlert,
  Percent,
  TrendingDown,
  BarChart2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Scale
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line
} from 'recharts';
import { MonteCarloSimulationResult } from '../../ml/historical/types';

export const MonteCarloTab: React.FC = () => {
  const [iterations, setIterations] = useState<number>(1000);
  const [resampleWithReplacement, setResampleWithReplacement] = useState<boolean>(true);
  const [initialCapital, setInitialCapital] = useState<number>(100000);
  const [ruinThresholdPct, setRuinThresholdPct] = useState<number>(0.30);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [result, setResult] = useState<MonteCarloSimulationResult | null>(null);

  const runMonteCarlo = async () => {
    setSimulating(true);
    try {
      const res = await fetch('/api/ml/monte-carlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iterations,
          resampleWithReplacement,
          initialCapital,
          ruinThresholdPct
        })
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch (err) {
      console.error('Monte Carlo simulation failed:', err);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Control Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Shuffle className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-bold text-white text-base">Monte Carlo Permutation & Bootstrap Resampling</h3>
              <p className="text-xs text-slate-400">Post-trade variance & statistical significance validation engine.</p>
            </div>
          </div>

          <button
            onClick={runMonteCarlo}
            disabled={simulating}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center space-x-2 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${simulating ? 'animate-spin' : ''}`} />
            <span>{simulating ? 'Simulating Iterations...' : `Execute ${iterations.toLocaleString()} Iterations`}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 font-bold mb-1">Iterations</label>
            <select
              value={iterations}
              onChange={e => setIterations(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              <option value="1000">1,000 Iterations</option>
              <option value="2500">2,500 Iterations</option>
              <option value="5000">5,000 Iterations</option>
              <option value="10000">10,000 Iterations</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Resampling Mode</label>
            <select
              value={resampleWithReplacement ? 'WITH_REPLACEMENT' : 'PERMUTATION'}
              onChange={e => setResampleWithReplacement(e.target.value === 'WITH_REPLACEMENT')}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              <option value="WITH_REPLACEMENT">Bootstrap (With Replacement)</option>
              <option value="PERMUTATION">Random Permutation (Order Reshuffling)</option>
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
            <label className="block text-slate-400 font-bold mb-1">Ruin Floor Threshold</label>
            <select
              value={ruinThresholdPct}
              onChange={e => setRuinThresholdPct(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
            >
              <option value="0.20">20% Drawdown Floor</option>
              <option value="0.30">30% Drawdown Floor</option>
              <option value="0.50">50% Drawdown Floor</option>
            </select>
          </div>
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          {/* Statistical Significance Statement */}
          <div className={`p-3 rounded-lg border flex items-center space-x-3 text-xs ${
            result.sampleSizeSufficiency.isStatisticallySignificant
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : 'bg-amber-950/40 border-amber-800 text-amber-200'
          }`}>
            {result.sampleSizeSufficiency.isStatisticallySignificant ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            )}
            <div>
              <div className="font-bold">
                {result.sampleSizeSufficiency.isStatisticallySignificant
                  ? 'STATISTICALLY SIGNIFICANT SAMPLE'
                  : 'LIMITED SAMPLE WARNING'}
              </div>
              <div className="text-[11px] opacity-90 mt-0.5">
                {result.sampleSizeSufficiency.confidenceStatement} (Margin of Error: &plusmn;{result.sampleSizeSufficiency.marginOfErrorPct}%)
              </div>
            </div>
          </div>

          {/* Percentile PnL Outcomes */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">5th Percentile (Worst 5%)</span>
              <div className="text-base font-bold text-rose-400 font-mono mt-1">${result.p5NetPnl.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">25th Percentile</span>
              <div className="text-base font-bold text-slate-300 font-mono mt-1">${result.p25NetPnl.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900 border border-cyan-800/60 p-3 rounded-lg text-center bg-cyan-950/20">
              <span className="text-[10px] text-cyan-400 font-bold uppercase">Median Expected (P50)</span>
              <div className="text-lg font-bold text-cyan-300 font-mono mt-1">${result.medianFinalNetPnl.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">75th Percentile</span>
              <div className="text-base font-bold text-emerald-400 font-mono mt-1">${result.p75NetPnl.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase">95th Percentile (Best 5%)</span>
              <div className="text-base font-bold text-emerald-300 font-mono mt-1">${result.p95NetPnl.toLocaleString()}</div>
            </div>
          </div>

          {/* Tail Risk Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Expected Max Drawdown</span>
              <div className="text-xl font-bold text-white font-mono mt-1">{result.expectedMaxDrawdownPct}%</div>
              <div className="text-[11px] text-slate-400 mt-1">P95 Drawdown: {result.p95MaxDrawdownPct}%</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Probability of Ruin</span>
              <div className={`text-xl font-bold font-mono mt-1 ${result.probabilityOfRuinPct === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {result.probabilityOfRuinPct}%
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Based on {(ruinThresholdPct * 100)}% capital drop floor</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Worst Losing Streak</span>
              <div className="text-xl font-bold text-amber-400 font-mono mt-1">{result.expectedWorstLosingStreak} Trades</div>
              <div className="text-[11px] text-slate-400 mt-1">P95 Worst Streak: {result.p95WorstLosingStreak} Trades</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Sharpe 95% CI</span>
              <div className="text-xl font-bold text-cyan-300 font-mono mt-1">{result.sharpeDistribution.mean}</div>
              <div className="text-[11px] text-slate-400 mt-1">[{result.sharpeDistribution.ciLower} — {result.sharpeDistribution.ciUpper}]</div>
            </div>
          </div>

          {/* Drawdown Distribution Histogram */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <span className="font-bold text-white text-xs uppercase tracking-wider block mb-3">
              Max Drawdown Probability Distribution ({result.iterations.toLocaleString()} Runs)
            </span>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.simulatedDrawdownDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="drawdownBinPct" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', fontSize: '11px' }} />
                  <Bar dataKey="probabilityPct" name="Probability (%)" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
