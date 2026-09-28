import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, RefreshCw, Search, Settings2 } from 'lucide-react';
import { Candle, ForexSessionState, TradingSignal } from '../markets/common/types';

interface TerminalDashboardProps {
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  forexSessions?: ForexSessionState;
  selectedBroker?: string;
  environment?: string;
  maskedAccount?: string;
  balance?: number;
  currency?: string;
  isEmergencyHalted?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onToggleKillSwitch?: () => void;
  candlesMap?: Record<string, Candle[]>;
  signals?: TradingSignal[];
  onSelectSignal?: (signal: TradingSignal) => void;
}

type Summary = {
  accounts: any[];
  positions: any[];
  openOrders: any[];
  orderHistory: any[];
  brokerSummaries?: any[];
};

const money = (value: number, currency = 'USD') =>
  Number.isFinite(value) ? new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-GB', {
    style: 'currency', currency, maximumFractionDigits: 2
  }).format(value) : '—';

const num = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const pct = (value: number | null | undefined) =>
  Number.isFinite(value as number) ? `${(value as number) >= 0 ? '+' : ''}${(value as number).toFixed(2)}%` : '—';

const pnlClass = (value: number | null | undefined) =>
  !Number.isFinite(value as number) ? 'text-slate-400' : (value as number) >= 0 ? 'text-emerald-400' : 'text-rose-400';

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  let prev = values[0];
  return values.map((value, index) => {
    if (index === 0) return prev;
    prev = value * k + prev * (1 - k);
    return prev;
  });
}

function Chart({ candles, show20, show50 }: { candles: Candle[]; show20: boolean; show50: boolean }) {
  if (candles.length < 2) return <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">Authoritative Forex candle data unavailable.</div>;
  const data = candles.slice(-180);
  const min = Math.min(...data.map(c => c.low));
  const max = Math.max(...data.map(c => c.high));
  const range = max - min || 1;
  const W = 1000, H = 360, step = W / data.length;
  const y = (value: number) => H - ((value - min) / range) * H;
  const closes = data.map(c => c.close);
  const line = (values: number[]) => values.map((value, index) => `${index * step + step / 2},${y(value)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {data.map((c, i) => {
        const x = i * step + step / 2, up = c.close >= c.open;
        const top = Math.min(y(c.open), y(c.close)), bottom = Math.max(y(c.open), y(c.close));
        return <g key={`${c.timestamp}-${i}`}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={up ? '#18c89b' : '#e55364'} strokeWidth="1.2"/><rect x={x-step*.28} y={top} width={Math.max(3,step*.56)} height={Math.max(2,bottom-top)} fill={up ? '#18c89b' : '#e55364'} rx="1"/></g>;
      })}
      {show20 && <polyline points={line(ema(closes, 20))} fill="none" stroke="#18c89b" strokeWidth="1.3" opacity=".8"/>}
      {show50 && <polyline points={line(ema(closes, 50))} fill="none" stroke="#4d78d8" strokeWidth="1.3" opacity=".8"/>}
    </svg>
  );
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({
  forexSessions, maskedAccount = '—', balance = 0, currency = 'USD',
  isEmergencyHalted = false, isRefreshing = false, onRefresh, candlesMap = {}, signals = []
}) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('EUR/USD');
  const [timeframe, setTimeframe] = useState('1h');
  const [show20, setShow20] = useState(true);
  const [show50, setShow50] = useState(true);
  const [search, setSearch] = useState('');
  const [candles, setCandles] = useState<Candle[]>(candlesMap[selectedSymbol] || []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summaryRes, candleRes] = await Promise.all([
          fetch('/api/brokers/dashboard-summary'),
          fetch(`/api/candles/${encodeURIComponent(selectedSymbol)}?tf=${encodeURIComponent(timeframe)}&limit=500`)
        ]);
        if (summaryRes.ok && !cancelled) setSummary(await summaryRes.json());
        if (candleRes.ok && !cancelled) {
          const data = await candleRes.json();
          if (Array.isArray(data) && data.length) setCandles(data);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, timeframe]);

  const pairs = useMemo(() => {
    const configured = Array.isArray(candlesMap) ? [] : Object.keys(candlesMap);
    return (configured.length ? configured : ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'NZD/USD'])
      .filter(symbol => !search || symbol.toUpperCase().includes(search.toUpperCase()));
  }, [candlesMap, search]);

  const forexAccount = summary?.accounts?.find(account => account?.broker === 'CTRADER');
  const brokerSummary = summary?.brokerSummaries?.find(item => item?.broker === 'CTRADER');
  const positions = (summary?.positions || []).filter(position => position?.broker === 'CTRADER' || position?.market === 'FOREX');
  const equity = Number(forexAccount?.equity ?? balance);
  const freeMargin = Number(forexAccount?.freeMargin ?? forexAccount?.availableMargin ?? 0);
  const dailyPnl = Number.isFinite(Number(brokerSummary?.dailyRealizedPnL)) ? Number(brokerSummary.dailyRealizedPnL) : null;
  const exposure = equity > 0 ? positions.reduce((total, position) => total + Math.abs(Number(position.quantity || 0) * Number(position.currentPrice || 0)), 0) / equity * 100 : null;
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const change = last && previous ? last.close - previous.close : null;
  const changePct = last && previous?.close ? change! / previous.close * 100 : null;

  return (
    <div className="w-full min-h-[calc(100vh-162px)] bg-[#020914] text-slate-100 p-3 md:p-4 space-y-3">
      {isEmergencyHalted && <div className="rounded-lg border border-rose-700 bg-rose-950/80 px-4 py-2 text-xs font-mono text-rose-200">TRADING HALTED — emergency stop is active; new orders are blocked.</div>}
      <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <Kpi label="Live P&L" value={dailyPnl == null ? '—' : money(dailyPnl, forexAccount?.currency || currency)} sub="cTrader realized P&L" tone={pnlClass(dailyPnl)} />
        <Kpi label="Total Trades" value={brokerSummary?.orderHistory ? String(brokerSummary.orderHistory.length) : '—'} sub="cTrader broker history" />
        <Kpi label="Account Balance" value={money(Number(forexAccount?.balance ?? balance), forexAccount?.currency || currency)} sub={`Free margin: ${money(freeMargin, forexAccount?.currency || currency)}`} />
        <Kpi label="Open Positions" value={String(positions.length)} sub="cTrader live positions" />
        <Kpi label="Exposure" value={exposure == null ? '—' : `${exposure.toFixed(1)}%`} sub="Current account exposure" />
        <Kpi label="Session" value={forexSessions?.isOpen ? 'OPEN' : 'CLOSED'} sub="Forex market session" />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
        <div className="rounded-xl border border-slate-800 bg-[#04121f] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">{selectedSymbol} · {timeframe.toUpperCase()} · FOREX</div>
              <div className="text-[11px] font-mono mt-1">{last ? <>O <b>{num(last.open)}</b> H <b>{num(last.high)}</b> L <b>{num(last.low)}</b> C <b className="text-emerald-400">{num(last.close)}</b> <span className={pnlClass(change)}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${num(change)} (${pct(changePct)})`}</span></> : <span className="text-slate-500">Authoritative candle feed unavailable</span>}</div>
            </div>
            <div className="flex items-center gap-2">
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs"><option value="1h">1H</option><option value="15m">15M</option><option value="4h">4H</option><option value="1d">1D</option></select>
              <button onClick={() => setShow20(v => !v)} className="px-2 py-1.5 rounded border border-slate-700 text-[11px]">EMA20</button>
              <button onClick={() => setShow50(v => !v)} className="px-2 py-1.5 rounded border border-slate-700 text-[11px]">EMA50</button>
              <button onClick={onRefresh} className="p-1.5 rounded border border-slate-700"><RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`}/></button>
            </div>
          </div>
          <div className="h-[410px] p-2"><Chart candles={candles} show20={show20} show50={show50}/></div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-[#04121f] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between"><h3 className="font-semibold">Forex Watchlist</h3><span className="text-[10px] text-slate-500">cTrader</span></div>
            <div className="px-3 py-2"><div className="relative"><Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-slate-600"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pair" className="w-full bg-slate-950 border border-slate-800 rounded px-7 py-1.5 text-xs outline-none"/></div></div>
            {pairs.map(pair => <button key={pair} onClick={() => setSelectedSymbol(pair)} className={`w-full text-left px-4 py-2.5 border-t border-slate-800/70 text-xs font-semibold ${selectedSymbol === pair ? 'bg-blue-950/40 text-white' : 'hover:bg-slate-900/60'}`}>{pair}</button>)}
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#04121f] p-4">
            <div className="flex items-center justify-between mb-4"><h3 className="font-semibold">Risk Overview</h3><Settings2 className="w-4 h-4 text-slate-500"/></div>
            <RiskRow label="Open Positions" value={String(positions.length)} />
            <RiskRow label="Account Exposure" value={exposure == null ? '—' : `${exposure.toFixed(1)}%`} />
            <RiskRow label="Free Margin" value={money(freeMargin, forexAccount?.currency || currency)} />
            <RiskRow label="Account" value={maskedAccount} />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between text-[10px] text-slate-600 font-mono px-1">
        <span>cTrader • LIVE Forex market data • {forexSessions?.isOpen ? 'OPEN' : 'CLOSED'}</span>
        <span>{signals.length} signals</span>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; sub: string; tone?: string }> = ({ label, value, sub, tone = 'text-white' }) => (
  <div className="rounded-xl border border-slate-800 bg-[#04121f] px-4 py-3 min-h-[88px]">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div className={`text-xl font-semibold mt-1 ${tone}`}>{value}</div>
    <div className="text-[10px] text-slate-600 mt-1 truncate">{sub}</div>
  </div>
);

const RiskRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-slate-800/70 pb-2 mb-2 text-xs">
    <span className="text-slate-400">{label}</span><b className="text-slate-200">{value}</b>
  </div>
);
