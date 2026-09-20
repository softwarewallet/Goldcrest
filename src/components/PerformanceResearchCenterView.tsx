import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, Wallet, Layers, FileText, AlertTriangle } from 'lucide-react';

interface LiveAccount {
  broker: string;
  accountId?: string;
  accountType?: string;
  balance?: number;
  equity?: number;
  availableMargin?: number;
  freeMargin?: number;
  usedMargin?: number;
  currency?: string;
  connectionStatus?: string;
  lastUpdate?: number;
  server?: string;
}

interface LivePosition {
  id: string;
  broker: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  currency: string;
  timestamp: number;
}

interface LiveOrder {
  id: string;
  broker: string;
  symbol: string;
  side: string;
  quantity: number;
  price?: number;
  status: string;
  timestamp: number;
}

export const PerformanceResearchCenterView: React.FC = () => {
  const [accounts, setAccounts] = useState<LiveAccount[]>([]);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [autoStatus, setAutoStatus] = useState<any | null>(null);
  const [logStatus, setLogStatus] = useState<any | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsRes, positionsRes, ordersRes, autoRes, logRes, auditRes] = await Promise.all([
        fetch('/api/brokers/accounts', { cache: 'no-store' }),
        fetch('/api/brokers/positions', { cache: 'no-store' }),
        fetch('/api/brokers/orders', { cache: 'no-store' }),
        fetch('/api/auto-trading/status', { cache: 'no-store' }),
        fetch('/api/live-log/status', { cache: 'no-store' }),
        fetch('/api/governance/audit-logs?limit=25', { cache: 'no-store' })
      ]);

      if (!accountsRes.ok || !positionsRes.ok || !ordersRes.ok) {
        throw new Error('One or more live broker endpoints are unavailable.');
      }

      const liveAccounts = await accountsRes.json();
      const livePositions = await positionsRes.json();
      const liveOrders = await ordersRes.json();

      setAccounts(Array.isArray(liveAccounts) ? liveAccounts.filter((a: any) => a?.environment === 'LIVE') : []);
      setPositions(Array.isArray(livePositions) ? livePositions : []);
      setOrders(Array.isArray(liveOrders) ? liveOrders : []);

      if (autoRes.ok) setAutoStatus(await autoRes.json());
      if (logRes.ok) setLogStatus(await logRes.json());
      if (auditRes.ok) {
        const audit = await auditRes.json();
        setAuditLogs(Array.isArray(audit) ? audit : []);
      }

      setLastUpdated(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Unable to load live performance telemetry.');
      setAccounts([]);
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

  const money = (value: number | undefined, currency: string | undefined) => {
    if (!Number.isFinite(Number(value))) return '—';
    const curr = currency === 'INR' ? 'INR' : 'USD';
    return new Intl.NumberFormat(curr === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value));
  };

  return (
    <div id="performance_research_center" className="space-y-4 font-mono text-xs text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">Live Performance & Operations Center</h2>
              <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-700 text-rose-300 text-[10px] font-bold">LIVE ONLY</span>
            </div>
            <p className="text-slate-400 mt-1 text-[11px]">
              Runtime performance is sourced from the connected cTrader and 5paisa live gateways. Unavailable data is shown as unavailable; no simulated values are inserted.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            REFRESH LIVE
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded border border-slate-800 bg-slate-950 text-slate-400">ENVIRONMENT: <b className="text-rose-300">LIVE</b></span>
          <span className="px-2 py-1 rounded border border-slate-800 bg-slate-950 text-slate-400">AUTO LIVE: <b className={autoStatus?.state === 'RUNNING' || autoStatus?.state === 'PREPARING' ? 'text-emerald-300' : 'text-amber-300'}>{autoStatus?.state || 'UNKNOWN'}</b></span>
          <span className="px-2 py-1 rounded border border-slate-800 bg-slate-950 text-slate-400">RUNTIME LOG: <b className={logStatus?.enabled ? 'text-emerald-300' : 'text-amber-300'}>{logStatus?.enabled ? 'RECORDING' : 'STOPPED'}</b></span>
          <span className="px-2 py-1 rounded border border-slate-800 bg-slate-950 text-slate-400">UPDATED: <b className="text-slate-200">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</b></span>
        </div>
      </div>

      {error && (
        <div className="bg-amber-950/40 border border-amber-800 rounded-xl p-3 text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {accounts.length === 0 ? (
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 text-slate-500">
            No live account data is currently available.
          </div>
        ) : accounts.map(account => (
          <div key={`${account.broker}-${account.accountId || 'unknown'}`} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white uppercase">{account.broker}</span>
              </div>
              <span className="text-[10px] text-emerald-300">{account.connectionStatus || 'LIVE'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div><div className="text-[10px] text-slate-500">BALANCE</div><div className="text-base font-bold text-white mt-1">{money(account.balance, account.currency)}</div></div>
              <div><div className="text-[10px] text-slate-500">EQUITY</div><div className="text-base font-bold text-emerald-300 mt-1">{money(account.equity, account.currency)}</div></div>
              <div><div className="text-[10px] text-slate-500">FREE MARGIN</div><div className="text-sm text-slate-200 mt-1">{money(account.availableMargin ?? account.freeMargin, account.currency)}</div></div>
              <div><div className="text-[10px] text-slate-500">USED MARGIN</div><div className="text-sm text-slate-200 mt-1">{money(account.usedMargin, account.currency)}</div></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-cyan-400" /><h3 className="font-bold text-white">LIVE POSITIONS</h3></div>
          {positions.length === 0 ? <div className="text-slate-500 py-6 text-center">No live positions.</div> : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {positions.map(pos => (
                <div key={pos.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                  <div className="flex justify-between"><span className="font-bold text-white">{pos.broker} · {pos.symbol}</span><span className={pos.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>{pos.side}</span></div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                    <span>QTY <b className="text-slate-200">{pos.quantity}</b></span>
                    <span>ENTRY <b className="text-slate-200">{pos.entryPrice}</b></span>
                    <span>LIVE <b className="text-slate-200">{pos.currentPrice}</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-cyan-400" /><h3 className="font-bold text-white">LIVE ORDERS</h3></div>
          {orders.length === 0 ? <div className="text-slate-500 py-6 text-center">No live orders.</div> : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {orders.map(order => (
                <div key={order.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
                  <div className="flex justify-between"><span className="font-bold text-white">{order.broker} · {order.symbol}</span><span className="text-slate-300">{order.status}</span></div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                    <span>QTY <b className="text-slate-200">{order.quantity}</b></span>
                    <span>SIDE <b className={order.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>{order.side}</b></span>
                    <span>PRICE <b className="text-slate-200">{order.price ?? '—'}</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-emerald-400" /><h3 className="font-bold text-white">LIVE AUDIT EVENTS</h3></div>
        {auditLogs.length === 0 ? <div className="text-slate-500 py-6 text-center">No live audit events available.</div> : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {auditLogs.map((event, index) => (
              <div key={event.eventId || event.id || index} className="flex items-start justify-between gap-3 p-2 bg-slate-950 border border-slate-800 rounded">
                <div><div className="text-slate-200 font-semibold">{event.action || event.eventType || 'AUDIT EVENT'}</div><div className="text-[10px] text-slate-500">{event.category || 'LIVE'} · {event.operatorId || 'SYSTEM'}</div></div>
                <div className="text-[10px] text-slate-500 whitespace-nowrap">{event.timestamp ? new Date(event.timestamp).toLocaleString() : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
