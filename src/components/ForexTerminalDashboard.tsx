import React, { useMemo, useState } from 'react';
import {
  BarChart3, Bell, BookOpen, CandlestickChart, ChevronDown, Database, Gauge,
  LayoutDashboard, ListChecks, Menu, RefreshCw, Search, Settings, ShieldAlert,
  SlidersHorizontal, Sparkles, TrendingDown, TrendingUp, Wallet
} from 'lucide-react';
import { Candle, ForexSessionState, TradingSignal } from '../markets/common/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';

interface ForexTerminalDashboardProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  forexSessions: ForexSessionState;
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
  forexPairs: any[];
  signals: TradingSignal[];
  onSelectSignal: (signal: TradingSignal) => void;
}

const money = (v: number, c = 'USD') =>
  Number.isFinite(v)
    ? new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(v)
    : '—';

const num = (v: number, digits = 5) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const pct = (v: number) => Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';

function FxChart({ candles }: { candles: Candle[] }) {
  const data = candles.slice(-65);
  if (data.length < 2) return <div className="h-full flex items-center justify-center text-xs text-slate-600 font-mono">Waiting for cTrader FX candles…</div>;
  const min = Math.min(...data.map(c => c.low));
  const max = Math.max(...data.map(c => c.high));
  const range = max - min || 0.0001;
  const W = 1000, H = 390, step = W / data.length;
  const y = (v: number) => H - ((v - min) / range) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {[0,1,2,3,4,5].map(i => {
        const yy = (H / 5) * i;
        return <line key={i} x1="0" x2={W} y1={yy} y2={yy} stroke="currentColor" className="text-slate-800/80" />;
      })}
      {data.map((c, i) => {
        const x = i * step + step / 2;
        const up = c.close >= c.open;
        const top = Math.min(y(c.open), y(c.close));
        const bottom = Math.max(y(c.open), y(c.close));
        return (
          <g key={`${c.timestamp}-${i}`}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={up ? '#18c89b' : '#d95568'} strokeWidth="1.2" />
            <rect x={x - Math.max(2, step * .28)} y={top} width={Math.max(4, step * .56)} height={Math.max(2, bottom-top)} fill={up ? '#18c89b' : '#d95568'} rx="1" />
          </g>
        );
      })}
      <text x={W-4} y="16" textAnchor="end" className="fill-slate-500 text-[12px]">{max.toFixed(5)}</text>
      <text x={W-4} y={H-6} textAnchor="end" className="fill-slate-500 text-[12px]">{min.toFixed(5)}</text>
    </svg>
  );
}

export const ForexTerminalDashboard: React.FC<ForexTerminalDashboardProps> = ({
  activeTab, setActiveTab, forexSessions, selectedBroker, environment, maskedAccount,
  balance, currency, isEmergencyHalted, isRefreshing, onRefresh, onToggleKillSwitch,
  candlesMap, forexPairs, signals, onSelectSignal
}) => {
  const [selectedPair, setSelectedPair] = useState('EUR/USD');
  const [orderSide, setOrderSide] = useState<'BUY'|'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT'|'MARKET'|'STOP'>('LIMIT');

  const pair = forexPairs.find(p => p.symbol === selectedPair) || forexPairs[0];
  const candles = candlesMap[selectedPair] || candlesMap['EUR/USD'] || [];
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const change = last && previous?.close ? ((last.close - previous.close) / previous.close) * 100 : 0;
  const selectedPrice = Number(pair?.currentPrice ?? pair?.bid ?? last?.close);
  const spread = Number(pair?.spreadPips ?? pair?.typicalSpreadPips ?? 0);
  const relatedSignals = signals.filter(s => s.market === 'FOREX').slice().sort((a,b) => b.timestamp-a.timestamp).slice(0,4);

  const watchPairs = useMemo(() => {
    const defaults = ['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP'];
    return defaults.map(symbol => forexPairs.find(p => p.symbol === symbol) || { symbol });
  }, [forexPairs]);

  const activeSessions = forexSessions.activeSessions.filter(Boolean);
  const sessionText = activeSessions.length ? activeSessions.join(' / ') : 'CLOSED';

  const nav = [
    { id:'market', label:'NSE Dashboard', icon:LayoutDashboard },
    { id:'forex_terminal', label:'Forex Dashboard', icon:TrendingUp },
    { id:'trading', label:'Positions', icon:CandlestickChart },
    { id:'control_center', label:'Orders', icon:ListChecks },
    { id:'signals', label:'Strategy', icon:Sparkles },
    { id:'research', label:'Backtest', icon:BarChart3 },
    { id:'pnl', label:'Reports', icon:BookOpen },
    { id:'settings', label:'Settings', icon:Settings }
  ];

  return (
    <div className="min-h-screen bg-[#05090d] text-slate-100 flex overflow-hidden font-sans">
      <aside className="hidden xl:flex w-[220px] shrink-0 border-r border-slate-800/80 bg-[#080d12] flex-col">
        <div className="h-[82px] px-5 flex items-center gap-3 border-b border-slate-800/70">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-emerald-400"/>
          </div>
          <div><div className="font-bold">Goldcrest Finman</div><div className="text-[10px] text-slate-500">FOREX TERMINAL</div></div>
        </div>
        <nav className="p-3 space-y-1 flex-1">
          {nav.map(n => { const I=n.icon; return <button key={n.id} onClick={()=>setActiveTab(n.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${activeTab===n.id?'bg-emerald-600/15 border border-emerald-500/40 text-white':'text-slate-400 hover:bg-slate-900 hover:text-white'}`}><I className={`w-4 h-4 ${activeTab===n.id?'text-emerald-400':'text-slate-500'}`}/>{n.label}</button>; })}
        </nav>
        <div className="p-3 border-t border-slate-800/70 text-xs text-slate-500">cTrader • FX Spot / CFD</div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-8 border-b border-slate-800 bg-[#070b10] px-4 flex items-center gap-4 text-[10px] font-mono overflow-hidden whitespace-nowrap">
          <span>MARKET: <b className="text-white">FOREX</b></span><span className="text-slate-700">|</span>
          <span>BROKER: <b className="text-slate-200">cTrader</b></span><span className="text-slate-700">|</span>
          <span>ENV: <b className="text-rose-400">LIVE</b></span><span className="text-slate-700">|</span>
          <span>EXECUTION: <b className="text-amber-400">AUTO-READINESS (LOCKED)</b></span><span className="text-slate-700">|</span>
          <span>FX SESSION: <b className="text-emerald-400">● {sessionText}</b></span>
          <span className="ml-auto text-slate-500">ACCOUNT: <b className="text-slate-300">{maskedAccount}</b></span>
        </div>

        <header className="h-[76px] border-b border-slate-800 bg-[#080d12] px-4 flex items-center gap-5">
          <div className="flex items-center gap-3 min-w-[260px]">
            <div className="w-9 h-9 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center"><span className="text-blue-300 font-bold">FX</span></div>
            <div><div className="text-lg font-semibold">{selectedPair}</div><div className="text-[10px] text-slate-500">FOREX • SPOT</div></div>
          </div>
          <div><div className="text-[10px] text-slate-500">Price</div><div className="font-semibold text-emerald-400">{num(selectedPrice, 5)}</div></div>
          <div><div className="text-[10px] text-slate-500">Change</div><div className={`font-semibold ${change>=0?'text-emerald-400':'text-rose-400'}`}>{pct(change)}</div></div>
          <div className="hidden lg:block border-l border-slate-800 pl-5"><div className="text-[10px] text-slate-500">Spread</div><div className="font-semibold text-slate-200">{spread ? `${spread} pips` : '—'}</div></div>
          <div className="hidden lg:block border-l border-slate-800 pl-5"><div className="text-[10px] text-slate-500">24h High</div><div className="font-semibold text-slate-200">{num(Number(pair?.high24h),5)}</div></div>
          <div className="hidden lg:block"><div className="text-[10px] text-slate-500">24h Low</div><div className="font-semibold text-slate-200">{num(Number(pair?.low24h),5)}</div></div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onRefresh} className="p-2 rounded-lg border border-slate-700 bg-slate-900"><RefreshCw className={`w-4 h-4 ${isRefreshing?'animate-spin text-emerald-400':''}`}/></button>
            <button onClick={onToggleKillSwitch} className={`p-2 rounded-lg border ${isEmergencyHalted?'bg-rose-600 border-rose-500':'bg-rose-950/30 border-rose-900 text-rose-300'}`}><ShieldAlert className="w-4 h-4"/></button>
          </div>
        </header>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-[220px_minmax(0,1fr)_250px_235px] min-h-[560px] border-b border-slate-800">
            <section className="border-r border-slate-800 bg-[#070b10] overflow-auto">
              <div className="p-3 border-b border-slate-800 flex items-center gap-2"><Search className="w-3.5 h-3.5 text-slate-500"/><input className="bg-transparent outline-none text-xs w-full" placeholder="Search pair"/></div>
              <div className="flex gap-2 px-3 py-2 text-[9px] font-mono text-slate-500 uppercase border-b border-slate-800"><span className="text-emerald-400">Majors</span><span>Minors</span><span>Exotics</span></div>
              <div className="px-3 py-2 text-[9px] text-slate-600 uppercase">Pair / Bid / Change</div>
              {watchPairs.map((p:any)=>{
                const px=Number(p.currentPrice ?? p.bid);
                const up=Number(p.changePercent ?? p.change ?? 0)>=0;
                return <button key={p.symbol} onClick={()=>setSelectedPair(p.symbol)} className={`w-full px-3 py-2.5 border-b border-slate-800/70 text-left hover:bg-slate-900 ${selectedPair===p.symbol?'bg-slate-900 border-l-2 border-emerald-400':''}`}>
                  <div className="flex justify-between"><span className="text-xs font-semibold">{p.symbol}</span><span className={`text-[10px] ${up?'text-emerald-400':'text-rose-400'}`}>{Number.isFinite(Number(p.changePercent))?pct(Number(p.changePercent)):'—'}</span></div>
                  <div className="flex justify-between mt-1 text-[10px] font-mono"><span className="text-slate-300">{num(px,5)}</span><span className="text-slate-600">Spread {Number(p.spreadPips||0)||'—'}</span></div>
                </button>
              })}
            </section>

            <section className="bg-[#080d12] min-w-0 flex flex-col border-r border-slate-800">
              <div className="h-11 border-b border-slate-800 px-3 flex items-center justify-between">
                <div className="flex items-center gap-1 text-[10px]"><button className="px-3 py-1.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-800">CHART</button><button className="px-3 py-1.5 text-slate-500">Info</button><button className="px-3 py-1.5 text-slate-500">Trading Rules</button><button className="px-3 py-1.5 text-slate-500">Risk Limit</button></div>
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500"/>
              </div>
              <div className="h-10 border-b border-slate-800 px-3 flex items-center gap-1 text-[10px] font-mono">
                {['1M','5M','15M','30M','1H','4H','1D'].map((tf,i)=><button key={tf} className={`px-2.5 py-1 rounded ${i===2?'bg-slate-700 text-white':'text-slate-500 hover:text-slate-200'}`}>{tf}</button>)}
                <span className="ml-auto text-slate-500">Last price <span className="text-emerald-400">{num(selectedPrice,5)}</span></span>
              </div>
              <div className="flex-1 min-h-[390px] p-2"><FxChart candles={candles}/></div>
              <div className="h-8 border-t border-slate-800 px-3 flex items-center justify-between text-[9px] font-mono text-slate-500"><span>cTrader live feed</span><span>Auto-refresh 15s</span></div>
            </section>

            <section className="border-r border-slate-800 bg-[#070b10] flex flex-col">
              <div className="h-11 border-b border-slate-800 px-3 flex items-center gap-2 text-[10px]"><button className="px-3 py-1.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-800">Order Book</button><span className="text-slate-600">Market Trades</span></div>
              <div className="grid grid-cols-3 px-3 py-2 text-[9px] text-slate-500 border-b border-slate-800"><span>Bid</span><span className="text-center">Price</span><span className="text-right">Ask</span></div>
              <div className="flex-1 flex flex-col justify-center px-3 text-center">
                <Database className="w-5 h-5 mx-auto text-slate-700 mb-2"/><div className="text-[10px] text-slate-600">Level-II order book is broker-dependent.</div><div className="text-[9px] text-slate-700 mt-1">No synthetic depth displayed.</div>
              </div>
              <div className="border-t border-slate-800 p-3">
                <div className="text-[9px] text-slate-500 mb-2">SIGNALS</div>
                {relatedSignals.map(s=><button key={s.id} onClick={()=>onSelectSignal(s)} className="w-full text-left py-1.5 border-b border-slate-800/70 flex justify-between text-[10px]"><span>{s.instrument}</span><span className={s.direction==='SELL'?'text-rose-400':'text-emerald-400'}>{s.direction}</span></button>)}
                {!relatedSignals.length && <div className="text-[9px] text-slate-700">No active FX signals.</div>}
              </div>
            </section>

            <section className="bg-[#080d12] flex flex-col">
              <div className="h-11 border-b border-slate-800 px-3 flex items-center justify-between"><span className="text-sm font-semibold">Spot</span><span className="text-slate-500">•••</span></div>
              <div className="grid grid-cols-2 p-1 m-3 rounded-lg bg-slate-950 border border-slate-800"><button onClick={()=>setOrderSide('BUY')} className={`py-2 rounded-md text-xs ${orderSide==='BUY'?'bg-emerald-900/70 text-emerald-300':'text-slate-500'}`}>Buy</button><button onClick={()=>setOrderSide('SELL')} className={`py-2 rounded-md text-xs ${orderSide==='SELL'?'bg-rose-900/70 text-rose-300':'text-slate-500'}`}>Sell</button></div>
              <div className="px-3 flex gap-1 text-[9px]"><button onClick={()=>setOrderType('LIMIT')} className={`px-3 py-1 rounded ${orderType==='LIMIT'?'bg-emerald-900/50 text-emerald-300':'text-slate-500'}`}>Limit</button><button onClick={()=>setOrderType('MARKET')} className={`px-3 py-1 rounded ${orderType==='MARKET'?'bg-emerald-900/50 text-emerald-300':'text-slate-500'}`}>Market</button><button onClick={()=>setOrderType('STOP')} className={`px-3 py-1 rounded ${orderType==='STOP'?'bg-emerald-900/50 text-emerald-300':'text-slate-500'}`}>Stop</button></div>
              <div className="p-3 space-y-3 text-xs">
                <Field label="Price" value={num(selectedPrice,5)}/>
                <Field label="Amount" value="—"/>
                <div className="h-1 rounded bg-slate-800"><div className="h-full w-0 bg-emerald-500 rounded"/></div>
                <Field label="Total" value="—"/>
              </div>
              <div className="mt-auto p-3 border-t border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-[9px] text-slate-500"><span>Available</span><span>{money(balance,currency)}</span></div>
                <div className="flex gap-3 text-[9px] text-slate-500"><span>□ MTL</span><span>□ Long TP/SL</span></div>
                <button disabled className={`w-full py-2.5 rounded-lg text-xs font-bold opacity-60 cursor-not-allowed ${orderSide==='BUY'?'bg-emerald-700':'bg-rose-700'}`}>{orderSide} {selectedPair}</button>
                <div className="text-[9px] text-amber-400/80 flex gap-1"><span>●</span><span>Order entry remains subject to Goldcrest operator confirmation and live execution safety gates.</span></div>
              </div>
            </section>
          </div>

          <section className="bg-[#070b10] min-h-[155px]">
            <div className="h-9 border-b border-slate-800 px-4 flex items-center gap-5 text-[10px]">
              <span className="text-emerald-400 border-b border-emerald-400 h-full flex items-center">Open Orders</span>
              <span className="text-slate-500">Position History</span><span className="text-slate-500">Order & Trade History</span><span className="text-slate-500">Capital Flow</span><span className="text-slate-500">Wallet</span>
            </div>
            <div className="grid grid-cols-7 px-4 py-2 text-[9px] text-slate-600 uppercase border-b border-slate-800">
              <span>Pair</span><span>Side</span><span>Type</span><span>Price</span><span>Order Amount</span><span>Status</span><span className="text-right">Action</span>
            </div>
            <div className="px-4 py-5 text-center text-[10px] text-slate-700 font-mono">No synthetic orders displayed. Live broker order history will populate when available.</div>
          </section>
        </div>
      </div>
    </div>
  );
};

const Field = ({label,value}:{label:string;value:string}) => (
  <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"><div className="text-[9px] text-slate-600">{label}</div><div className="mt-1 font-mono text-slate-200">{value}</div></div>
);
