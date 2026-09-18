import React from 'react';
import {
  Activity,
  ShieldAlert,
  Cpu,
  Database,
  RefreshCw,
  BarChart2,
  Globe,
  Cloud,
  AlertOctagon,
  Sliders,
  DollarSign,
  CheckSquare,
  TrendingUp,
  Target,
  Layers,
  Settings
} from 'lucide-react';
import { ForexSessionState, IndianSessionState } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';
import { BalanceDisplay } from './BalanceDisplay';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  forexSessions: ForexSessionState;
  indianSession: IndianSessionState;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenDiagnostics: () => void;
  environment: TradingEnvironment;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
  selectedBroker: BrokerType;
  maskedAccount?: string;
  isEmergencyHalted: boolean;
  onToggleKillSwitch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  forexSessions,
  indianSession,
  onRefresh,
  isRefreshing,
  onOpenDiagnostics,
  environment,
  onRequestEnvironmentChange,
  selectedBroker,
  maskedAccount = '****',
  isEmergencyHalted,
  onToggleKillSwitch
}) => {
  // Primary unified application areas with direct Control Center, P&L and Operations navigation
  const tabs = [
    { id: 'control_center', label: 'CONTROL CENTER', icon: Activity },
    { id: 'market', label: 'MARKET', icon: TrendingUp },
    { id: 'signals', label: 'SIGNALS', icon: Target },
    { id: 'trading', label: 'TRADING', icon: Layers },
    { id: 'pnl', label: 'P&L & ACCOUNTING', icon: DollarSign },
    { id: 'research', label: 'RESEARCH (CLOSED)', icon: Cpu },
    { id: 'settings', label: 'SETTINGS', icon: Settings }
  ];

  const isLive = environment === 'LIVE';

  return (
    <header id="main_terminal_header" className="bg-slate-900 border-b border-slate-800 text-slate-100 select-none">
      {/* Emergency Halt Banner if Kill Switch is Triggered */}
      {isEmergencyHalted && (
        <div id="emergency_halt_banner" className="bg-rose-600 text-white px-4 py-2 text-xs font-mono font-bold flex items-center justify-between animate-pulse">
          <div className="flex items-center space-x-2">
            <AlertOctagon className="w-5 h-5 text-white" />
            <span>TRADING HALTED: EMERGENCY STOP IS ACTIVE. NEW AUTOMATIC AND MANUAL ORDERS ARE BLOCKED.</span>
          </div>
          <button
            onClick={onToggleKillSwitch}
            className="px-3 py-1 bg-white text-rose-700 rounded font-bold hover:bg-rose-100 transition shadow"
          >
            RESUME TRADING
          </button>
        </div>
      )}

      {/* Global Telemetry Status Bar (Always Visible) */}
      <div id="global_telemetry_bar" className="bg-slate-950 border-b border-slate-800/80 px-4 py-1 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2 text-slate-400">
        <div className="flex items-center space-x-3 truncate">
          <span>ACTIVE AREA: <strong className="text-slate-200 uppercase">{activeTab}</strong></span>
          <span className="text-slate-700">|</span>
          <span>BROKERS: <strong className="text-slate-200">cTrader + 5paisa</strong></span>
          <span className="text-slate-700">|</span>
          <span>ENVIRONMENT: <strong className={isLive ? 'text-rose-400 font-bold' : environment === 'DEMO' ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{environment}</strong></span>
          <span className="text-slate-700">|</span>
          <span>EXECUTION: <strong className="text-slate-200">OFF (MANUAL ONLY)</strong></span>
          <span className="text-slate-700">|</span>
          <span>DATA: <strong className="text-emerald-400">FRESH ({environment})</strong></span>
          <span className="text-slate-700">|</span>
          <span className="inline-flex items-center space-x-1.5 text-emerald-400 font-semibold" title="Live 1-second clock auto-refreshes time dynamically without manual page refresh">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>CLOCK: <strong className="text-emerald-300">1s REALTIME</strong></span>
          </span>
        </div>

        {/* Global Persistent Live / Demo Tag */}
        <div className="flex items-center space-x-2">
          {isLive ? (
            <div className="flex items-center space-x-1.5 bg-rose-950/90 text-rose-300 px-2 py-0.5 rounded border border-rose-600 font-bold animate-pulse">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>LIVE TRADING</span>
              <span className="text-rose-400">({maskedAccount})</span>
            </div>
          ) : environment === 'DEMO' ? (
            <div className="flex items-center space-x-1.5 bg-amber-950/80 text-amber-300 px-2 py-0.5 rounded border border-amber-600 font-semibold">
              <span>DEMO MODE</span>
              <span className="text-amber-400">({maskedAccount})</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 bg-emerald-950/80 text-emerald-300 px-2 py-0.5 rounded border border-emerald-700 font-semibold">
              <span>PAPER MODE</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Navigation & Brand Bar */}
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Market Session Info */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shadow-inner">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white leading-tight">
                AI Trading Analyst
              </h1>
              <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-2">
                <span className="text-emerald-400 font-bold">PRODUCTION TERMINAL</span>
                <span className="text-slate-600">•</span>
                <span>cTrader & 5paisa Live</span>
              </div>
            </div>
          </div>

          {/* Dual LIVE broker balances: cTrader (Forex) + 5paisa (Indian markets) */}
          <BalanceDisplay environment="LIVE" />

          <div className="hidden xl:flex items-center space-x-2 pl-4 border-l border-slate-800 text-xs font-mono">
            {/* Forex Sessions Badge */}
            {(() => {
              const activeList = forexSessions.activeSessions || [];
              const isFxOpen = !activeList.includes('CLOSED (WEEKEND)') && activeList.length > 0;
              return (
                <div
                  id="header_fx_session_badge"
                  title={isFxOpen ? `Forex Market Active: ${activeList.join(', ')}` : 'Forex Market Closed for Weekend'}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border transition ${
                    isFxOpen ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <Globe className={`w-3.5 h-3.5 ${isFxOpen ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span className="text-slate-400 font-semibold">FX:</span>
                  {isFxOpen ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-slate-500" />
                  )}
                  <span className="font-medium truncate max-w-[180px]">
                    {activeList.join(' / ')} {isFxOpen ? '(OPEN)' : ''}
                  </span>
                </div>
              );
            })()}

            {/* Indian Session Badge (NSE / IST) */}
            {(() => {
              const isNseOpen = indianSession.isOpen;
              return (
                <div
                  id="header_nse_session_badge"
                  title={`NSE Stock Market Hours: 09:15 - 15:30 IST. Current Phase: ${indianSession.currentPhase}`}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border transition ${
                    isNseOpen ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <Activity className={`w-3.5 h-3.5 ${isNseOpen ? 'text-emerald-400' : 'text-amber-400'}`} />
                  <span className="text-slate-400 font-semibold">NSE (IST):</span>
                  {isNseOpen ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-amber-500/80" />
                  )}
                  <span className="font-medium">
                    {indianSession.istTime || '09:15-15:30'} ({indianSession.currentPhase})
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Center: Environment Selector */}
        <div id="trading_environment_selector" className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
          <span className="text-slate-500 px-2 text-[10px] uppercase tracking-wider font-semibold">TRADING ENV:</span>
          <button
            id="btn_env_live"
            onClick={() => onRequestEnvironmentChange('LIVE')}
            className="px-4 py-1 rounded font-bold transition text-xs bg-rose-600 text-white shadow-md shadow-rose-950"
          >
            LIVE BROKER ACCOUNT
          </button>
        </div>

        {/* Right Controls: Emergency Stop, Refresh, Settings, Local DB */}
        <div className="flex items-center space-x-2">
          {/* Global Kill Switch Button */}
          <button
            id="btn_emergency_stop"
            onClick={onToggleKillSwitch}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-bold font-mono transition border ${
              isEmergencyHalted
                ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-500 animate-pulse'
                : 'bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border-rose-800'
            }`}
            title="Trigger Emergency Stop: Cancels pending orders, halts new orders"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>{isEmergencyHalted ? 'HALTED' : 'EMERGENCY STOP'}</span>
          </button>

          <button
            id="btn_terminal_refresh"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title="Refresh Quotes and Signals"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            id="btn_open_diagnostics"
            onClick={onOpenDiagnostics}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title="SQLite Database & System Diagnostics"
          >
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">DB</span>
          </button>

          <button
            id="btn_local_sqlite"
            onClick={onOpenDiagnostics}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-mono font-medium bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-700/80 transition shadow-sm"
            title="Goldcrest local SQLite storage"
          >
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline font-bold">SQLite</span>
          </button>
        </div>
      </div>

      {/* Primary Unified Navigation Bar (6 Core Areas) */}
      <nav id="terminal_nav_tabs" className="flex items-center space-x-1 px-4 border-t border-slate-800/80 bg-slate-950/50 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab_nav_${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-5 py-2.5 text-xs font-bold tracking-wide transition border-b-2 whitespace-nowrap ${
                isActive
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900/90'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700 hover:bg-slate-900/40'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
};
