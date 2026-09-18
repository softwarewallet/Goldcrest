import React, { useState, useEffect } from 'react';
import { Wallet, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { BrokerType, BrokerAccountInfo } from '../brokers/types';

interface BalanceDisplayProps {
  broker: BrokerType;
  environment: string;
}

export const BalanceDisplay: React.FC<BalanceDisplayProps> = ({ broker, environment }) => {
  const [account, setAccount] = useState<BrokerAccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchBalance = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = broker
        ? `/api/brokers/account?broker=${broker}&environment=${environment || 'LIVE'}`
        : '/api/brokers/account';
      const response = await fetch(url);
      if (!response.ok) {
        let errMsg = 'Failed to fetch account data';
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch {
          errMsg = `Server responded with status ${response.status}`;
        }
        throw new Error(errMsg);
      }
      const data = await response.json();
      setAccount(data);
      setLastUpdated(Date.now());
    } catch (err: any) {
      console.warn('Balance fetch error:', err.message);
      setError(err.message || 'Connection unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    // Auto-refresh every 2 minutes
    const interval = setInterval(fetchBalance, 120000);
    return () => clearInterval(interval);
  }, [broker, environment]);

  const formatCurrency = (value: number | undefined, currency: string = 'USD') => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '--';
    const locale = currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  if (error) {
    return (
      <div id="balance_display_error" className="flex flex-col bg-slate-900 border border-rose-900/50 rounded-lg p-2.5 min-w-[220px] shadow-sm font-mono text-xs">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Balance Unavailable</span>
          <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
        </div>
        <div className="text-sm font-mono text-slate-400">
          {account ? `Last Known: ${formatCurrency(account.balance, account.currency)}` : 'Connection Failed'}
        </div>
        <div className="text-[10px] text-rose-400/80 truncate mt-0.5" title={error}>
          {error}
        </div>
        <button 
          id="btn_retry_balance"
          onClick={fetchBalance}
          className="mt-1.5 text-[10px] flex items-center space-x-1 text-slate-400 hover:text-white transition"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Retry Connection</span>
        </button>
      </div>
    );
  }

  if (!account && loading) {
    return (
      <div id="balance_display_loading" className="flex flex-col bg-slate-900 border border-slate-800 rounded-lg p-2.5 min-w-[220px] animate-pulse font-mono">
        <div className="h-3 w-24 bg-slate-800 rounded mb-2"></div>
        <div className="h-5 w-32 bg-slate-800 rounded"></div>
      </div>
    );
  }

  if (!account) {
    return (
      <div id="balance_display_empty" className="flex flex-col bg-slate-900 border border-slate-800 rounded-lg p-2.5 min-w-[220px] font-mono">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Account</div>
        <div className="text-sm font-bold text-slate-400">Not Selected</div>
      </div>
    );
  }

  const isStale = lastUpdated && (Date.now() - lastUpdated) > 300000; // Over 5 mins

  return (
    <div id="balance_display_card" className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-2.5 min-w-[240px] transition group shadow-sm font-mono">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : account.connectionStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'}`}></div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {account.isLiveAccount ? 'LIVE ACCOUNT' : 'SIMULATED ACCOUNT'}
          </span>
          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
            {account.connectionStatus || 'CONNECTED'}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {loading && <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />}
          <Wallet className="w-3.5 h-3.5 text-emerald-500 group-hover:scale-110 transition-transform" />
        </div>
      </div>

      <div className="flex items-baseline space-x-2">
        <div className="text-lg font-mono font-bold text-white tracking-tight">
          {formatCurrency(account.balance, account.currency)}
        </div>
        <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">
          {account.currency}
        </div>
      </div>

      <div className="mt-1 space-y-0.5 border-t border-slate-800/60 pt-1">
        <div className="flex items-center justify-between text-[9px] text-slate-400 font-medium">
          <span>Equity: <strong className="text-slate-200 font-mono">{formatCurrency(account.equity, account.currency)}</strong></span>
          <span>Avail Margin: <strong className="text-slate-200 font-mono">{formatCurrency(account.availableMargin ?? account.freeMargin, account.currency)}</strong></span>
        </div>
        <div className="flex items-center justify-between text-[9px] text-slate-500">
          <span className="truncate max-w-[130px]" title={`${account.broker} • ${account.accountId}`}>
            {account.broker} • {account.accountId}
          </span>
          <div className="flex items-center space-x-1">
            <Clock className="w-2.5 h-2.5" />
            <span className={isStale ? 'text-amber-500 font-bold' : ''}>
              {isStale ? 'STALE' : lastUpdated ? getTimeAgo(lastUpdated) : 'Live'}
            </span>
            <button 
              id="btn_refresh_balance"
              onClick={(e) => { e.stopPropagation(); fetchBalance(); }}
              disabled={loading}
              className="text-emerald-500 hover:text-emerald-400 font-bold ml-1 transition"
            >
              REFRESH
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
