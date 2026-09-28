import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type Bucket = {
  key: string; trades: number; wins: number; losses: number; breakeven: number;
  winRatePct: number | null; totalPnl: number; averagePnl: number | null;
  averageWin: number | null; averageLoss: number | null; profitFactor: number | null;
  expectancy: number | null; averageMfe: number | null; averageMae: number | null;
  averageHoldingMinutes: number | null; sampleSufficient: boolean;
};

type Audit = {
  generatedAt: number; minimumSampleCount: number;
  scope: { totalClosedTrades: number; evaluatedTrades: number; excludedWithoutOutcome: number; fromTimestamp: number | null; toTimestamp: number | null };
  overall: Bucket; recent30d: Bucket; recent90d: Bucket;
  byPair: Bucket[]; byDirection: Bucket[]; byScoreBand: Bucket[]; byRegime: Bucket[];
  bySession: Bucket[]; byNewsRisk: Bucket[]; byStrategy: Bucket[]; warnings: string[];
};

const fmt = (v: number | null, digits = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);
const pct = (v: number | null) => v == null ? '—' : v.toFixed(1) + '%';
const pf = (v: number | null) => v == null ? '—' : Number.isFinite(v) ? v.toFixed(2) : '∞';

function BucketTable({ rows }: { rows: Bucket[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] font-mono">
        <thead><tr className="border-b border-slate-800 text-slate-500">
          <th className="py-2 text-left">Context</th><th>Trades</th><th>Wins</th><th>Losses</th>
          <th>Win Rate</th><th>P&L</th><th>Expectancy</th><th>PF</th><th>Avg MAE</th><th>Avg MFE</th><th>Hold</th>
        </tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.key} className="border-b border-slate-800/60">
            <td className="py-2 text-white">{row.key}</td>
            <td className="text-center">{row.trades}</td>
            <td className="text-center text-emerald-300">{row.wins}</td>
            <td className="text-center text-rose-300">{row.losses}</td>
            <td className="text-center">{pct(row.winRatePct)}</td>
            <td className={row.totalPnl >= 0 ? 'text-emerald-300 text-right' : 'text-rose-300 text-right'}>{fmt(row.totalPnl)}</td>
            <td className={row.expectancy != null && row.expectancy >= 0 ? 'text-emerald-300 text-right' : 'text-rose-300 text-right'}>{fmt(row.expectancy)}</td>
            <td className="text-right">{pf(row.profitFactor)}</td>
            <td className="text-right">{fmt(row.averageMae)}</td>
            <td className="text-right">{fmt(row.averageMfe)}</td>
            <td className="text-right">{fmt(row.averageHoldingMinutes, 1)}m</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function PairPredictionAccuracyAuditPanel() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dimension, setDimension] = useState<'pair'|'score'|'direction'|'regime'|'session'|'news'|'strategy'>('pair');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/live-trade-research/pair-accuracy-audit?minimumSampleCount=30', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || data?.error || 'Accuracy audit unavailable.');
      setAudit(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Accuracy audit unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="bg-slate-900 border border-rose-900 rounded-xl p-4 text-[11px] font-mono text-rose-300">{error}</div>;
  if (!audit) return <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-[11px] font-mono text-slate-400">{loading ? 'Loading historical accuracy audit...' : 'No audit data available.'}</div>;

  const selectedRows =
    dimension === 'pair' ? audit.byPair :
    dimension === 'score' ? audit.byScoreBand :
    dimension === 'direction' ? audit.byDirection :
    dimension === 'regime' ? audit.byRegime :
    dimension === 'session' ? audit.bySession :
    dimension === 'news' ? audit.byNewsRisk : audit.byStrategy;

  const headline = audit.overall;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white font-mono">Historical Pair Prediction & Trade Accuracy Audit</div>
          <div className="text-[10px] text-slate-500 mt-1">Closed cTrader trade outcomes only · no database reset · minimum context sample {audit.minimumSampleCount}</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono disabled:opacity-50">
          <RefreshCw size={12} className="inline mr-1" />{loading ? 'Refreshing...' : 'Refresh Audit'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[10px] font-mono">
        <div><div className="text-slate-500">Evaluated Trades</div><div className="text-white text-lg">{headline.trades}</div></div>
        <div><div className="text-slate-500">Win Rate</div><div className="text-white text-lg">{pct(headline.winRatePct)}</div></div>
        <div><div className="text-slate-500">Total P&L</div><div className={headline.totalPnl >= 0 ? 'text-emerald-300 text-lg' : 'text-rose-300 text-lg'}>{fmt(headline.totalPnl)}</div></div>
        <div><div className="text-slate-500">Expectancy</div><div className={headline.expectancy != null && headline.expectancy >= 0 ? 'text-emerald-300 text-lg' : 'text-rose-300 text-lg'}>{fmt(headline.expectancy)}</div></div>
        <div><div className="text-slate-500">Profit Factor</div><div className="text-white text-lg">{pf(headline.profitFactor)}</div></div>
        <div><div className="text-slate-500">30D / 90D Win Rate</div><div className="text-white text-lg">{pct(audit.recent30d.winRatePct)} / {pct(audit.recent90d.winRatePct)}</div></div>
      </div>

      {audit.warnings.length > 0 && (
        <div className="space-y-1">{audit.warnings.map((warning, index) => (
          <div key={index} className="border border-amber-900/60 bg-amber-950/20 rounded p-2 text-[10px] font-mono text-amber-200"><AlertTriangle size={12} className="inline mr-1" />{warning}</div>
        ))}</div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {([
          ['pair','Pair'],['score','Score Band'],['direction','Direction'],['regime','Market Regime'],
          ['session','Session'],['news','News Risk'],['strategy','Strategy']
        ] as const).map(([key,label]) => (
          <button key={key} type="button" onClick={() => setDimension(key)} className={dimension === key ? 'px-2.5 py-1 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 text-[10px] font-mono' : 'px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-mono'}>{label}</button>
        ))}
      </div>

      <BucketTable rows={selectedRows} />
    </div>
  );
}
