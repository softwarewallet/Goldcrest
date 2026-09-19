import React, { useMemo } from 'react';
import {
  Activity,
  Bell,
  BarChart3,
  BookOpen,
  CandlestickChart,
  ChevronDown,
  CircleDollarSign,
  Database,
  Gauge,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import { Candle, IndianSessionState, ForexSessionState, TradingSignal } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';

interface TerminalDashboardProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  forexSessions: ForexSessionState;
  indianSession: IndianSessionState;
  selectedBroker: BrokerType;
  environment: TradingEnvironment;
  maskedAccount: string;
  balance: number;
  currency: string;
  isEmergencyHalted: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onToggleKillSwitch: () => void;
  candlesMap: Record<string, Candle[]>;
  indianUnderlyings: any[];
  signals: TradingSignal[];
  onSelectSignal: (signal: TradingSignal) => void;
}

const fmtMoney = (value: number, currency: string) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
      }).format(value)
    : '—';

const fmtNumber = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: digits }) : '—';

const changeColor = (value: number) => value >= 0 ? 'text-emerald-400' : 'text-rose-400';

function MiniSparkline({ values, negative = false }: { values: number[]; negative?: boolean }) {
  if (!values.length) return <div className="h-7" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 100;
    const y = 26 - ((v - min) / range) * 22;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 30" className={`w-full h-7 ${negative ? 'text-rose-400' : 'text-emerald-400'}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MarketChart({ candles }: { candles: Candle[] }) {
  const data = useMemo(() => candles.slice(-55), [candles]);
  if (data.length < 2) {
    return (
      <div className="h-full min-h-[320px] flex items-center justify-center text-xs text-slate-500 font-mono">
        Waiting for NIFTY market data…
      </div>
    );
  }

  const min = Math.min(...data.map(c => c.low));
  const max = Math.max(...data.map(c => c.high));
  const range = max - min || 1;
  const width = 1000;
  const height = 340;
  const step = width / data.length;
  const y = (v: number) => height - ((v - min) / range) * height;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      {[0, 1, 2, 3, 4].map(i => {
        const yy = (height / 4) * i;
        const value = max - (range / 4) * i;
        return (
          <g key={i}>
            <line x1="0" y1={yy} x2={width} y2={yy} stroke="currentColor" className="text-slate-800/80" strokeWidth="1" />
            <text x={width - 4} y={yy + 4} textAnchor="end" className="fill-slate-500 text-[12px]">{Math.round(value).toLocaleString()}</text>
          </g>
        );
      })}
      {data.map((c, i) => {
        const x = i * step + step / 2;
        const bullish = c.close >= c.open;
        const bodyTop = Math.min(y(c.open), y(c.close));
        const bodyBottom = Math.max(y(c.open), y(c.close));
        const bodyHeight = Math.max(2, bodyBottom - bodyTop);
        return (
          <g key={`${c.timestamp}-${i}`}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={bullish ? '#10b981' : '#ef4444'} strokeWidth="1.2" />
            <rect x={x - Math.max(2, step * 0.28)} y={bodyTop} width={Math.max(4, step * 0.56)} height={bodyHeight} rx="1" fill={bullish ? '#10b981' : '#ef4444'} />
          </g>
        );
      })}
    </svg>
  );
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({
  activeTab,
  setActiveTab,
  forexSessions,
  indianSession,
  selectedBroker,
  environment,
  maskedAccount,
  balance,
  currency,
  isEmergencyHalted,
  isRefreshing,
  onRefresh,
  onToggleKillSwitch,
  candlesMap,
  indianUnderlyings,
  signals,
  onSelectSignal
}) => {
  const indices = useMemo(() => {
    const fallback = [
      { symbol: 'NIFTY 50', spot: null, change: null, changePercent: null },
      { symbol: 'BANKNIFTY', spot: null, change: null, changePercent: null },
      { symbol: 'SENSEX', spot: null, change: null, changePercent: null },
      { symbol: 'FINNIFTY', spot: null, change: null, changePercent: null },
      { symbol: 'NIFTY IT', spot: null, change: null, changePercent: null },
      { symbol: 'MIDCPNIFTY', spot: null, change: null, changePercent: null }
    ];
    return fallback.map(item => {
      const symbol = item.symbol.replace(' 50', '');
      const live = indianUnderlyings.find((u: any) => u.symbol === symbol);
      return live ? {
        symbol: item.symbol,
        spot: Number(live.spot),
        change: Number(live.change),
        changePercent: Number(live.changePercent)
      } : item;
    });
  }, [indianUnderlyings]);

  const selectedIndex = indianUnderlyings.find((u: any) => u.symbol === 'NIFTY') || null;
  const candles = candlesMap.NIFTY || [];
  const last = candles[candles.length - 1];
  const first = candles[0];
  const chartChange = last && first ? last.close - first.open : 0;
  const chartChangePct = first?.open ? (chartChange / first.open) * 100 : 0;

  const strategies = useMemo(() => {
    const names = Array.from(new Set(signals.map(s => s.strategy).filter(Boolean)));
    const active = signals.filter(s => s.status === 'ACTIVE' || s.status === 'ENTRY_TRIGGERED').length;
    const stopped = signals.filter(s => s.status === 'STOPPED').length;
    return { total: names.length, active, stopped, running: Math.max(0, active - stopped) };
  }, [signals]);

  const recentSignals = signals.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);

  const nav = [
    { id: 'market', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'indian', label: 'Market Watch', icon: LineChart },
    { id: 'trading', label: 'Positions', icon: CandlestickChart },
    { id: 'control_center', label: 'Orders', icon: ListChecks },
    { id: 'signals', label: 'Strategy', icon: Sparkles },
    { id: 'research', label: 'Backtest', icon: BarChart3 },
    { id: 'pnl', label: 'Reports', icon: BookOpen },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  const sessionLabel = forexSessions.activeSessions.length
    ? forexSessions.activeSessions.join(' / ')
    : 'CLOSED (WEEKEND)';

  return (
    <div className="min-h-screen bg-[#020914] text-slate-100 flex overflow-hidden">
      <aside className="hidden lg:flex w-[222px] shrink-0 border-r border-slate-800/80 bg-[#03101d] flex-col">
        <div className="h-[88px] px-5 flex items-center gap-3 border-b border-slate-800/70">
          <div className="w-10 h-10 rounded-xl border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="font-bold text-white leading-tight">Goldcrest Finman</div>
            <div className="text-[10px] text-slate-500">AI Trading Platform</div>
            <div className="text-[10px] text-emerald-400 font-bold mt-0.5">PRODUCTION TERMINAL</div>
          </div>
        </div>

        <nav className="p-3 space-y-1 flex-1">
          {nav.map(item => {
            const Icon = item.icon;
            const selected = activeTab === item.id || (item.id === 'indian' && activeTab === 'market');
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                  selected
                    ? 'bg-blue-600/25 border border-blue-500/50 text-white shadow-[0_0_18px_rgba(37,99,235,0.12)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${selected ? 'text-blue-400' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800/70">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-600/80 flex items-center justify-center font-semibold">R</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">Raajan P Sharrma</div>
              <div className="text-[11px] text-slate-500">Administrator</div>
            </div>
          </div>
          <button className="mt-2 text-xs text-slate-500 hover:text-slate-200 flex items-center gap-2 px-2">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-8 border-b border-slate-800/80 bg-[#020711] px-4 flex items-center justify-between text-[10px] font-mono overflow-hidden">
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span>ACTIVE AREA: <b className="text-white">MARKET</b></span>
            <span className="text-slate-700">|</span>
            <span>BROKERS: <b className="text-slate-200">cTrader + 5paisa</b></span>
            <span className="text-slate-700">|</span>
            <span>ENVIRONMENT: <b className="text-rose-400">LIVE</b></span>
            <span className="text-slate-700">|</span>
            <span>EXECUTION: <b className="text-amber-400">AUTO-READINESS (LOCKED)</b></span>
            <span className="text-slate-700">|</span>
            <span>DATA: <b className="text-emerald-400">FRESH (LIVE)</b></span>
            <span className="text-slate-700">|</span>
            <span className="text-emerald-400">● CLOCK: 1s REALTIME</span>
          </div>
          <div className="hidden xl:flex items-center gap-1 rounded border border-rose-700 bg-rose-950/50 px-2 py-1 text-rose-300 font-bold">
            <ShieldCheck className="w-3 h-3" /> LIVE ACCOUNT ({maskedAccount})
          </div>
        </div>

        <header className="border-b border-slate-800/80 bg-[#04111e] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="lg:hidden">
              <button className="p-2 rounded bg-slate-900 border border-slate-800"><Menu className="w-4 h-4" /></button>
            </div>
            <div className="lg:hidden font-bold">Goldcrest Finman</div>

            <BrokerCard label="cTrader" market="FOREX" active={selectedBroker === 'CTRADER'} value={selectedBroker === 'CTRADER' ? fmtMoney(balance, currency) : '—'} />
            <BrokerCard label="5paisa" market="INDIAN MARKETS" active={selectedBroker === 'FIVE_PAISA'} value={selectedBroker === 'FIVE_PAISA' ? fmtMoney(balance, currency) : '—'} />

            <div className="flex flex-col gap-1 ml-auto">
              <div className="text-[10px] text-slate-400 border border-slate-800 bg-slate-950/60 rounded px-3 py-1">
                <b className="text-slate-300">FX:</b> <span className={sessionLabel.includes('CLOSED') ? 'text-slate-400' : 'text-emerald-400'}>● {sessionLabel}</span>
              </div>
              <div className="text-[10px] text-slate-400 border border-slate-800 bg-slate-950/60 rounded px-3 py-1">
                <b className="text-slate-300">NSE:</b> <span className={indianSession.isOpen ? 'text-emerald-400' : 'text-amber-400'}>● {indianSession.istTime} ({indianSession.currentPhase})</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={onRefresh} disabled={isRefreshing} title="Refresh" className="p-2.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800">
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-300'}`} />
              </button>
              <button title="Diagnostics" className="p-2.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800">
                <Database className="w-4 h-4 text-cyan-400" />
              </button>
              <button
                onClick={onToggleKillSwitch}
                title={isEmergencyHalted ? 'Resume trading' : 'Emergency stop'}
                className={`p-2.5 rounded-lg border ${isEmergencyHalted ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-900 border-rose-900 text-rose-300 hover:bg-rose-950'}`}
              >
                <ShieldCheck className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-3 md:p-4 space-y-3">
          {isEmergencyHalted && (
            <div className="rounded-lg border border-rose-700 bg-rose-950/70 text-rose-200 px-4 py-2 text-xs font-mono">
              TRADING HALTED — emergency stop is active; new orders are blocked
            </div>
          )}

          <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
            <KpiCard label="Total P&L" value="—" sub="Live execution ledger" icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard label="Win Rate" value="—" sub="Awaiting execution history" />
            <KpiCard label="Total Trades" value="—" sub="Execution ledger" bars />
            <KpiCard label="Profit Factor" value="—" sub="Not calculated" spark />
            <KpiCard label="Max Drawdown" value="—" sub="Risk ledger" negative spark />
            <KpiCard label="Account Balance" value={fmtMoney(balance, currency)} sub={`A/C ${maskedAccount}`} />
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3">
            <div className="rounded-xl border border-slate-800 bg-[#04121f] overflow-hidden min-h-[430px]">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">NIFTY 50 · 1D · NSE</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="text-[11px] font-mono mt-1">
                    O <b>{last ? fmtNumber(last.open, 2) : '—'}</b>&nbsp;&nbsp;
                    H <b>{last ? fmtNumber(last.high, 2) : '—'}</b>&nbsp;&nbsp;
                    L <b>{last ? fmtNumber(last.low, 2) : '—'}</b>&nbsp;&nbsp;
                    C <b className="text-emerald-400">{last ? fmtNumber(last.close, 2) : '—'}</b>&nbsp;&nbsp;
                    <span className={changeColor(chartChange)}>{last ? `${chartChange >= 0 ? '+' : ''}${fmtNumber(chartChange, 2)} (${chartChangePct >= 0 ? '+' : ''}${fmtNumber(chartChangePct, 2)}%)` : 'Awaiting live data'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs flex items-center gap-2"><SlidersHorizontal className="w-3.5 h-3.5" /> Indicators <ChevronDown className="w-3 h-3" /></button>
                  <button className="p-1.5 rounded hover:bg-slate-900"><Search className="w-4 h-4 text-slate-400" /></button>
                </div>
              </div>
              <div className="h-[335px] px-2 py-2">
                <MarketChart candles={candles} />
              </div>
              <div className="border-t border-slate-800 px-3 py-2 flex items-center gap-1 text-xs">
                {['1D', '1W', '1M', '3M', '6M', '1Y', 'All'].map((tf, i) => (
                  <button key={tf} className={`px-3 py-1 rounded ${i === 0 ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-200'}`}>{tf}</button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-slate-800 bg-[#04121f]">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="font-semibold">Watchlist</h3>
                  <span className="text-slate-400">＋</span>
                </div>
                <div className="divide-y divide-slate-800/70">
                  {indices.map(item => (
                    <div key={item.symbol} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <div className="font-semibold text-slate-200">{item.symbol}</div>
                      <div className="text-right font-mono">
                        <div className="text-slate-200">{item.spot === null ? '—' : fmtNumber(item.spot, 2)}</div>
                        <div className={item.change !== null ? changeColor(item.change) : 'text-slate-600'}>{item.change === null ? 'Awaiting feed' : `${item.change >= 0 ? '+' : ''}${fmtNumber(item.change, 2)}  ${item.changePercent >= 0 ? '+' : ''}${fmtNumber(item.changePercent, 2)}%`}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Strategy Status</h3>
                  <Gauge className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-full border-[10px] border-blue-600/70 relative flex items-center justify-center">
                    <div className="text-center"><div className="text-lg font-bold">{strategies.total}</div><div className="text-[9px] text-slate-500">STRATEGIES</div></div>
                  </div>
                  <div className="text-xs space-y-2">
                    <div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 mt-1" /> Active <b>{strategies.active}</b></div>
                    <div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 mt-1" /> Running <b>{strategies.running}</b></div>
                    <div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-rose-500 mt-1" /> Stopped <b>{strategies.stopped}</b></div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Trade Performance</h3>
                <span className="text-[10px] text-slate-500 border border-slate-800 rounded px-2 py-1">This Month</span>
              </div>
              <div className="h-32 flex items-center justify-center text-xs text-slate-600 font-mono">Execution performance will populate from the live ledger</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Recent Signals</h3>
                <button onClick={() => setActiveTab('signals')} className="text-[10px] text-blue-400 hover:text-blue-300">View all</button>
              </div>
              <div className="space-y-2">
                {recentSignals.length ? recentSignals.map(signal => (
                  <button key={signal.id} onClick={() => onSelectSignal(signal)} className="w-full text-left grid grid-cols-[1fr_50px_70px] gap-2 text-xs border-b border-slate-800/70 pb-2 hover:bg-slate-900/50 rounded px-1">
                    <span className="font-semibold">{signal.instrument}</span>
                    <span className={signal.direction === 'SELL' ? 'text-rose-400' : 'text-emerald-400'}>{signal.direction}</span>
                    <span className="text-right text-emerald-400">{signal.score}/100</span>
                  </button>
                )) : <div className="text-xs text-slate-600 font-mono">No recent signals</div>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Risk Overview</h3>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="space-y-3 text-xs">
                <RiskRow label="Max Drawdown" value="—" negative />
                <RiskRow label="Daily Loss Limit" value="3.00%" negative />
                <RiskRow label="Risk Per Trade" value="1.00%" />
                <RiskRow label="Account Exposure" value="—" progress={0} />
              </div>
            </div>
          </section>
        </main>

        <footer className="h-8 shrink-0 border-t border-slate-800 bg-[#020711] px-4 flex items-center gap-8 overflow-hidden text-[11px] font-mono">
          {indices.slice(0, 4).map(item => (
            <div key={item.symbol} className="whitespace-nowrap">
              <span className="text-slate-300">{item.symbol}</span>&nbsp;&nbsp;
              <b className="text-slate-100">{item.spot === null ? '—' : fmtNumber(item.spot, 2)}</b>&nbsp;
              <span className={item.change !== null ? changeColor(item.change) : 'text-slate-600'}>
                {item.changePercent === null ? 'Awaiting' : `${item.changePercent >= 0 ? '▲' : '▼'} ${Math.abs(item.changePercent).toFixed(2)}%`}
              </span>
            </div>
          ))}
          <div className="ml-auto text-emerald-400">● {indianSession.isOpen ? 'Market is Open' : 'Market is Closed'}</div>
        </footer>
      </div>
    </div>
  );
};

const BrokerCard = ({ label, market, active, value }: { label: string; market: string; active: boolean; value: string }) => (
  <div className="min-w-[190px] rounded-xl border border-slate-800 bg-[#020b15] px-3 py-2">
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-amber-400' : 'bg-slate-600'}`} />
      <span>{label}</span>
      <span className="text-[8px] bg-slate-800 text-slate-500 rounded px-1.5 py-0.5">{market}</span>
    </div>
    <div className="mt-2 text-lg font-bold">{value}</div>
    <div className="text-[10px] text-slate-500 mt-1">{active ? 'LIVE ACCOUNT SELECTED' : 'Account data unavailable'}</div>
  </div>
);

const KpiCard = ({ label, value, sub, icon, negative, bars, spark }: { label: string; value: string; sub: string; icon?: React.ReactNode; negative?: boolean; bars?: boolean; spark?: boolean }) => (
  <div className="rounded-xl border border-slate-800 bg-[#04121f] px-3 py-3 min-h-[96px]">
    <div className="flex items-center justify-between text-[11px] text-slate-500">
      <span>{label}</span>{icon || (negative ? <TrendingDown className="w-3.5 h-3.5 text-rose-400" /> : null)}
    </div>
    <div className={`text-xl font-bold mt-1 ${negative ? 'text-rose-400' : 'text-slate-100'}`}>{value}</div>
    <div className="text-[10px] text-slate-600 mt-1">{sub}</div>
    {bars && <div className="mt-1 h-5 flex items-end gap-0.5">{Array.from({ length: 24 }).map((_, i) => <span key={i} className="w-1 bg-emerald-500/70 rounded-t" style={{ height: `${5 + ((i * 17) % 17)}px` }} />)}</div>}
    {spark && <MiniSparkline values={[2,3,2.5,3.2,2.7,3.5,3.1,3.8,3.4]} negative={negative} />}
  </div>
);

const RiskRow = ({ label, value, negative, progress }: { label: string; value: string; negative?: boolean; progress?: number }) => (
  <div>
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <b className={negative ? 'text-rose-400' : 'text-emerald-400'}>{value}</b>
    </div>
    {progress !== undefined && (
      <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
    )}
  </div>
);
