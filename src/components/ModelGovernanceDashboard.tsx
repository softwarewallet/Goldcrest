import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Activity, RefreshCw, AlertTriangle, Lock, Radio } from 'lucide-react';

export const ModelGovernanceDashboard: React.FC = () => {
  const [status, setStatus] = useState<any | null>(null);
  const [autoStatus, setAutoStatus] = useState<any | null>(null);
  const [logStatus, setLogStatus] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, autoRes, logRes] = await Promise.all([
        fetch('/api/governance/status', { cache: 'no-store' }),
        fetch('/api/auto-trading/status', { cache: 'no-store' }),
        fetch('/api/live-log/status', { cache: 'no-store' })
      ]);

      if (!statusRes.ok) throw new Error('Live governance status is unavailable.');
      setStatus(await statusRes.json());
      if (autoRes.ok) setAutoStatus(await autoRes.json());
      if (logRes.ok) setLogStatus(await logRes.json());
    } catch (e: any) {
      setError(e?.message || 'Unable to load live governance status.');
      setStatus(null);
      setAutoStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const brokers = Array.isArray(status?.brokers) ? status.brokers.filter((b: any) => b?.environment === 'LIVE') : [];

  if (loading && !status) {
    return <div className="min-h-[40vh] flex items-center justify-center text-slate-400 font-mono text-xs">Loading live governance telemetry…</div>;
  }

  return (
    <div className="space-y-4 font-mono text-xs text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">Live Model Governance & Readiness</h2>
              <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-700 text-rose-300 text-[10px] font-bold">LIVE ONLY</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Governance reflects the actual live execution boundary. Retired paper, demo and sandbox promotion workflows are no longer available.
            </p>
          </div>
          <button onClick={refresh} disabled={loading} className="px-3 py-1.5 rounded border border-slate-700 bg-slate-800 text-slate-200 font-bold flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> REFRESH LIVE
          </button>
        </div>
      </div>

      {error && <div className="bg-amber-950/40 border border-amber-800 rounded-xl p-3 text-amber-200 flex gap-2 items-center"><AlertTriangle className="w-4 h-4 text-amber-400" />{error}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><Radio className="w-4 h-4 text-emerald-400" /><h3 className="font-bold text-white">LIVE BROKER READINESS</h3></div>
          <div className="space-y-2">
            {brokers.length === 0 ? <div className="text-slate-500 py-4">No live broker status available.</div> : brokers.map((b: any) => (
              <div key={b.broker} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{b.broker}</span>
                  <span className={b.connected ? 'text-emerald-300' : 'text-rose-300'}>{b.connected ? 'CONNECTED' : 'UNAVAILABLE'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-slate-400">
                  <span>ACCOUNT <b className="text-slate-200">{b.account?.accountId || '—'}</b></span>
                  <span>CURRENCY <b className="text-slate-200">{b.account?.currency || '—'}</b></span>
                  <span>TRADING STATUS <b className="text-slate-200">{b.tradingStatus || '—'}</b></span>
                  <span>BALANCE <b className="text-slate-200">{b.account?.balance ?? '—'}</b></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><Lock className="w-4 h-4 text-emerald-400" /><h3 className="font-bold text-white">AUTONOMOUS EXECUTION GATES</h3></div>
          <div className="space-y-2">
            <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Trading Mode</span><b className="text-rose-300">{status?.tradingMode || 'LIVE'}</b></div>
            <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Strategy</span><b className="text-emerald-300">fx_structure_v2a</b></div>
            <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Autonomous Permission</span><b className={autoStatus?.autonomousPermission ? 'text-emerald-300' : 'text-amber-300'}>{autoStatus?.autonomousPermission ? 'AUTHORIZED' : 'GATED'}</b></div>
            <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Market Gate</span><b className="text-slate-200">{autoStatus?.marketGate?.anyMarketOpen ? 'OPEN' : 'CLOSED'}</b></div>
            <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Pre-Open Preparation</span><b className="text-slate-200">{autoStatus?.preOpenPreparation?.status || 'IDLE'}</b></div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-400" /><h3 className="font-bold text-white">RUNTIME INTEGRITY</h3></div>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded p-3"><div className="text-[10px] text-slate-500">LIVE LOG</div><div className={logStatus?.enabled ? 'text-emerald-300 mt-1 font-bold' : 'text-amber-300 mt-1 font-bold'}>{logStatus?.enabled ? 'RECORDING' : 'STOPPED'}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-3"><div className="text-[10px] text-slate-500">KILL SWITCH</div><div className={status?.killSwitch?.isHalted ? 'text-rose-300 mt-1 font-bold' : 'text-emerald-300 mt-1 font-bold'}>{status?.killSwitch?.isHalted ? 'HALTED' : 'CLEAR'}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-3"><div className="text-[10px] text-slate-500">AUTO STATE</div><div className="text-slate-200 mt-1 font-bold">{autoStatus?.state || 'UNKNOWN'}</div></div>
        </div>
      </div>
    </div>
  );
};
