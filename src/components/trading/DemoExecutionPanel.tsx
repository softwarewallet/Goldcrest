import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  FileCheck,
  FileText,
  Flame,
  Layers,
  Link as LinkIcon,
  Lock,
  Play,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap
} from 'lucide-react';
import {
  DemoExecutionMode,
  DemoOrder,
  ImmutableOrderProposal,
  PreOrderValidationResult,
  SignalToOrderTrace,
  StrategyArmingConfig
} from '../../demoExecution/types';
import { BrokerType, TradingEnvironment } from '../../brokers/types';
import { SignalTraceModal } from './SignalTraceModal';

interface DemoExecutionPanelProps {
  environment: TradingEnvironment;
  selectedBroker: BrokerType;
  maskedAccount: string;
  isEmergencyHalted: boolean;
  onRequestEnvironmentChange: (target: TradingEnvironment) => void;
}

export const DemoExecutionPanel: React.FC<DemoExecutionPanelProps> = ({
  environment,
  selectedBroker,
  maskedAccount,
  isEmergencyHalted,
  onRequestEnvironmentChange
}) => {
  // Engine State
  const [executionMode, setExecutionMode] = useState<DemoExecutionMode>('DEMO_MANUAL');
  const [readinessState, setReadinessState] = useState<string>('READY_FOR_MANUAL_DEMO');
  const [isRiskLocked, setIsRiskLocked] = useState<boolean>(false);
  const [dailyRealizedLoss, setDailyRealizedLoss] = useState<number>(0);
  const [maxDailyLossLimit, setMaxDailyLossLimit] = useState<number>(2500);
  const [dailyTradesExecuted, setDailyTradesExecuted] = useState<number>(0);

  // Orders and Armed Strategies
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [armedStrategies, setArmedStrategies] = useState<StrategyArmingConfig[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedTrace, setSelectedTrace] = useState<SignalToOrderTrace | null>(null);

  // Order Ticket State
  const [ticketSymbol, setTicketSymbol] = useState<string>('EUR/USD');
  const [ticketMarket, setTicketMarket] = useState<string>('FOREX');
  const [ticketSide, setTicketSide] = useState<'BUY' | 'SELL'>('BUY');
  const [ticketBroker, setTicketBroker] = useState<BrokerType>('CTRADER');
  const [ticketLotSize, setTicketLotSize] = useState<number>(100000);
  const [ticketQuantity, setTicketQuantity] = useState<number>(1);
  const [currentProposal, setCurrentProposal] = useState<ImmutableOrderProposal | null>(null);
  const [validationResult, setValidationResult] = useState<PreOrderValidationResult | null>(null);

  // Arming Modal
  const [showArmModal, setShowArmModal] = useState<boolean>(false);
  const [showAutoConfirmModal, setShowAutoConfirmModal] = useState<boolean>(false);
  const [armStrategyId, setArmStrategyId] = useState<string>('MACD_ORDERBLOCK_V2');
  const [armMaxTrades, setArmMaxTrades] = useState<number>(5);
  const [armMaxExposure, setArmMaxExposure] = useState<number>(25000);
  const [armMaxDailyLoss, setArmMaxDailyLoss] = useState<number>(1000);

  // Refresh Engine Status and Orders
  const refreshStatus = async () => {
    try {
      const [statusRes, ordersRes, armedRes] = await Promise.all([
        fetch('/api/demo/status'),
        fetch('/api/demo/orders'),
        fetch('/api/demo/status') // retrieves status metrics
      ]);

      if (statusRes.ok) {
        const s = await statusRes.json();
        setExecutionMode(s.executionMode || 'DEMO_MANUAL');
        setReadinessState(s.readinessState || 'READY_FOR_MANUAL_DEMO');
        setIsRiskLocked(s.isRiskLocked || false);
        setDailyRealizedLoss(s.dailyRealizedLoss || 0);
        setMaxDailyLossLimit(s.maxDailyLossLimit || 2500);
        setDailyTradesExecuted(s.dailyTradesExecuted || 0);
      }

      if (ordersRes.ok) {
        const o = await ordersRes.json();
        setOrders(o || []);
      }
    } catch (err) {
      console.warn('Demo engine status fetch unavailable, keeping last known state:', err);
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  // Update market and broker based on symbol
  const handleSymbolChange = (sym: string) => {
    setTicketSymbol(sym);
    if (sym.includes('/')) {
      setTicketMarket('FOREX');
      setTicketBroker('CTRADER');
      setTicketLotSize(100000);
    } else {
      setTicketMarket('INDIAN_EQUITY');
      setTicketBroker('FIVEPAISA');
      setTicketLotSize(1);
    }
    setCurrentProposal(null);
    setValidationResult(null);
  };

  // Generate Immutable Order Proposal
  const handleGenerateProposal = async () => {
    setIsLoading(true);
    try {
      const mockSignal = {
        id: `SIG-${ticketSymbol.replace('/', '')}-${Date.now().toString().slice(-4)}`,
        market: ticketMarket,
        instrument: ticketSymbol,
        direction: ticketSide,
        strategy: 'MACD_ORDERBLOCK_V2',
        score: 84,
        confidence: 'HIGH',
        status: 'QUALIFIED',
        mlProbability: 0.68,
        entryZone: { min: 1.0845, max: 1.0855, preferred: ticketSymbol.includes('/') ? 1.0850 : 24500 },
        stopLoss: ticketSymbol.includes('/') ? (ticketSide === 'BUY' ? 1.0820 : 1.0880) : (ticketSide === 'BUY' ? 24420 : 24580),
        target1: ticketSymbol.includes('/') ? (ticketSide === 'BUY' ? 1.0910 : 1.0790) : (ticketSide === 'BUY' ? 24660 : 24340),
        timestamp: Date.now()
      };

      const res = await fetch('/api/demo/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: mockSignal,
          broker: ticketBroker,
          environment: 'DEMO',
          lotSize: ticketLotSize
        })
      });

      if (res.ok) {
        const data = await res.json();
        setCurrentProposal(data.proposal);
        setValidationResult(data.validation);
      }
    } catch (err) {
      console.error('Failed to generate order proposal:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Transmit Order to Demo Broker
  const handleExecuteDemoOrder = async () => {
    if (!currentProposal) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/demo/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal: currentProposal,
          clientOrderId: `CLORD-${Date.now()}`
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Order Executed Successfully in DEMO!\nID: ${data.order.orderId}\nBroker ID: ${data.order.brokerOrderId}\nFill Price: ${data.order.averageFillPrice}\nSlippage: ${data.order.executionQuality.slippage} pips`);
        setCurrentProposal(null);
        setValidationResult(null);
        await refreshStatus();
      } else {
        alert(`Execution Rejected: ${data.error || 'Failed validation'}\nReasons:\n${(data.reasons || []).join('\n')}`);
      }
    } catch (err: any) {
      alert(`Demo Execution Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Change Execution Mode
  const handleChangeMode = async (targetMode: DemoExecutionMode) => {
    if (targetMode === 'DEMO_AUTO') {
      setShowAutoConfirmModal(true);
      return;
    }

    if (targetMode === 'DEMO_ARMED') {
      setShowArmModal(true);
      return;
    }

    try {
      const res = await fetch('/api/demo/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: targetMode, operatorConfirmed: true })
      });
      if (res.ok) {
        await refreshStatus();
      } else {
        const err = await res.json();
        alert(`Failed to set mode: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Mode Switch Error: ${err.message}`);
    }
  };

  // Confirm Demo Auto mode (bypasses browser confirm popup blocked by iframes)
  const handleConfirmAutoMode = async () => {
    setShowAutoConfirmModal(false);
    try {
      const res = await fetch('/api/demo/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DEMO_AUTO', operatorConfirmed: true })
      });
      if (res.ok) {
        await refreshStatus();
      } else {
        const err = await res.json();
        alert(`Failed to activate DEMO AUTO: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Mode Switch Error: ${err.message}`);
    }
  };

  // Confirm Strategy Arming
  const handleConfirmArming = async () => {
    try {
      const res = await fetch('/api/demo/arm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: armStrategyId,
          modelId: 'GBDT_FOREX_DIRECTION_V3',
          market: ticketMarket,
          instrument: ticketSymbol,
          maxTrades: armMaxTrades,
          maxExposure: armMaxExposure,
          maxDailyLoss: armMaxDailyLoss,
          expirationMinutes: 120
        })
      });

      if (res.ok) {
        setShowArmModal(false);
        await refreshStatus();
      } else {
        const err = await res.json();
        alert(`Arming Failed: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Arming Error: ${err.message}`);
    }
  };

  // Fetch Trace for Order
  const handleInspectTrace = async (signalId: string) => {
    try {
      const res = await fetch(`/api/demo/trace/${signalId}`);
      if (res.ok) {
        const trace = await res.json();
        setSelectedTrace(trace);
      } else {
        alert('Trace record not found for this order.');
      }
    } catch (err) {
      console.error('Failed to load trace:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. DEMO TELEMETRY & MODE CONTROLLER BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <Zap className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white text-base">Controlled Demo Execution</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                SANDBOX / DEMO ONLY
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center space-x-1">
                <Lock className="w-3 h-3" />
                <span>LIVE LOCKED (PHASE 6)</span>
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-0.5">
              Real-time broker validation pipeline via cTrader Demo (Forex) and 5paisa Sandbox (NSE).
            </p>
          </div>
        </div>

        {/* 3-Mode Execution Switcher */}
        <div className="flex items-center space-x-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
          <button
            onClick={() => handleChangeMode('DEMO_MANUAL')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center space-x-1.5 ${
              executionMode === 'DEMO_MANUAL'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>DEMO MANUAL</span>
          </button>

          <button
            onClick={() => handleChangeMode('DEMO_ARMED')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center space-x-1.5 ${
              executionMode === 'DEMO_ARMED'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>DEMO ARMED</span>
          </button>

          <button
            onClick={() => handleChangeMode('DEMO_AUTO')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center space-x-1.5 ${
              executionMode === 'DEMO_AUTO'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>DEMO AUTO</span>
          </button>
        </div>
      </div>

      {/* 2. READINESS & RISK LOCK STATUS BANNER */}
      {isRiskLocked && (
        <div className="bg-rose-950/80 border border-rose-600/50 rounded-xl p-4 flex items-center justify-between text-xs font-mono text-rose-200">
          <div className="flex items-center space-x-3">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <div>
              <span className="font-bold text-rose-300 uppercase tracking-wide">DEMO RISK LOCKED:</span> Daily loss limit reached (${dailyRealizedLoss.toFixed(2)} / ${maxDailyLossLimit.toFixed(2)}). All auto-execution disarmed.
            </div>
          </div>
          <button
            onClick={async () => {
              await fetch('/api/demo/reset-daily-loss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operatorId: 'OPERATOR_UI' })
              });
              await refreshStatus();
            }}
            className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold transition"
          >
            Reset Daily Lock
          </button>
        </div>
      )}

      {/* 3. GRID: ORDER TICKET & PROPOSAL INSPECTOR */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Interactive Demo Order Ticket (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-white text-sm flex items-center space-x-2">
              <Send className="w-4 h-4 text-emerald-400" />
              <span>Demo Order Dispatch Ticket</span>
            </span>
            <span className="text-slate-500 text-[10px]">Idempotent Routing</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-slate-400 block mb-1">Target Instrument & Market</label>
              <select
                value={ticketSymbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-emerald-500"
              >
                <option value="EUR/USD">EUR/USD (Forex Spot - cTrader Demo)</option>
                <option value="GBP/USD">GBP/USD (Forex Spot - cTrader Demo)</option>
                <option value="USD/JPY">USD/JPY (Forex Spot - cTrader Demo)</option>
                <option value="NIFTY">NIFTY 50 (Indian Equity Index - 5paisa Sandbox)</option>
                <option value="BANKNIFTY">BANKNIFTY (Indian Equity Index - 5paisa Sandbox)</option>
                <option value="RELIANCE">RELIANCE (NSE Equity - 5paisa Sandbox)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-400 block mb-1">Trade Direction</label>
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded border border-slate-800">
                  <button
                    onClick={() => setTicketSide('BUY')}
                    className={`py-1.5 rounded font-bold transition ${
                      ticketSide === 'BUY' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    BUY / LONG
                  </button>
                  <button
                    onClick={() => setTicketSide('SELL')}
                    className={`py-1.5 rounded font-bold transition ${
                      ticketSide === 'SELL' ? 'bg-rose-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    SELL / SHORT
                  </button>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Broker Adapter</label>
                <input
                  type="text"
                  readOnly
                  value={ticketBroker}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-emerald-400 font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-400 block mb-1">Lot Quantity</label>
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={ticketQuantity}
                  onChange={(e) => setTicketQuantity(parseFloat(e.target.value) || 1)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Account Mask</label>
                <input
                  type="text"
                  readOnly
                  value={maskedAccount || '****2841'}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-400"
                />
              </div>
            </div>

            <button
              onClick={handleGenerateProposal}
              disabled={isLoading}
              className="w-full py-2.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center justify-center space-x-2"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <FileCheck className="w-4 h-4" />
              )}
              <span>Construct Immutable Order Proposal</span>
            </button>
          </div>
        </div>

        {/* Right: Proposal Inspection & 20-Gate Pre-Order Matrix (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-white text-sm flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <span>Immutable Proposal & Pre-Order 20-Gate Matrix</span>
            </span>
            {currentProposal && (
              <span className="text-[10px] text-purple-400">
                Hash: {currentProposal.signatureHash.substring(0, 12)}...
              </span>
            )}
          </div>

          {!currentProposal ? (
            <div className="p-8 text-center text-slate-500 space-y-2 border border-dashed border-slate-800 rounded-lg">
              <FileText className="w-8 h-8 mx-auto text-slate-600" />
              <p>No active proposal generated. Select an instrument and click &quot;Construct Immutable Order Proposal&quot;.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Proposal Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-500 block text-[10px]">Symbol / Side</span>
                  <span className={`font-bold ${currentProposal.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {currentProposal.symbol} • {currentProposal.side}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Entry / Market</span>
                  <span className="text-slate-200 font-bold">{currentProposal.entryPrice}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Stop Loss</span>
                  <span className="text-rose-400 font-bold">{currentProposal.stopLoss}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Target 1 (TP1)</span>
                  <span className="text-emerald-400 font-bold">{currentProposal.takeProfit1}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">R:R Ratio</span>
                  <span className="text-amber-400 font-bold">{currentProposal.riskRewardRatio} : 1</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">ML Probability</span>
                  <span className="text-purple-400 font-bold">{(currentProposal.mlProbability * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Spread</span>
                  <span className="text-slate-300 font-bold">{currentProposal.spread} pips</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Risk Amount</span>
                  <span className="text-slate-300 font-bold">${currentProposal.riskAmount}</span>
                </div>
              </div>

              {/* Validation Checks */}
              {validationResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-300">Pre-Order Safety Validation Matrix:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      validationResult.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}>
                      {validationResult.passed ? 'ALL 20 CHECKS PASSED' : 'VALIDATION FAILED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                    {Object.entries(validationResult.checks).map(([key, val]) => (
                      <div key={key} className={`p-1.5 rounded flex items-center space-x-1.5 ${
                        val ? 'bg-emerald-950/30 text-emerald-300 border border-emerald-900/40' : 'bg-rose-950/30 text-rose-300 border border-rose-900/40'
                      }`}>
                        {val ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-rose-400" />}
                        <span className="truncate">{key}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution Action Button */}
              <button
                onClick={handleExecuteDemoOrder}
                disabled={isLoading || !validationResult?.passed}
                className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center space-x-2 text-sm shadow-lg"
              >
                <Zap className="w-4 h-4" />
                <span>TRANSMIT ORDER TO DEMO BROKER ({ticketBroker})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. RECENT DEMO ORDERS & EXECUTION QUALITY AUDIT */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-white text-sm">Demo Broker Order Execution Ledger</span>
          </div>
          <span className="text-slate-500 text-[11px]">{orders.length} orders recorded</span>
        </div>

        {orders.length === 0 ? (
          <div className="p-6 text-center text-slate-500">
            No demo orders executed in current session.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Client Order ID</th>
                  <th className="pb-2">Broker Order ID</th>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Fill Price</th>
                  <th className="pb-2">Slippage</th>
                  <th className="pb-2">Latency</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {orders.map((ord) => (
                  <tr key={ord.orderId} className="hover:bg-slate-800/30 transition">
                    <td className="py-2 text-slate-400">{new Date(ord.createdAt).toLocaleTimeString()}</td>
                    <td className="py-2 text-slate-300 font-bold">{ord.clientOrderId}</td>
                    <td className="py-2 text-slate-400">{ord.brokerOrderId || 'N/A'}</td>
                    <td className="py-2 text-white font-bold">{ord.symbol}</td>
                    <td className="py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        ord.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {ord.side}
                      </span>
                    </td>
                    <td className="py-2 text-slate-300">{ord.filledQuantity} / {ord.requestedQuantity}</td>
                    <td className="py-2 text-slate-200 font-bold">{ord.averageFillPrice?.toFixed(5) || '—'}</td>
                    <td className="py-2 text-amber-300">{ord.executionQuality.slippage > 0 ? `+${ord.executionQuality.slippage}` : ord.executionQuality.slippage} pips</td>
                    <td className="py-2 text-slate-400">{ord.latencies.totalMs}ms</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        ord.status === 'FILLED' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                        ord.status === 'REJECTED' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                        'bg-amber-500/20 text-amber-300'
                      }`}>
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleInspectTrace(ord.signalId)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1 ml-auto"
                      >
                        <LinkIcon className="w-3 h-3 text-emerald-400" />
                        <span>Trace</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Custom Confirmation Modal for DEMO AUTO (IFrame Compatible) */}
      {showAutoConfirmModal && (
        <div id="demo_auto_confirm_modal" className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center space-x-2.5 border-b border-slate-800 pb-3">
              <Shield className="w-5 h-5 text-emerald-400" />
              <h3 className="font-bold text-white text-sm">Activate Controlled DEMO AUTO Mode</h3>
            </div>

            <div className="space-y-3 text-slate-300 leading-relaxed">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 font-bold">
                ⚠️ CONFIRMATION OF SANDBOX SYSTEM RULES
              </div>
              <p>
                By activating <strong className="text-emerald-400 font-bold">DEMO AUTO</strong>, you permit the core execution engine to run in an automated sandbox mode.
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
                <li>Executes trades <strong className="text-white">ONLY inside the DEMO / Sandbox</strong> environments.</li>
                <li>Real-time market routing via cTrader Demo (Forex) & 5paisa Sandbox (NSE).</li>
                <li>All <strong className="text-white">14 pipeline layers & risk gates</strong> are actively enforced.</li>
                <li>Exposure limit checking and daily stop-loss gates remain fully enabled.</li>
                <li><strong className="text-rose-400">LIVE order submission is hard-locked</strong> and remains strictly blocked.</li>
              </ul>
            </div>

            <div className="border-t border-slate-800 pt-3 flex justify-end space-x-2">
              <button
                id="btn_cancel_demo_auto"
                onClick={() => setShowAutoConfirmModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              >
                Cancel
              </button>
              <button
                id="btn_confirm_demo_auto"
                onClick={handleConfirmAutoMode}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
              >
                Activate Demo Auto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Arming Strategy Modal */}
      {showArmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
              <Flame className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-sm">Arm Strategy for Demo Execution</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-slate-400 block mb-1">Strategy ID</label>
                <select
                  value={armStrategyId}
                  onChange={(e) => setArmStrategyId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                >
                  <option value="MACD_ORDERBLOCK_V2">MACD Orderblock V2</option>
                  <option value="EMA_MOMENTUM_TREND_V1">EMA Momentum Trend V1</option>
                  <option value="OPTIONS_STRADDLE_VOL_V3">Options Straddle Vol V3</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Maximum Executed Trades</label>
                <input
                  type="number"
                  value={armMaxTrades}
                  onChange={(e) => setArmMaxTrades(parseInt(e.target.value) || 5)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Maximum Demo Exposure ($)</label>
                <input
                  type="number"
                  value={armMaxExposure}
                  onChange={(e) => setArmMaxExposure(parseInt(e.target.value) || 25000)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Maximum Daily Loss ($)</label>
                <input
                  type="number"
                  value={armMaxDailyLoss}
                  onChange={(e) => setArmMaxDailyLoss(parseInt(e.target.value) || 1000)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"
                />
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3 flex justify-end space-x-2">
              <button
                onClick={() => setShowArmModal(false)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmArming}
                className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold"
              >
                Confirm & Arm Strategy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signal Trace Modal */}
      {selectedTrace && (
        <SignalTraceModal
          trace={selectedTrace}
          onClose={() => setSelectedTrace(null)}
        />
      )}
    </div>
  );
};
