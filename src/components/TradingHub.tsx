import React from 'react';
import { Activity, Lock, ShieldCheck, Radio, ArrowRight, AlertTriangle } from 'lucide-react';
import { TradingEnvironment } from '../brokers/types';

interface TradingHubProps {
  environment: TradingEnvironment;
  selectedBroker?: string;
  maskedAccount?: string;
  balance?: number;
  currency?: string;
  isEmergencyHalted: boolean;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
}

export const TradingHub: React.FC<TradingHubProps> = ({ environment, isEmergencyHalted }) => (
  <div id="unified_trading_hub" className="space-y-4">
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400"><Activity className="w-5 h-5" /></div>
          <div>
            <div className="font-bold text-white text-sm">Trading Execution & Portfolio Engine</div>
            <div className="text-slate-400 text-[11px] font-mono">Automatic market-to-broker routing is active.</div>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded border bg-rose-950 text-rose-300 border-rose-600 font-bold">{environment === 'LIVE' ? 'LIVE BROKER ACCOUNT' : 'LIVE ONLY'}</span>
          <span className="px-2.5 py-1 rounded border bg-amber-950/50 text-amber-300 border-amber-700 font-bold"><Lock className="inline w-3 h-3 mr-1" /> AUTONOMOUS EXECUTION OFF</span>
        </div>
      </div>
    </div>

    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4"><Radio className="w-4 h-4 text-emerald-400" /><h3 className="text-sm font-bold text-white">Automatic Broker Routing</h3></div>
        <div className="space-y-2 font-mono text-xs">
          {[
            ['FOREX', 'cTrader LIVE'],
            ['INDIAN_EQUITY', '5paisa LIVE'],
            ['INDIAN_FUTURES', '5paisa LIVE'],
            ['INDIAN_OPTIONS', '5paisa LIVE']
          ].map(([market, broker]) => (
            <div key={market} className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800">
              <span className="text-slate-300">{market}</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">{broker}<ArrowRight className="w-3 h-3" /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4"><ShieldCheck className="w-4 h-4 text-cyan-400" /><h3 className="text-sm font-bold text-white">Execution Safety State</h3></div>
        <div className="space-y-2 font-mono text-xs">
          <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">LIVE account connectivity</span><span className="text-emerald-400 font-bold">ALLOWED</span></div>
          <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Autonomous live submission</span><span className="text-rose-400 font-bold">PERMANENTLY BLOCKED</span></div>
          <div className="flex justify-between p-2.5 rounded bg-slate-950 border border-slate-800"><span className="text-slate-400">Emergency stop</span><span className={isEmergencyHalted ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>{isEmergencyHalted ? 'ACTIVE' : 'READY'}</span></div>
        </div>
      </div>
    </div>

    <div className="bg-slate-900 border border-amber-800/50 rounded-xl p-5">
      <div className="flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" /><div>
        <div className="text-sm font-bold text-amber-300">LIVE order workflow</div>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">Goldcrest can validate and prepare an order proposal against the appropriate LIVE broker. Autonomous submission of live-money orders remains disabled. Current account balances, positions and orders must come from the broker APIs.</p>
      </div></div>
    </div>
  </div>
);
