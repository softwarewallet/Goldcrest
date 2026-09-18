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
      const response = await fetch('/api/brokers/account');
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to fetch account data');
      }
      const data = await response.json();
      setAccount(data);
      setLastUpdated(Date.now());
    } catch (err: any) {
      console.error('Balance fetch error:', err);
      setError(err.message);
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

  const formatCurrency = (value: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2
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
      <div className="flex flex-col bg-slate-900 border border-rose-900/50 rounded-lg p-2.5 min-w-[200px] shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Balance Unavailable</span>
          <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
        </div>
        <div className="text-sm font-mono text-slate-500 italic">
          {account ? `Last: ${formatCurrency(account.balance, account.currency)}` : 'Connection failed'}
        </div>
        <button 
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
      <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-lg p-2.5 min-w-[200px] animate-pulse">
        <div className="h-3 w-24 bg-slate-800 rounded mb-2"></div>
        <div className="h-5 w-32 bg-slate-800 rounded"></div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-lg p-2.5 min-w-[200px]">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Account</div>
        <div className="text-sm font-bold text-slate-400">Not Selected</div>
      </div>
    );
  }

  const isStale = lastUpdated && (Date.now() - lastUpdated) > 300000; // Over 5 mins

  return (
    <div className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-2.5 min-w-[220px] transition group shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {account.isLiveAccount ? 'LIVE ACCOUNT' : 'SIMULATED ACCOUNT'}
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
        <div className="text-[10px] font-mono font-bold text-slate-500 uppercase">
          {account.currency}
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-medium uppercase tracking-tighter">
            Equity: <span className="text-slate-300">{formatCurrency(account.equity, account.currency)}</span>
          </span>
          <span className="text-[9px] text-slate-500 font-medium uppercase tracking-tighter">
            Broker: <span className="text-slate-300">{account.broker} • {account.accountId}</span>
          </span>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center space-x-1 text-[9px] text-slate-500">
            <Clock className="w-2.5 h-2.5" />
            <span className={isStale ? 'text-amber-500 font-bold' : ''}>
              {isStale ? 'LAST KNOWN' : lastUpdated ? getTimeAgo(lastUpdated) : 'Never'}
            </span>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); fetchBalance(); }}
            disabled={loading}
            className="text-[9px] text-emerald-500 hover:text-emerald-400 font-bold transition"
          >
            REFRESH
          </button>
        </div>
      </div>
    </div>
  );
};
