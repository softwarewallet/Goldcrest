import React from 'react';
import {
  BarChart3, BookOpen, CandlestickChart, LayoutDashboard, ListChecks,
  Settings, Sparkles, TrendingUp
} from 'lucide-react';

interface GlobalAppShellProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  children: React.ReactNode;
  header: React.ReactNode;
}

const nav = [
  { id: 'forex_terminal', label: 'Forex Dashboard', icon: TrendingUp },
  { id: 'market', label: 'NSE Dashboard', icon: LayoutDashboard },
  { id: 'trading', label: 'Positions', icon: CandlestickChart },
  { id: 'control_center', label: 'Orders', icon: ListChecks },
  { id: 'signals', label: 'Strategy', icon: Sparkles },
  { id: 'research', label: 'Backtest', icon: BarChart3 },
  { id: 'pnl', label: 'Reports', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export const GlobalAppShell: React.FC<GlobalAppShellProps> = ({
  activeTab, setActiveTab, children, header
}) => (
  <div className="min-h-screen bg-[#05090d] text-slate-100">
    <aside id="global_fixed_sidebar" className="fixed inset-y-0 left-0 z-[60] w-[222px] border-r border-slate-800/80 bg-[#071019] flex flex-col">
      <div className="h-[126px] px-5 flex items-center gap-3 border-b border-slate-800/70 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <div className="font-bold text-white">Goldcrest Finman</div>
          <div className="text-[10px] text-slate-500">AI TRADING PLATFORM</div>
          <div className="text-[10px] text-emerald-400 font-bold mt-0.5">PRIVATE TERMINAL</div>
        </div>
      </div>
      <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
        {nav.map(item => {
          const Icon = item.icon;
          const selected = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition text-left ${
                selected ? 'bg-emerald-600/15 border border-emerald-500/40 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
              }`}>
              <Icon className={`w-4 h-4 ${selected ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="p-3 border-t border-slate-800/70 shrink-0">
        <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-600/80 flex items-center justify-center font-semibold">R</div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">Raajan P Sharrma</div>
            <div className="text-[11px] text-slate-500">Administrator</div>
          </div>
        </div>
      </div>
    </aside>

    {header}

    <div id="global_app_content" className="ml-[222px] min-h-screen pt-[126px] pb-9">
      {children}
    </div>

    <footer id="global_fixed_footer" className="fixed bottom-0 left-[222px] right-0 z-[55] h-9 border-t border-slate-800 bg-[#060b10] px-4 flex items-center justify-between text-[9px] font-mono text-slate-500">
      <div className="flex items-center gap-4">
        <span className="text-slate-400">GOLDCREST FINMAN</span>
        <span>PRIVATE LOCAL TERMINAL</span>
        <span className="text-emerald-500/80">SYSTEM ONLINE</span>
      </div>
      <div className="flex items-center gap-4">
        <span>cTrader • 5paisa</span>
        <span>AUTO-READINESS LOCKED</span>
      </div>
    </footer>
  </div>
);
