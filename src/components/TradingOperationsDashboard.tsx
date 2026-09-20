import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, FileText, Layers, AlertTriangle, Radio } from 'lucide-react';

interface TradingOperationsDashboardProps {
  initialSubTab?: 'OPS' | 'RESEARCH' | 'EXPLORER';
  focusedSection?: 'RECONCILIATION' | 'PNL' | 'FUNNEL' | 'AUDIT';
}

export const TradingOperationsDashboard: React.FC<TradingOperationsDashboardProps> = () => {
  const [status, setStatus] = useState<any | null>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [autoStatus, setAutoStatus] = useState<any | null>(null);
  const [logStatus, setLogStatus] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, posRes, orderRes, auditRes, autoRes, logRes] = await Promise.all([
        fetch('/api/brokers/status', { cache: 'no-store' }),
        fetch('/api/brokers/positions', { cache: 'no-store' }),
        fetch('/api/brokers/orders', { cache: 'no-store' }),
        fetch('/api/governance/audit-logs?limit=50', { cache: 'no-store' }),
        fetch('/api/auto-trading/status', { cache: 'no-store' }),
        fetch('/api/live-log/status', { cache: 'no-store' })
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (posRes.ok) {
        const d = await posRes.json();
        setPositions(Array.isArray(d) ? d : []);
      } else setPositions([]);
      if (orderRes.ok) {
        const d = await orderRes.json();
        setOrders(Array.isArray(d) ? d : []);
      } else setOrders([]);
      if (auditRes.ok) {
        const d = await auditRes.json();
        setAuditLogs(Array.isArray(d) ? d : []);
      } else setAuditLogs([]);
      if (autoRes.ok) setAutoStatus(await autoRes.json());
      if (logRes.ok) setLogStatus(await logRes.json());

      setLastUpdated(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Unable to load live operations telemetry.');
      setPositions([]);
      setOrders([]);
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

  return (
    <div id="trading_operations_dashboard" className="space-y-4 font-mono text-xs text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">Live Trading Operations</h2>
              <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-700 text-rose-300 text-[10px] font-bold">LIVE ONLY</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Live broker connectivity, positions, orders, runtime status and audit events. No paper, demo or sandbox execution is available.
            </p>
          </div>
          <button onClick={refresh} disabled={loading} className="px-3 py-1.5 rounded border border-slate-700 bg-slate-800 text-slate-200 font-bold flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> REFRESH LIVE
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
          <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800">ENVIRONMENT: <b className="text-rose-300">LIVE</b></span>
          <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800">AUTO LIVE: <b className={autoStatus?.state === 'RUNNING' || autoStatus?.state === 'PREPARING' ? 'text-emerald-300' : 'text-amber-300'}>{autoStatus?.state || 'UNKNOWN'}</b></span>
          <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800">RUNTIME LOG: <b className={logStatus?.enabled ? 'text-emerald-300' : 'text-amber-300'}>{logStatus?.enabled ? 'RECORDING' : 'STOPPED'}</b></span>
          <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800">UPDATED: <b className="text-slate-200">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</b></span>
        </div>
      </div>

      {error && <div className="bg-amber-950/40 border border-amber-800 rounded-xl p-3 text-amber-200 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" />{error}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        {brokers.length === 0 ? (
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 text-slate-500">No live broker status is currently available.</div>
        ) : brokers.map((broker: any) => (
          <div key={broker.broker} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between"><span className="font-bold text-white">{broker.broker}</span><span className={broker.connected ? 'text-emerald-300' : 'text-rose-300'}>{broker.connected ? 'CONNECTED' : 'UNAVAILABLE'}</span></div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><div className="text-[10px] text-slate-500">ACCOUNT</div><div className="text-slate-200 mt-1">{broker.account?.accountId || '—'}</div></div>
              <div><div className="text-[10px] text-slate-500">CURRENCY</div><div className="text-slate-200 mt-1">{broker.account?.currency || '—'}</div></div>
              <div><div className="text-[10px] text-slate-500">BALANCE</div><div className="text-slate-200 mt-1">{broker.account?.balance != null ? broker.account.balance.toLocaleString('en-US') : '—'}</div></div>
              <div><div className="text-[10px] text-slate-500">EQUITY</div><div className="text-emerald-300 mt-1">{broker.account?.equity != null ? broker.account.equity.toLocaleString('en-US') : '—'}</div></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-emerald-400" /><h3 className="font-bold text-white">LIVE POSITIONS ({positions.length})</h3></div>
          {positions.length === 0 ? <div className="py-6 text-center text-slate-500">No live positions.</div> :
            <div className="space-y-2 max-h-80 overflow-y-auto">{positions.map((p: any) =>
              <div key={p.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="flex justify-between"><span className="text-white font-bold">{p.broker} · {p.symbol}</span><span className={p.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>{p.side}</span></div>
                <div className="grid grid-cols-3 mt-2 text-[10px] gap-2"><span>QTY <b className="text-slate-200">{p.quantity}</b></span><span>ENTRY <b className="text-slate-200">{p.entryPrice}</b></span><span>CURRENT <b className="text-slate-200">{p.currentPrice}</b></span></div>
              </div>
            )}</div>}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-cyan-400" /><h3 className="font-bold text-white">LIVE ORDERS ({orders.length})</h3></div>
          {orders.length === 0 ? <div className="py-6 text-center text-slate-500">No live orders.</div> :
            <div className="space-y-2 max-h-80 overflow-y-auto">{orders.map((o: any) =>
              <div key={o.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="flex justify-between"><span className="text-white font-bold">{o.broker} · {o.symbol}</span><span className="text-slate-300">{o.status}</span></div>
                <div className="grid grid-cols-3 mt-2 text-[10px] gap-2"><span>QTY <b className="text-slate-200">{o.quantity}</b></span><span>SIDE <b className={o.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>{o.side}</b></span><span>PRICE <b className="text-slate-200">{o.price ?? '—'}</b></span></div>
              </div>
            )}</div>}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-emerald-400" /><h3 className="font-bold text-white">LIVE AUDIT TRAIL</h3></div>
        {auditLogs.length === 0 ? <div className="py-6 text-center text-slate-500">No live audit events available.</div> :
          <div className="space-y-1.5 max-h-72 overflow-y-auto">{auditLogs.map((e: any, i: number) =>
            <div key={e.eventId || e.id || i} className="flex justify-between gap-3 p-2 bg-slate-950 border border-slate-800 rounded">
              <div><div className="text-slate-200 font-semibold">{e.action || e.eventType || 'AUDIT EVENT'}</div><div className="text-[10px] text-slate-500">{e.category || 'LIVE'} · {e.operatorId || 'SYSTEM'}</div></div>
              <div className="text-[10px] text-slate-500 whitespace-nowrap">{e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</div>
            </div>
          )}</div>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-400" /><h3 className="font-bold text-white">EXECUTION STATE</h3></div>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded p-3"><div className="text-[10px] text-slate-500">AUTONOMOUS PERMISSION</div><div className="mt-1 font-bold">{autoStatus?.autonomousPermission ? <span className="text-emerald-300">AUTHORIZED</span> : <span className="text-amber-300">GATED</span>}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-3"><div className="text-[10px] text-slate-500">MARKET GATE</div><div className="mt-1 font-bold text-slate-200">{autoStatus?.marketGate?.anyMarketOpen ? 'OPEN' : 'CLOSED'}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-3"><div className="text-[10px] text-slate-500">PRE-OPEN PREPARATION</div><div className="mt-1 font-bold text-slate-200">{autoStatus?.preOpenPreparation?.status || 'IDLE'}</div></div>
        </div>
      </div>
    </div>
  );
};
