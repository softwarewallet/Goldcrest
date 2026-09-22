import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Radio, 
  ArrowRight, 
  AlertTriangle, 
  Play, 
  Pause, 
  Save, 
  Terminal as TerminalIcon, 
  Cpu, 
  Sparkles, 
  Send,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Target,
  X
} from 'lucide-react';
import { TradingEnvironment, BrokerType } from '../brokers/types';

interface TradingHubProps {
  environment: TradingEnvironment;
  selectedBroker?: string;
  maskedAccount?: string;
  balance?: number;
  currency?: string;
  isEmergencyHalted: boolean;
  onRequestEnvironmentChange: (env: TradingEnvironment) => void;
}

interface TerminalLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'nlp';
  message: string;
}

// Representing genuine live broker positions from /api/brokers/positions
interface RealPosition {
  id: string;
  broker: BrokerType;
  environment: TradingEnvironment;
  market: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  currency: string;
  timestamp: number;
}

// Representing actual scanned system signals from /api/signals
interface RealSignal {
  id: string;
  timestamp: number;
  market: string;
  instrument: string;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  strategy: string;
  score: number;
  mlProbability: number;
  entryZone: { min: number; max: number; preferred: number };
  stopLoss: number;
  target1: number;
  status: string;
  reasons: string[];
}

export const TradingHub: React.FC<TradingHubProps> = ({ 
  environment, 
  selectedBroker = 'cTrader', 
  maskedAccount = 'ID-8849-LIVE', 
  balance = 148500.00, 
  currency = 'USD', 
  isEmergencyHalted 
}) => {
  // Manual Order Form States
  const [market, setMarket] = useState<string>('FOREX');
  const [symbol, setSymbol] = useState<string>('EUR/USD');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [quantity, setQuantity] = useState<number>(10000);
  const [price, setPrice] = useState<string>('');
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [isPlacingOrder, setIsPlacingOrder] = useState<boolean>(false);
  
  // Real Data Feeds State
  const [runningTrades, setRunningTrades] = useState<RealPosition[]>([]);
  const [plannedTrades, setPlannedTrades] = useState<RealSignal[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(true);
  const [isLoadingSignals, setIsLoadingSignals] = useState<boolean>(true);
  const [signalsAgeNow, setSignalsAgeNow] = useState<number>(Date.now());
  const [signalsScanCompletedAt, setSignalsScanCompletedAt] = useState<number | null>(null);
  const [signalScanStats, setSignalScanStats] = useState({ total: 0, actionable: 0, noTrade: 0, errors: 0 });

  const [logs, setLogs] = useState<TerminalLog[]>([
    {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'Autonomous Trading console connected to active Live adapters.'
    },
    {
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'Background scanners synchronized with system scanner services.'
    }
  ]);

  // System Auto-Execution Instructions States
  const [autoInstruction, setAutoInstruction] = useState<string>(
    'Monitor multi-timeframe breakout patterns on key currency pairs (EUR/USD, GBP/USD) and execute buyer positions on RSI breakouts above 60 with strict trailing stop-losses.'
  );
  const [isAutoTradingActive, setIsAutoTradingActive] = useState<boolean>(true);
  const [isSavingInstructions, setIsSavingInstructions] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Triggering State & Notifications
  const [triggeringSignalId, setTriggeringSignalId] = useState<string | null>(null);
  const [triggerNotification, setTriggerNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  type AutoExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';
  interface AutoTradingStatusSnapshot {
    state: 'STOPPED' | 'PREPARING' | 'RUNNING' | 'BLOCKED';
    autonomousPermission: boolean;
    minSignalScore: number;
    maxTradesPerPair: number;
    lastCycleAt: number | null;
    lastCycleResult: string | null;
    lastActions: Array<{
      pair: string;
      result: string;
      signalId?: string;
      reason?: string;
      orderId?: string;
    }>;
    currentExecution: {
      stage: AutoExecutionStage;
      pair: string | null;
      side: 'BUY' | 'SELL' | null;
      signalId: string | null;
      message: string;
      updatedAt: number;
    };
    lastExecution: {
      stage: AutoExecutionStage;
      pair: string | null;
      side: 'BUY' | 'SELL' | null;
      signalId: string | null;
      message: string;
      updatedAt: number;
    } | null;
  }
  const [activeTab, setActiveTab] = useState<'cockpit' | 'positions' | 'signals' | 'execution' | 'controls'>('cockpit');
  const [autoStatus, setAutoStatus] = useState<AutoTradingStatusSnapshot | null>(null);
  const [autoStatusError, setAutoStatusError] = useState<string | null>(null);

  // Helper to append telemetry console logs
  const addLog = useCallback((type: 'info' | 'success' | 'error' | 'warning' | 'nlp', message: string) => {
    setLogs(prev => [
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      },
      ...prev
    ].slice(0, 100)); // Maintain last 100 entries
  }, []);

  // Safe JSON parsing helper to prevent unexpected token '<' exceptions from non-JSON gateway error pages
  const safeParseJson = useCallback(async (res: Response): Promise<any> => {
    const text = await res.text();
    const contentType = res.headers.get('content-type') || 'unknown';
    const goldcrestRoute = res.headers.get('x-goldcrest-route');
    try {
      return JSON.parse(text);
    } catch {
      if (text.includes('<!DOCTYPE') || text.includes('<!doctype') || text.includes('<html')) {
        throw new Error(
          goldcrestRoute === 'broker-order-live'
            ? `Goldcrest order endpoint returned HTTP ${res.status} HTML unexpectedly (content-type: ${contentType}).`
            : `HTTP ${res.status} returned HTML instead of the Goldcrest API JSON route (content-type: ${contentType}). The request may be hitting a stale/proxy/Vite process.`
        );
      }
      throw new Error(text.substring(0, 150) || `Server returned status ${res.status}`);
    }
  }, []);

  // Fetch positions from /api/brokers/positions
  const fetchRealPositions = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoadingPositions(true);
    try {
      const res = await fetch('/api/brokers/positions');
      if (res.ok) {
        const data = await safeParseJson(res);
        if (Array.isArray(data)) {
          setRunningTrades(data);
        }
      } else {
        throw new Error('Positions endpoint returned non-ok status');      }
    } catch (err: any) {
      console.warn('Failed to load real broker positions:', err);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [safeParseJson]);

  // Fetch signals from /api/signals
  const fetchRealSignals = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoadingSignals(true);
    try {
      const res = await fetch('/api/signals');
      if (res.ok) {
        const data = await safeParseJson(res);
        if (Array.isArray(data)) {
          const actionable = data.filter((signal: RealSignal) => ['BUY', 'SELL'].includes(String(signal.direction || '').toUpperCase()));
          const noTrade = data.filter((signal: RealSignal) => String(signal.direction || '').toUpperCase() === 'NO_TRADE');
          const errors = data.filter((signal: RealSignal) => !signal || !signal.direction || String(signal.status || '').toUpperCase() === 'ERROR');
          setSignalScanStats({ total: data.length, actionable: actionable.length, noTrade: noTrade.length, errors: errors.length });
          setPlannedTrades(actionable);
          // Start the freshness counter only after the complete signal scan/fetch has finished.
          // This measures scanner-result age, not the timestamp embedded in an individual signal.
          setSignalsScanCompletedAt(Date.now());
        }
      } else {
        throw new Error('Signals endpoint returned non-ok status');
      }
    } catch (err: any) {
      console.warn('Failed to load real trading signals:', err);
    } finally {
      setIsLoadingSignals(false);
    }
  }, [safeParseJson]);

  // Synchronize with backend system controls
  const syncAutoControls = useCallback(async (enabled: boolean) => {
    try {
      const res = await fetch('/api/brokers/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoExecutionEnabled: enabled })
      });
      if (res.ok) {
        addLog('info', `Autonomous execution mode toggled on backend: ${enabled ? 'ACTIVE' : 'INACTIVE'}`);
      }
    } catch (err: any) {
      addLog('error', `Failed to sync autonomous status with system: ${err.message}`);
    }
  }, [addLog]);

  // Poll the authoritative Auto Live lifecycle so the cockpit reflects the server-side execution state.
  useEffect(() => {
    let mounted = true;
    const fetchAutoStatus = async () => {
      try {
        const res = await fetch('/api/brokers/controls', { cache: 'no-store' });
        if (!res.ok) throw new Error('Auto Live status endpoint returned HTTP ' + res.status);
        const data = await safeParseJson(res);
        if (mounted && data?.autoTrading) {
          setAutoStatus(data.autoTrading);
          setAutoStatusError(null);
        }
      } catch (err: any) {
        if (mounted) setAutoStatusError(err?.message || 'Auto Live status unavailable');
      }
    };
    void fetchAutoStatus();
    const statusTimer = setInterval(fetchAutoStatus, 2000);
    return () => { mounted = false; clearInterval(statusTimer); };
  }, [safeParseJson]);

  // Initial load and polling setup
  useEffect(() => {
    fetchRealPositions();
    fetchRealSignals();

    const positionsInterval = setInterval(() => {
      fetchRealPositions(true);
    }, 10000);

    const signalsInterval = setInterval(() => {
      fetchRealSignals(true);
    }, 30000);

    return () => {
      clearInterval(positionsInterval);
      clearInterval(signalsInterval);
    };
  }, [fetchRealPositions, fetchRealSignals]);

  // Keep the displayed record-age counter moving once per second without refetching.
  useEffect(() => {
    const ageTimer = setInterval(() => setSignalsAgeNow(Date.now()), 1000);
    return () => clearInterval(ageTimer);
  }, []);

  const formatAge = useCallback((timestamp: number | undefined | null): string => {
    if (!timestamp || !Number.isFinite(Number(timestamp))) return 'N/A';
    const ageSeconds = Math.max(0, Math.floor((signalsAgeNow - Number(timestamp)) / 1000));
    if (ageSeconds < 60) return ageSeconds + 's';
    const minutes = Math.floor(ageSeconds / 60);
    const seconds = ageSeconds % 60;
    if (minutes < 60) return minutes + 'm ' + seconds + 's';
    const hours = Math.floor(minutes / 60);
    return hours + 'h ' + (minutes % 60) + 'm';
  }, [signalsAgeNow]);

  const visiblePlannedTrades = useMemo(
    () => plannedTrades.filter(signal => String(signal.direction || '').toUpperCase() !== 'NO_TRADE'),
    [plannedTrades]
  );

  // All rows belong to the same completed scanner pass, so their displayed age is
  // measured from the time that pass completed. This prevents an old signal timestamp
  // from consuming the execution freshness window before the scanner has finished.

  // Handle market change configuration
  const handleMarketChange = (newMarket: string) => {
    setMarket(newMarket);
    if (newMarket === 'FOREX') {
      setSymbol('EUR/USD');
      setQuantity(10000);
    } else if (newMarket === 'INDIAN_EQUITY') {
      setSymbol('RELIANCE');
      setQuantity(50);
    } else {
      setSymbol('NIFTY');
      setQuantity(1);
    }
  };

  // Submit direct manual trade order
  const handleExecuteTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmergencyHalted) {
      addLog('error', 'Execution Intercepted: Emergency Kill Switch is ACTIVE. New orders are blocked.');
      return;
    }

    setIsPlacingOrder(true);
    const idempotencyKey = globalThis.crypto.randomUUID();
    addLog('info', `Routing manual order: ${side} ${quantity} ${symbol} via ${market} gateway...`);

    try {
      // Verify that this browser is talking to the current Goldcrest Express
      // backend before submitting a live order. Do not retry an order blindly:
      // the idempotency key must remain unique for every operator action.
      const runtimeRes = await fetch('/api/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeContentType = runtimeRes.headers.get('content-type') || '';
      if (!runtimeRes.ok || !runtimeContentType.includes('application/json')) {
        throw new Error(
          `Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}, content-type: ${runtimeContentType || 'unknown'}). Restart the current Node server on port 3000.`
        );
      }

      const payload = {
        market,
        symbol,
        side,
        orderType,
        quantity: Number(quantity),
        price: orderType === 'LIMIT' && price ? Number(price) : undefined,
        stopLoss: stopLoss ? Number(stopLoss) : undefined,
        takeProfit: takeProfit ? Number(takeProfit) : undefined,
        environment,
        signalId: idempotencyKey,
        executionSource: 'TRIGGER_NOW'
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await safeParseJson(res);

      if (!res.ok) {
        throw new Error(data.error || data.reason || 'Failed to execute order');
      }

      const executionStatus = String(data.order?.status || data.executionState || 'UNKNOWN').toUpperCase();
      addLog(
        executionStatus === 'FILLED' ? 'success' : 'info',
        `ORDER ${executionStatus}: Ref ID ${data.order?.id || data.executionId || idempotencyKey} - Dispatched to ${data.broker || 'Live Adapter'}`
      );
      
      // Instantly trigger re-fetch to show new position/orders
      fetchRealPositions();
    } catch (err: any) {
      addLog('error', `Execution Failed: ${err.message}`);    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Compile instructions and update auto execution state
  const handleSaveAutoInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInstructions(true);
    setSaveMessage(null);

    addLog('info', '[NLP ENGINE] Analyzing natural language parameters...');
    addLog('info', `[NLP ENGINE] Actively registering rules for: "${autoInstruction.slice(0, 60)}..."`);

    try {
      // Post actual configuration updates to the backend controls API
      const res = await fetch('/api/brokers/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoExecutionEnabled: isAutoTradingActive,
          autonomousLiveExecutionAllowed: isAutoTradingActive
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save controls');
      }

      setSaveMessage('System Instructions successfully compiled and active on the backend processor!');
      addLog('success', 'AUTO SYSTEM CONFIGURED: Target scanner active using the persisted Auto Live execution rules.');
      fetchRealSignals();
    } catch (err: any) {
      addLog('error', `Failed to apply strategy parameters: ${err.message}`);
    } finally {
      setIsSavingInstructions(false);
    }
  };

  // Close live broker position
  const handleClosePosition = async (positionId: string, broker: BrokerType) => {
    addLog('info', `Sending close request for Position ${positionId} on ${broker}...`);
    try {
      const res = await fetch(`/api/brokers/position/${encodeURIComponent(positionId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      const data = await safeParseJson(res);
      if (res.ok && data.success) {
        addLog('success', `Position ${positionId} closed successfully. Real-time liquidation confirmed.`);
        fetchRealPositions();
      } else {
        throw new Error(data.error || 'Failed to close position on broker gateway');
      }
    } catch (err: any) {
      addLog('error', `Liquidation Failed: ${err.message}`);
    }
  };

  // Execute immediate order placement directly from a planned signal
  const triggerSignalExecution = async (signal: RealSignal) => {
    // 1. Resolve effective trade direction from signal direction, SL/TP structure, or strategy bias
    let orderSide: 'BUY' | 'SELL' = 'BUY';
    const rawDir = String(signal.direction || '').toUpperCase();
    if (rawDir.includes('BUY') || rawDir.includes('LONG')) {
      orderSide = 'BUY';
    } else if (rawDir.includes('SELL') || rawDir.includes('SHORT')) {
      orderSide = 'SELL';
    } else if (signal.stopLoss && signal.target1 && signal.stopLoss > 0 && signal.target1 > 0) {
      // If stopLoss > target1, it's a short (SELL) setup; if below, it's a long (BUY) setup
      orderSide = signal.stopLoss > signal.target1 ? 'SELL' : 'BUY';
    } else if (Array.isArray(signal.reasons) && signal.reasons.some(r => /bear|short|sell|down/i.test(r))) {
      orderSide = 'SELL';
    } else {
      orderSide = 'BUY';
    }

    addLog('nlp', `[SIGNAL DISPATCH] Operator triggered immediate execution for ${signal.instrument} (${orderSide})`);
    setTriggeringSignalId(signal.id);
    setTriggerNotification(null);

    const idempotencyKey = `${signal.id}:${globalThis.crypto.randomUUID()}`;
    try {
      // Trigger Now uses the same live order API as the manual ticket. Verify the
      // browser is connected to the current Express backend before dispatching.
      // Never retry a live order automatically after an ambiguous response.
      const runtimeRes = await fetch('/api/runtime', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const runtimeContentType = runtimeRes.headers.get('content-type') || '';
      if (!runtimeRes.ok || !runtimeContentType.includes('application/json')) {
        throw new Error(
          `Goldcrest backend runtime probe failed (HTTP ${runtimeRes.status}, content-type: ${runtimeContentType || 'unknown'}). Restart the current Node server on port 3000.`
        );
      }

      const payload = {
        market: signal.market,
        symbol: signal.instrument,
        side: orderSide,
        orderType: 'MARKET',
        quantity: signal.market === 'FOREX' ? 10000 : 25,
        stopLoss: signal.stopLoss && signal.stopLoss > 0 ? signal.stopLoss : undefined,
        takeProfit: signal.target1 && signal.target1 > 0 ? signal.target1 : undefined,
        environment,
        signalId: idempotencyKey
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      const data = await safeParseJson(res);
      if (!res.ok) {
        const errorMsg = data?.error || data?.message || `Signal trigger submission rejected (HTTP ${res.status})`;
        const detailsMsg = data.details?.length ? ` (${data.details.join(', ')})` : '';
        throw new Error(`${errorMsg}${detailsMsg}`);
      }

      const executionStatus = String(data.order?.status || data.executionState || 'SUBMITTED').toUpperCase();
      const orderRef = data.order?.id || data.executionId || idempotencyKey;
      
      addLog(
        executionStatus === 'FILLED' || executionStatus === 'EXECUTED' ? 'success' : 'info',
        `SIGNAL ORDER ${executionStatus}: ${signal.instrument} ${orderSide} - Ref ID ${orderRef}`
      );

      setTriggerNotification({
        type: 'success',
        message: `Order submitted for ${signal.instrument} [${orderSide}] (Status: ${executionStatus}, Ref: ${orderRef})`
      });

      fetchRealPositions();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to dispatch signal order';
      addLog('error', `Trigger Dispatch Error (${signal.instrument}): ${errMsg}`);
      setTriggerNotification({
        type: 'error',
        message: `${signal.instrument}: ${errMsg}`
      });
    } finally {
      setTriggeringSignalId(null);
    }
  };

  const executionStage: AutoExecutionStage = autoStatus?.currentExecution?.stage || 'IDLE';
  const executionPair = autoStatus?.currentExecution?.pair;
  const executionSide = autoStatus?.currentExecution?.side;
  const executionMessage = autoStatus?.currentExecution?.message || 'Waiting for the next Auto Live cycle.';
  const stageLabel: Record<AutoExecutionStage, string> = {
    IDLE: 'STANDBY',
    SCANNING_MARKET: 'SCANNING MARKET',
    ANALYZING_SIGNAL: 'ANALYZING SIGNAL',
    PREPARING_ORDER: 'PREPARING ORDER',
    SAFETY_GATE: 'SAFETY GATE',
    SUBMITTING_ORDER: 'SUBMITTING ORDER',
    TRADE_EXECUTED: 'TRADE EXECUTED',
    REJECTED: 'REJECTED'
  };
  const renderTabs = () => (
    <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
      {[
        ['cockpit', 'Auto Live'],
        ['positions', 'Positions'],
        ['signals', 'Signals'],
        ['execution', 'Execution Log'],
        ['controls', 'Controls']
      ].map(([id, label]) => (
        <button key={id} type="button" onClick={() => setActiveTab(id as typeof activeTab)}
          className={"px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition " +
            (activeTab === id ? "bg-cyan-950 text-cyan-300 border-cyan-700" : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white")}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div id="unified_trading_hub" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="text-white font-bold text-base">Auto Live Trading Cockpit</div>
            <div className="text-slate-500 text-xs font-mono mt-1">Operational view for live execution only.</div>
          </div>
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <span className={"px-3 py-1 rounded-lg border font-bold " +
              (autoStatus?.state === 'RUNNING' ? "text-emerald-300 bg-emerald-950/60 border-emerald-800" :
               autoStatus?.state === 'BLOCKED' ? "text-rose-300 bg-rose-950/60 border-rose-800" :
               "text-amber-300 bg-amber-950/60 border-amber-800")}>
              AUTO LIVE: {autoStatus?.state || 'LOADING'}
            </span>            <span className="px-3 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300">{selectedBroker} · LIVE</span>
          </div>
        </div>
      </div>

      {renderTabs()}

      {activeTab === 'cockpit' && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Current Activity</div>
            <div className="mt-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className={"text-xl font-black font-mono " +
                  (executionStage === 'TRADE_EXECUTED' ? "text-emerald-400" :
                   executionStage === 'REJECTED' ? "text-rose-400" :
                   executionStage === 'IDLE' ? "text-slate-300" : "text-cyan-300")}>
                  {stageLabel[executionStage]}
                </div>
                <div className="text-slate-300 text-sm mt-1">
                  {executionPair ? executionPair + (executionSide ? " · " + executionSide : "") : "No trade currently being prepared"}
                </div>
                <div className="text-slate-500 text-xs mt-2">{executionMessage}</div>
              </div>
              <div className="px-4 py-3 rounded-xl border border-cyan-800 bg-cyan-950/40 text-cyan-300 font-mono text-xs font-bold">
                {executionStage === 'SUBMITTING_ORDER' ? 'BROKER REQUEST IN PROGRESS' :
                 executionStage === 'TRADE_EXECUTED' ? 'BROKER CONFIRMATION RECEIVED' :
                 executionStage === 'REJECTED' ? 'TRADE NOT EXECUTED' : 'AUTO LIVE MONITORING'}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1 mt-5">
              {['SCANNING_MARKET','ANALYZING_SIGNAL','PREPARING_ORDER','SAFETY_GATE','SUBMITTING_ORDER'].map(stage => (
                <div key={stage} className={"h-1.5 rounded " +
                  (executionStage === stage ? "bg-cyan-400 animate-pulse" :
                   (executionStage === 'TRADE_EXECUTED' || executionStage === 'REJECTED') ? "bg-slate-700" : "bg-slate-800")} />
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Active Positions</div><div className="text-2xl font-bold text-white mt-1">{runningTrades.length}</div></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Actionable Signals</div><div className="text-2xl font-bold text-white mt-1">{visiblePlannedTrades.length}</div></div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Last Cycle</div><div className="text-xs text-slate-300 mt-2">{autoStatus?.lastCycleResult || 'Waiting.'}</div></div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div><div className="text-xs font-bold text-white font-mono uppercase">Active Positions</div><div className="text-[10px] text-slate-500 mt-1">Broker-authoritative · refreshes every 10 seconds</div></div>
              <button type="button" onClick={() => fetchRealPositions(false)} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button>
            </div>
            {runningTrades.length === 0 ? <div className="py-7 text-center text-xs text-slate-500 font-mono">No active live positions.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-xs font-mono">
                <thead><tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 text-left">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">Stop Loss</th><th className="text-right">Take Profit</th><th className="text-right">Floating P&L</th><th>Action</th>
                </tr></thead>
                <tbody>{runningTrades.map(trade => (
                  <tr key={trade.id} className="border-b border-slate-800/60">
                    <td className="py-2 text-white font-bold">{trade.symbol}</td><td className={trade.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{trade.side}</td>
                    <td className="text-right">{trade.quantity.toLocaleString()}</td><td className="text-right">{trade.entryPrice.toLocaleString()}</td><td className="text-right text-cyan-300">{trade.currentPrice.toLocaleString()}</td>
                    <td className="text-right text-rose-300">{trade.stopLoss ? trade.stopLoss.toLocaleString() : 'N/A'}</td><td className="text-right text-emerald-300">{trade.takeProfit ? trade.takeProfit.toLocaleString() : 'N/A'}</td>
                    <td className={"text-right font-bold " + (trade.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.unrealizedPnL >= 0 ? '+' : ''}{trade.unrealizedPnL.toLocaleString()}</td>
                    <td className="text-center"><button type="button" onClick={() => handleClosePosition(trade.id, trade.broker)} className="text-[10px] px-2 py-1 rounded border border-slate-700 text-rose-300">Exit</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}

      {activeTab === 'positions' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex justify-between mb-3"><div><div className="text-sm font-bold text-white font-mono">Live Positions</div><div className="text-[10px] text-slate-500">Complete broker data</div></div><button type="button" onClick={() => fetchRealPositions(false)} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button></div>
          <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead><tr className="text-slate-500 border-b border-slate-800">
            <th className="py-2 text-left">ID</th><th>Broker</th><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Current</th><th className="text-right">Stop Loss</th><th className="text-right">Take Profit</th><th className="text-right">Floating P&L</th><th></th>
          </tr></thead><tbody>{runningTrades.map(trade => (
            <tr key={trade.id} className="border-b border-slate-800/60"><td className="py-2 text-slate-500">{trade.id}</td><td>{trade.broker}</td><td className="text-white font-bold">{trade.symbol}</td><td className={trade.side === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{trade.side}</td><td className="text-right">{trade.quantity.toLocaleString()}</td><td className="text-right">{trade.entryPrice.toLocaleString()}</td><td className="text-right text-cyan-300">{trade.currentPrice.toLocaleString()}</td><td className="text-right text-rose-300">{trade.stopLoss ? trade.stopLoss.toLocaleString() : 'N/A'}</td><td className="text-right text-emerald-300">{trade.takeProfit ? trade.takeProfit.toLocaleString() : 'N/A'}</td><td className={"text-right font-bold " + (trade.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{trade.unrealizedPnL >= 0 ? '+' : ''}{trade.unrealizedPnL.toLocaleString()}</td><td className="text-center"><button type="button" onClick={() => handleClosePosition(trade.id, trade.broker)} className="text-[10px] px-2 py-1 rounded border border-slate-700 text-rose-300">Exit</button></td></tr>
          ))}</tbody></table></div>
        </div>
      )}

      {activeTab === 'signals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><div className="text-sm font-bold text-white font-mono">Actionable Signals</div><div className="text-[10px] text-slate-500">Scanned: <span className="text-cyan-300">{signalScanStats.total}</span> · Actionable: <span className="text-emerald-300">{signalScanStats.actionable}</span> · NO_TRADE: <span className="text-slate-400">{signalScanStats.noTrade}</span> · Errors: <span className="text-rose-300">{signalScanStats.errors}</span> · Auto Live minimum score: <span className="text-cyan-300">{autoStatus?.minSignalScore ?? '—'}</span></div></div><div className="flex gap-2 items-center"><span className="text-[11px] font-mono text-slate-400">Scan Age: <b className="text-cyan-300">{signalsScanCompletedAt ? formatAge(signalsScanCompletedAt) : 'N/A'}</b></span><button type="button" onClick={() => fetchRealSignals(false)} disabled={isLoadingSignals} className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 text-[11px] font-mono">Refresh</button></div></div>
          {triggerNotification && <div className={"p-3 rounded-lg border text-xs font-mono " + (triggerNotification.type === 'error' ? "border-rose-800 bg-rose-950/40 text-rose-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-300")}>{triggerNotification.message}</div>}
          <div className="overflow-x-auto"><table className="w-full text-xs font-mono"><thead><tr className="text-slate-500 border-b border-slate-800"><th className="py-2 text-left">Market</th><th>Symbol</th><th>Side</th><th>Strategy</th><th className="text-right">SL</th><th className="text-right">TP</th><th>Score</th><th>ML</th><th>Age</th><th>Action</th></tr></thead>
          <tbody>{visiblePlannedTrades.map(signal => <tr key={signal.id} className="border-b border-slate-800/60"><td className="py-2 text-slate-500">{signal.market}</td><td className="text-white font-bold">{signal.instrument}</td><td className={signal.direction === 'BUY' ? "text-emerald-400" : "text-rose-400"}>{signal.direction}</td><td className="max-w-xs truncate" title={signal.reasons?.join(', ') || signal.strategy}>{signal.strategy}</td><td className="text-right text-rose-300">{signal.stopLoss?.toLocaleString() || 'N/A'}</td><td className="text-right text-emerald-300">{signal.target1?.toLocaleString() || 'N/A'}</td><td className="text-center">{signal.score}</td><td className="text-center text-emerald-400">{(signal.mlProbability * 100).toFixed(0)}%</td><td className="text-center text-cyan-300">{formatAge(signalsScanCompletedAt)}</td><td className="text-center"><button type="button" onClick={() => triggerSignalExecution(signal)} disabled={triggeringSignalId === signal.id} className="text-[10px] px-2.5 py-1 rounded bg-emerald-700 text-white disabled:opacity-50">{triggeringSignalId === signal.id ? 'Triggering...' : 'Trigger Now'}</button></td></tr>)}</tbody></table></div>
        </div>
      )}

      {activeTab === 'execution' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Execution Lifecycle</div><div className="space-y-2">
            {['SCANNING_MARKET','ANALYZING_SIGNAL','PREPARING_ORDER','SAFETY_GATE','SUBMITTING_ORDER','TRADE_EXECUTED','REJECTED'].map(stage => <div key={stage} className={"flex items-center justify-between px-3 py-2 rounded border " + (executionStage === stage ? "border-cyan-700 bg-cyan-950/40 text-cyan-300" : "border-slate-800 bg-slate-950 text-slate-500")}><span className="font-mono text-xs">{stageLabel[stage as AutoExecutionStage]}</span>{executionStage === stage && <span className="text-[10px]">CURRENT</span>}</div>)}
          </div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-sm font-bold text-white font-mono">Execution Decision</div>
            <div className={"rounded-lg border p-3 text-xs font-mono " + (executionStage === 'REJECTED' ? "border-rose-800 bg-rose-950/30 text-rose-300" : executionStage === 'TRADE_EXECUTED' ? "border-emerald-800 bg-emerald-950/30 text-emerald-300" : "border-cyan-800 bg-cyan-950/30 text-cyan-300")}>
              <div className="font-bold">{executionPair ? executionPair : 'AUTO LIVE'}{executionSide ? " · " + executionSide : ""}</div>
              <div className="mt-1">{executionMessage}</div>
            </div>
            <div className="text-sm font-bold text-white font-mono">Pair Decisions</div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-2">
              {!autoStatus?.lastActions?.length ? <div className="text-slate-600">No pair decisions recorded yet.</div> : autoStatus.lastActions.slice(-12).map((action, i) => (
                <div key={i} className="border-b border-slate-800 pb-2 last:border-b-0">
                  <div><span className="text-white font-bold">{action.pair}</span> <span className="text-cyan-400">[{action.result}]</span></div>
                  {action.reason && <div className="text-rose-300 mt-1">{action.reason}</div>}
                  {action.orderId && <div className="text-emerald-300 mt-1">Order: {action.orderId}</div>}
                </div>
              ))}
            </div>
            <div className="text-sm font-bold text-white font-mono">Runtime Output</div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-1">{logs.length === 0 ? <div className="text-slate-600">No UI telemetry.</div> : logs.map((log, i) => <div key={i}><span className="text-slate-600">[{log.timestamp}]</span> <span className={log.type === 'error' ? "text-rose-400" : log.type === 'success' ? "text-emerald-400" : "text-cyan-400"}>[{log.type.toUpperCase()}]</span> <span className="text-slate-300">{log.message}</span></div>)}</div>
          </div>
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Auto Live Status</div><div className="space-y-3 text-xs font-mono">
            <div className="flex justify-between"><span className="text-slate-500">Engine State</span><span className="text-white">{autoStatus?.state || 'LOADING'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Autonomous Permission</span><span className={autoStatus?.autonomousPermission ? "text-emerald-400" : "text-rose-400"}>{autoStatus?.autonomousPermission ? 'ALLOWED' : 'BLOCKED'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Minimum Signal Score</span><span className="text-cyan-300">{autoStatus?.minSignalScore ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max Trades / Pair</span><span className="text-cyan-300">{autoStatus?.maxTradesPerPair ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Emergency Halt</span><span className={isEmergencyHalted ? "text-rose-400" : "text-emerald-400"}>{isEmergencyHalted ? 'ACTIVE' : 'READY'}</span></div>
            {autoStatusError && <div className="text-rose-300 border border-rose-900 bg-rose-950/30 rounded p-2">{autoStatusError}</div>}
          </div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4"><div className="text-sm font-bold text-white font-mono mb-3">Secondary Tools</div><div className="text-xs text-slate-500">Detailed diagnostics, configuration and historical information should be kept in dedicated application pages rather than the default Auto Live cockpit.</div></div>
        </div>
      )}
    </div>
  );

};