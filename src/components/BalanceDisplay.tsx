import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { BrokerAccountInfo } from '../brokers/types';

interface BalanceDisplayProps { environment?: string; }

export const BalanceDisplay: React.FC<BalanceDisplayProps> = () => {
  const [account, setAccount] = useState<BrokerAccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchBalance = async (force = false) => {
    setLoading(true);
    try {
      const url = force ? '/api/brokers/status?force=true' : '/api/brokers/status';
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error || data?.message || `Broker status request failed (HTTP ${response.status})`));
      const row = Array.isArray(data?.brokers) ? data.brokers.find((item: any) => item?.broker === 'CTRADER') : null;
      if (row?.account?.broker === 'CTRADER') {
        setAccount(row.account as BrokerAccountInfo);
        setLastUpdated(Date.now());
        setError(null);
      } else {
        setError(String(row?.error || row?.lastRefreshError || 'cTrader live account data unavailable'));
      }
    } catch (err: any) {
      setError(err?.message || 'cTrader broker status temporarily unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchBalance();
    const interval = setInterval(() => void fetchBalance(), 10000);
    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (value: number | undefined, currency = 'USD') => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '--';
    const normalized = currency.toUpperCase();
    return new Intl.NumberFormat(normalized === 'USD' ? 'en-US' : 'en-GB', {
      style: 'currency', currency: normalized, minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(value);
  };

  const timeAgo = (timestamp: number | null) => {
    if (!timestamp) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  };

  const isStale = lastUpdated ? Date.now() - lastUpdated > 30000 : false;

  return (
    <div id="live_balance_display" className="flex items-center">
      <div className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg py-2 px-3 min-w-[330px] shadow-sm font-mono">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : account?.connectionStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">cTrader</span>
            <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-500 border border-slate-700">FOREX</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-emerald-500" />
            <button type="button" id="btn_refresh_balance_ctrader" onClick={() => void fetchBalance(true)} disabled={loading} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 disabled:opacity-50 transition" title="Refresh Balance">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {account ? (
          <>
            <div className="grid grid-cols-4 gap-2 border-t border-slate-800/60 pt-2">
              {[
                ['Balance', account.balance, 'text-white'],
                ['Equity', account.equity, 'text-white'],
                ['Used margin', account.usedMargin, 'text-amber-300'],
                ['Free margin', account.freeMargin ?? account.availableMargin, 'text-emerald-300']
              ].map(([title, value, tone]) => (
                <div key={String(title)} className="min-w-0">
                  <div className="text-[9px] text-slate-500">{title}</div>
                  <div className={`mt-0.5 text-[12px] font-semibold font-mono ${tone}`}>{formatCurrency(Number(value), account.currency)}</div>
                </div>
              ))}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-500">
              <span className="truncate max-w-[145px]" title={account.accountId}>A/C {account.accountId}</span>
              <span>{account.currency}</span>
              <span className={isStale ? 'text-amber-400 font-bold' : 'text-slate-500'}><Clock className="inline w-2.5 h-2.5 mr-0.5" />{isStale ? 'STALE' : timeAgo(lastUpdated)}</span>
            </div>
          </>
        ) : (
          <div className="py-1.5">
            <div className="text-sm font-bold text-slate-500">{loading ? 'Connecting…' : 'Balance Unavailable'}</div>
            {error && <div className="text-[9px] text-rose-400 truncate mt-0.5" title={error}><AlertCircle className="inline w-2.5 h-2.5 mr-1" />{error.length > 70 ? `${error.substring(0, 67)}...` : error}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
