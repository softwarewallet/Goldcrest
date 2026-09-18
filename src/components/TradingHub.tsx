import React, { useState } from 'react';
import { PaperTradingPanel } from './PaperTradingPanel';
import { DemoExecutionPanel } from './trading/DemoExecutionPanel';
import { DemoPositionsPanel } from './trading/DemoPositionsPanel';
import { DemoTestCenterView } from './trading/DemoTestCenterView';
import {
  Activity,
  CheckCircle2,
  FileText,
  Flame,
  Layers,
  Lock,
  Play,
  Send,
  Shield,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Zap
} from 'lucide-react';
import { TradingEnvironment, BrokerType } from '../brokers/types';

interface TradingHubProps {
  environment: TradingEnvironment;
  selectedBroker: BrokerType;
  maskedAccount?: string;
  balance?: number;
  currency?: string;
  isEmergencyHalted: boolean;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
}

export const TradingHub: React.FC<TradingHubProps> = ({
  environment,
  selectedBroker,
  maskedAccount = '****',
  balance = 100000,
  currency = 'USD',
  isEmergencyHalted,
  onRequestEnvironmentChange
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'DEMO_EXECUTION' | 'DEMO_POSITIONS' | 'DEMO_TEST_CENTER' | 'PAPER_PORTFOLIO'>('DEMO_EXECUTION');

  return (
    <div id="unified_trading_hub" className="space-y-4">
      {/* Top Environment & Trading State Summary Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white text-sm">Trading Execution & Portfolio Engine</div>
              <div className="text-slate-400 text-[11px] flex items-center space-x-2">
                <span>Active Broker: <strong className="text-slate-200">{selectedBroker}</strong></span>
                <span className="text-slate-600">•</span>
                <span>Account: <strong className="text-slate-200">{maskedAccount}</strong></span>
                <span className="text-slate-600">•</span>
                <span>Balance: <strong className="text-emerald-400">{currency} {balance.toLocaleString()}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <span className="text-slate-500 text-[10px] uppercase">ENVIRONMENT:</span>
              <span className={`px-2.5 py-1 rounded font-bold text-xs border ${
                environment === 'LIVE'
                  ? 'bg-rose-950 text-rose-300 border-rose-600 animate-pulse'
                  : environment === 'DEMO'
                  ? 'bg-amber-950 text-amber-300 border-amber-600'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-700'
              }`}>
                {environment} MODE
              </span>
            </div>

            <div className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-300 border border-rose-500/30 flex items-center space-x-1">
              <Lock className="w-3 h-3" />
              <span>LIVE LOCKED (PHASE 6)</span>
            </div>
          </div>
        </div>

        {/* Secondary Subtab Navigation Bar */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveSubTab('DEMO_EXECUTION')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
              activeSubTab === 'DEMO_EXECUTION'
                ? 'bg-amber-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>DEMO EXECUTION & TICKET</span>
          </button>

          <button
            onClick={() => setActiveSubTab('DEMO_POSITIONS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
              activeSubTab === 'DEMO_POSITIONS'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>DEMO POSITIONS & EXITS</span>
          </button>

          <button
            onClick={() => setActiveSubTab('DEMO_TEST_CENTER')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
              activeSubTab === 'DEMO_TEST_CENTER'
                ? 'bg-purple-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>DEMO TEST CENTER (14 TESTS)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('PAPER_PORTFOLIO')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
              activeSubTab === 'PAPER_PORTFOLIO'
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>PAPER PORTFOLIO & ORDERS</span>
          </button>
        </div>
      </div>

      {/* Tab Content Rendering */}
      {activeSubTab === 'DEMO_EXECUTION' && (
        <DemoExecutionPanel
          environment={environment}
          selectedBroker={selectedBroker}
          maskedAccount={maskedAccount}
          isEmergencyHalted={isEmergencyHalted}
          onRequestEnvironmentChange={onRequestEnvironmentChange}
        />
      )}

      {activeSubTab === 'DEMO_POSITIONS' && (
        <DemoPositionsPanel />
      )}

      {activeSubTab === 'DEMO_TEST_CENTER' && (
        <DemoTestCenterView />
      )}

      {activeSubTab === 'PAPER_PORTFOLIO' && (
        <PaperTradingPanel />
      )}
    </div>
  );
};
