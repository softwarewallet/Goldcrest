import React from 'react';
import { Globe } from 'lucide-react';
import { ForexDashboard } from './ForexDashboard';
import { Candle, TradingSignal } from '../markets/common/types';

interface MarketHubProps {
  forexPairs: any[];
  candlesMap: Record<string, Candle[]>;
  onSelectSignal: (signal: TradingSignal) => void;
  onEnsureCandles: (symbol: string) => Promise<void>;
  environment?: string;
}

export const MarketHub: React.FC<MarketHubProps> = ({
  forexPairs, candlesMap, onSelectSignal, onEnsureCandles, environment = 'LIVE'
}) => (
  <div id="unified_market_hub" className="space-y-4">
    <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-3">
      <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
        <Globe className="w-4 h-4 text-emerald-400" />
        FOREX MARKET
      </div>
      <span className="text-[10px] font-mono text-slate-500">cTrader · G10 / supported FX pairs</span>
    </div>
    <ForexDashboard
      pairs={forexPairs}
      onSelectSignal={onSelectSignal}
      candlesMap={candlesMap}
      onEnsureCandles={onEnsureCandles}
      environment={environment}
    />
  </div>
);
