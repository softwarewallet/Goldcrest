import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { BrokerAccountInfo, BrokerType } from '../brokers/types';

interface BalanceDisplayProps {
  environment?: string;
}

const BROKERS: BrokerType[] = ['CTRADER', 'FIVE_PAISA'];

export const BalanceDisplay: React.FC<BalanceDisplayProps> = ({ environment = 'LIVE' }) => {
  const [accounts, setAccounts] = useState<Record<BrokerType, BrokerAccountInfo | null>>({
    CTRADER: null,
    FIVE_PAISA: null,
    PAPER: null
  });
  const [errors, setErrors] = useState<Record<BrokerType, string | null>>({
    CTRADER: null,
    FIVE_PAISA: null,
    PAPER: null
  });
  const [loading, setLoading] = useState<Record<BrokerType, boolean>>({
    CTRADER: false,
    FIVE_PAISA: false,
    PAPER: false
  });
  const [lastUpdated, setLastUpdated] = useState<Record<BrokerType, number | null>>({
    CTRADER: null,
    FIVE_PAISA: null,
    PAPER: null
  });

  const fetchBalances = async () => {
    const results = await Promise.all(BROKERS.map(async (broker) => {
      setLoading(prev => ({ ...prev, [broker]: true }));
      try {
        const response = await fetch(`/api/brokers/account?broker=${broker}&environment=${environment}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Account data unavailable');
        }

        setAccounts(prev => ({ ...prev, [broker]: data }));
        setErrors(prev => ({ ...prev, [broker]: null }));
        setLastUpdated(prev => ({ ...prev, [broker]: Date.now() }));
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [broker]: err.message || 'Connection unavailable' }));
      } finally {
        setLoading(prev => ({ ...prev, [broker]: false }));
      }
    }));

    await Promise.all(results);
  };

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 120000);
    return () => clearInterval(interval);
  }, [environment]);

  const formatCurrency = (value: number | undefined, currency = 'USD') => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '--';
    const normalized = currency.toUpperCase();
    return new Intl.NumberFormat(normalized === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const timeAgo = (timestamp: number | null) => {
    if (!timestamp) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  };

  const renderCard = (broker: BrokerType) => {
    const account = accounts[broker];
    const error = errors[broker];
    const isLoading = loading[broker];
    const updated = lastUpdated[broker];
    const isStale = updated ? Date.now() - updated > 300000 : false;
    const label = broker === 'CTRADER' ? 'cTrader' : '5paisa';
    const market = broker === 'CTRADER' ? 'FOREX' : 'INDIAN MARKETS';

    return (
      <div key={broker} id={`balance_display_${broker.toLowerCase()}`} className="flex flex-col bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-2.5 min-w-[210px] shadow-sm font-mono">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center space-x-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : account?.connectionStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{label}</span>
            <span className="text-[8px] px-1 rounded bg-slate-800 text-slate-500 border border-slate-700">{market}</span>
          </div>
          <Wallet className="w-3.5 h-3.5 text-emerald-500" />
        </div>

        {account ? (
          <>
            <div className="flex items-baseline space-x-1.5">
              <div className="text-lg font-bold text-white tracking-tight">{formatCurrency(account.balance, account.currency)}</div>
              <div className="text-[9px] font-bold text-slate-500">{account.currency}</div>
            </div>
            <div className="mt-1 pt-1 border-t border-slate-800/60 text-[9px] text-slate-400 space-y-0.5">
              <div className="flex justify-between">
                <span>Equity <strong className="text-slate-200">{formatCurrency(account.equity, account.currency)}</strong></span>
                <span>Free <strong className="text-slate-200">{formatCurrency(account.availableMargin ?? account.freeMargin, account.currency)}</strong></span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate max-w-[105px]" title={account.accountId}>A/C {account.accountId}</span>
                <span className={isStale ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                  <Clock className="inline w-2.5 h-2.5 mr-0.5" />{isStale ? 'STALE' : timeAgo(updated)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="py-1.5">
            <div className="text-sm font-bold text-slate-500">{isLoading ? 'Connecting…' : 'Balance Unavailable'}</div>
            {error && <div className="text-[9px] text-rose-400 truncate mt-0.5" title={error}><AlertCircle className="inline w-2.5 h-2.5 mr-1" />{error}</div>}
          </div>
        )}

        <button
          id={`btn_refresh_balance_${broker.toLowerCase()}`}
          onClick={fetchBalances}
          disabled={isLoading}
          className="mt-1 text-[9px] flex items-center justify-end space-x-1 text-emerald-500 hover:text-emerald-400 disabled:opacity-50"
        >
          <RefreshCw className={`w-2.5 h-2.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>REFRESH</span>
        </button>
      </div>
    );
  };

  return (
    <div id="dual_live_balance_display" className="flex items-center gap-2">
      {renderCard('CTRADER')}
      {renderCard('FIVE_PAISA')}
    </div>
  );
};
