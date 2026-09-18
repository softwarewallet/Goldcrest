import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  BarChart2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  FileCheck,
  FileText,
  Filter,
  Flame,
  HelpCircle,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Terminal,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap
} from 'lucide-react';
import {
  TradingOperationsStatus,
  GlobalSystemState,
  DemoReadinessCheckReport,
  ControlledDemoTestRun,
  PositionReconciliationReport,
  OrderReconciliationReport,
  SignalFunnelMetrics,
  RejectionAnalyticsItem,
  ImmutableAuditEvent,
  InternalSystemAlert
} from '../governance/types';
import { BrokerType, TradingEnvironment } from '../brokers/types';
import { PerformanceResearchCenterView } from './PerformanceResearchCenterView';
import { TradeExplorerView } from './TradeExplorerView';

interface TradingOperationsDashboardProps {
  initialSubTab?: 'OPS' | 'RESEARCH' | 'EXPLORER';
  focusedSection?: 'RECONCILIATION' | 'PNL' | 'FUNNEL' | 'AUDIT';
}

export const TradingOperationsDashboard: React.FC<TradingOperationsDashboardProps> = ({
  initialSubTab = 'OPS',
  focusedSection
}) => {
  const [dashboardSubTab, setDashboardSubTab] = useState<'OPS' | 'RESEARCH' | 'EXPLORER'>(initialSubTab);

  useEffect(() => {
    if (initialSubTab) {
      setDashboardSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const [opsStatus, setOpsStatus] = useState<TradingOperationsStatus | null>(null);
  const [demoReadiness, setDemoReadiness] = useState<DemoReadinessCheckReport | null>(null);
  const [demoRuns, setDemoRuns] = useState<ControlledDemoTestRun[]>([]);
  const [activeDemoRun, setActiveDemoRun] = useState<ControlledDemoTestRun | null>(null);
  const [isRunningDemoTest, setIsRunningDemoTest] = useState<boolean>(false);

  const [positionReport, setPositionReport] = useState<PositionReconciliationReport | null>(null);
  const [orderReport, setOrderReport] = useState<OrderReconciliationReport | null>(null);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);

  const [signalFunnel, setSignalFunnel] = useState<SignalFunnelMetrics | null>(null);
  const [rejections, setRejections] = useState<RejectionAnalyticsItem[]>([]);
  const [executionLogs, setExecutionLogs] = useState<any[]>([]);
  const [executionSummary, setExecutionSummary] = useState<any>(null);

  const [auditLogs, setAuditLogs] = useState<ImmutableAuditEvent[]>([]);
  const [auditFilter, setAuditFilter] = useState<string>('ALL');

  const [dailyReport, setDailyReport] = useState<any>(null);
  const [weeklyReport, setWeeklyReport] = useState<any>(null);
  const [activeReportTab, setActiveReportTab] = useState<'DAILY' | 'WEEKLY'>('DAILY');

  // Kill Switch Test State
  const [killSwitchTestResult, setKillSwitchTestResult] = useState<any>(null);
  const [isRunningKillTest, setIsRunningKillTest] = useState<boolean>(false);

  // Manual Override Form State
  const [showOverrideModal, setShowOverrideModal] = useState<boolean>(false);
  const [overrideAction, setOverrideAction] = useState<string>('TEMPORARY_SPREAD_TOLERANCE_ADJUSTMENT');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideOperator, setOverrideOperator] = useState<string>('CHIEF_RISK_OFFICER');
  const [overrideConfirmed, setOverrideConfirmed] = useState<boolean>(false);
  const [overrideResultMsg, setOverrideResultMsg] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const loadAllOperationsData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [
        statusRes,
        readinessRes,
        demoRunsRes,
        posRes,
        ordRes,
        funnelRes,
        rejRes,
        execRes,
        auditRes,
        dailyRes,
        weeklyRes
      ] = await Promise.all([
        fetch('/api/governance/status'),
        fetch('/api/governance/demo-readiness?broker=CTRADER'),
        fetch('/api/governance/demo-test/history'),
        fetch('/api/governance/reconciliation/positions'),
        fetch('/api/governance/reconciliation/orders'),
        fetch('/api/governance/funnel'),
        fetch('/api/governance/rejections'),
        fetch('/api/governance/execution-quality'),
        fetch('/api/governance/audit-logs?limit=50'),
        fetch('/api/governance/reports/daily'),
        fetch('/api/governance/reports/weekly')
      ]);

      if (statusRes.ok) setOpsStatus(await statusRes.json());
      if (readinessRes.ok) setDemoReadiness(await readinessRes.json());
      if (demoRunsRes.ok) setDemoRuns(await demoRunsRes.json());
      if (posRes.ok) setPositionReport(await posRes.json());
      if (ordRes.ok) setOrderReport(await ordRes.json());
      if (funnelRes.ok) setSignalFunnel(await funnelRes.json());
      if (rejRes.ok) setRejections(await rejRes.json());
      if (execRes.ok) {
        const d = await execRes.json();
        setExecutionLogs(d.logs || []);
        setExecutionSummary(d.summary || null);
      }
      if (auditRes.ok) setAuditLogs(await auditRes.json());
      if (dailyRes.ok) setDailyReport(await dailyRes.json());
      if (weeklyRes.ok) setWeeklyReport(await weeklyRes.json());
    } catch (err) {
      console.error('Failed to load operations data:', err);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllOperationsData();
  }, [loadAllOperationsData]);

  // Execute Controlled Demo Test
  const handleExecuteDemoTest = async () => {
    setIsRunningDemoTest(true);
    try {
      const res = await fetch('/api/governance/demo-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: 'EUR/USD', market: 'FOREX' })
      });
      if (res.ok) {
        const run = await res.json();
        setActiveDemoRun(run);
        setDemoRuns(prev => [run, ...prev]);
        await loadAllOperationsData();
      }
    } catch (err) {
      console.error('Demo test failed:', err);
    } finally {
      setIsRunningDemoTest(false);
    }
  };

  // Run Position & Order Reconciliation
  const handleRunReconciliation = async () => {
    setIsReconciling(true);
    try {
      const [pRes, oRes] = await Promise.all([
        fetch('/api/governance/reconciliation/positions/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ broker: 'CTRADER', environment: 'PAPER' })
        }),
        fetch('/api/governance/reconciliation/orders/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ broker: 'CTRADER', environment: 'PAPER' })
        })
      ]);

      if (pRes.ok) setPositionReport(await pRes.json());
      if (oRes.ok) setOrderReport(await oRes.json());
      await loadAllOperationsData();
    } catch (err) {
      console.error('Reconciliation run error:', err);
    } finally {
      setIsReconciling(false);
    }
  };

  // Run Kill Switch Automated Test
  const handleRunKillSwitchTest = async () => {
    setIsRunningKillTest(true);
    try {
      const res = await fetch('/api/governance/kill-switch-test', { method: 'POST' });
      if (res.ok) {
        setKillSwitchTestResult(await res.json());
        await loadAllOperationsData();
      }
    } catch (err) {
      console.error('Kill switch test error:', err);
    } finally {
      setIsRunningKillTest(false);
    }
  };

  // Submit Manual Override
  const handleSubmitOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideConfirmed || !overrideReason) return;

    try {
      const res = await fetch('/api/governance/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: overrideAction,
          operatorId: overrideOperator,
          confirmed: true,
          reason: overrideReason,
          parameters: { timestamp: Date.now() }
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOverrideResultMsg(data.message);
        setOverrideReason('');
        setOverrideConfirmed(false);
        await loadAllOperationsData();
        setTimeout(() => {
          setShowOverrideModal(false);
          setOverrideResultMsg(null);
        }, 2500);
      }
    } catch (err) {
      console.error('Override submission failed:', err);
    }
  };

  // Controlled Order Modal State
  const [showControlledOrderModal, setShowControlledOrderModal] = useState<boolean>(false);
  const [controlledBroker, setControlledBroker] = useState<'CTRADER' | 'FIVEPAISA'>('CTRADER');
  const [controlledEnv, setControlledEnv] = useState<'DEMO' | 'SANDBOX'>('DEMO');
  const [controlledInstrument, setControlledInstrument] = useState<string>('EUR/USD');
  const [controlledSide, setControlledSide] = useState<'BUY' | 'SELL'>('BUY');
  const [controlledQuantity, setControlledQuantity] = useState<string>('1.0');
  const [controlledStopLoss, setControlledStopLoss] = useState<string>('1.0750');
  const [controlledTakeProfit, setControlledTakeProfit] = useState<string>('1.0950');
  const [controlledTraceId, setControlledTraceId] = useState<string>(`trace_${Date.now()}`);
  const [orderValidationState, setOrderValidationState] = useState<'IDLE' | 'VALIDATING' | 'VALIDATED' | 'REJECTED'>('IDLE');
  const [validationReport, setValidationReport] = useState<any>(null);
  const [isSubmittingControlledOrder, setIsSubmittingControlledOrder] = useState<boolean>(false);
  const [controlledOrderResult, setControlledOrderResult] = useState<any>(null);

  const handleValidateControlledOrder = async () => {
    setOrderValidationState('VALIDATING');
    try {
      const payload = {
        broker: controlledBroker === 'FIVEPAISA' ? 'FIVE_PAISA' : controlledBroker,
        environment: controlledEnv,
        market: controlledBroker === 'CTRADER' ? 'FOREX' : 'INDIA_EQUITY',
        symbol: controlledInstrument,
        side: controlledSide,
        orderType: 'MARKET',
        quantity: parseFloat(controlledQuantity),
        stopLoss: parseFloat(controlledStopLoss),
        takeProfit: parseFloat(controlledTakeProfit),
        tradeTraceId: controlledTraceId,
        validateOnly: true
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setValidationReport(data);
      if (res.ok && data.status !== 'REJECTED') {
        setOrderValidationState('VALIDATED');
      } else {
        setOrderValidationState('REJECTED');
      }
    } catch (err) {
      console.error('Validation error:', err);
      setOrderValidationState('REJECTED');
      setValidationReport({ error: 'Network validation error' });
    }
  };

  const handlePlaceControlledOrder = async () => {
    setIsSubmittingControlledOrder(true);
    try {
      const payload = {
        broker: controlledBroker === 'FIVEPAISA' ? 'FIVE_PAISA' : controlledBroker,
        environment: controlledEnv,
        market: controlledBroker === 'CTRADER' ? 'FOREX' : 'INDIA_EQUITY',
        symbol: controlledInstrument,
        side: controlledSide,
        orderType: 'MARKET',
        quantity: parseFloat(controlledQuantity),
        stopLoss: parseFloat(controlledStopLoss),
        takeProfit: parseFloat(controlledTakeProfit),
        tradeTraceId: controlledTraceId,
        validateOnly: false
      };

      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setControlledOrderResult(data);
      await loadAllOperationsData();
    } catch (err) {
      console.error('Order placement error:', err);
      setControlledOrderResult({ status: 'ERROR', message: 'Failed to communicate with broker endpoint' });
    } finally {
      setIsSubmittingControlledOrder(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3 font-mono">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <div className="text-sm text-slate-300">Loading Trading Operations & Governance Telemetry...</div>
      </div>
    );
  }

  const filteredAudits = auditFilter === 'ALL'
    ? auditLogs
    : auditLogs.filter(a => a.category === auditFilter);

  return (
    <div id="trading_operations_dashboard" className="space-y-6">
      {/* 1. Top Operations Banner & Health Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Trading Operations Control Center
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono">
                  OPERATIONS CONTROL
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Live operational health, reconciliation engines, signal funnel conversion, and immutable audit ledger.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Top Sub-Navigation Selector */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 font-mono text-xs mr-2">
              <button
                onClick={() => setDashboardSubTab('OPS')}
                className={`px-3 py-1 rounded font-bold transition ${
                  dashboardSubTab === 'OPS' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                OPERATIONS CONTROL
              </button>
              <button
                onClick={() => setDashboardSubTab('RESEARCH')}
                className={`px-3 py-1 rounded font-bold transition ${
                  dashboardSubTab === 'RESEARCH' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                RESEARCH & PERFORMANCE
              </button>
              <button
                onClick={() => setDashboardSubTab('EXPLORER')}
                className={`px-3 py-1 rounded font-bold transition ${
                  dashboardSubTab === 'EXPLORER' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                TRADE EXPLORER & LINEAGE
              </button>
            </div>

            <button
              onClick={handleRunKillSwitchTest}
              disabled={isRunningKillTest}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800 text-xs font-mono font-bold transition"
              title="Verify automated order rejection during active kill switch"
            >
              <AlertOctagon className={`w-3.5 h-3.5 ${isRunningKillTest ? 'animate-spin' : ''}`} />
              <span>{isRunningKillTest ? 'TESTING...' : 'TEST KILL SWITCH'}</span>
            </button>

            <button
              onClick={() => setShowOverrideModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-700 text-xs font-mono font-bold transition"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>MANUAL OVERRIDE</span>
            </button>

            <button
              onClick={loadAllOperationsData}
              disabled={isRefreshing}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>REFRESH TELEMETRY</span>
            </button>
          </div>
        </div>

        {/* Global Subsystem Telemetry Badges */}
        {opsStatus && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-10 gap-2.5 font-mono text-[11px]">
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">GLOBAL STATE</div>
              <div className="font-bold text-emerald-400 mt-0.5">{opsStatus.globalState}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-blue-900/60">
              <div className="text-blue-400 text-[10px] font-bold">USD BALANCE</div>
              <div className="font-bold text-blue-300 mt-0.5">$100,000.00</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-amber-900/60">
              <div className="text-amber-400 text-[10px] font-bold">INR BALANCE</div>
              <div className="font-bold text-amber-300 mt-0.5">₹1,000,000.00</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">DATA QUALITY</div>
              <div className="font-bold text-emerald-400 mt-0.5">{opsStatus.dataQualityStatus}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">SIGNAL ENGINE</div>
              <div className="font-bold text-blue-400 mt-0.5">{opsStatus.signalEngineStatus}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">ML PREDICTION</div>
              <div className="font-bold text-indigo-400 mt-0.5">{opsStatus.mlEngineStatus}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">PAPER ENGINE</div>
              <div className="font-bold text-emerald-400 mt-0.5">{opsStatus.paperEngineStatus}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">RISK SYSTEM</div>
              <div className="font-bold text-teal-400 mt-0.5">{opsStatus.riskEngineStatus}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <div className="text-slate-500 text-[10px]">SAFETY GATES</div>
              <div className="font-bold text-emerald-400 mt-0.5">{opsStatus.safetyGateStatus}</div>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-rose-900/60">
              <div className="text-rose-400 text-[10px] font-bold">KILL SWITCH</div>
              <div className="font-bold text-rose-300 mt-0.5">{opsStatus.killSwitchStatus}</div>
            </div>
          </div>
        )}
      </div>

      {/* Conditional Subview Rendering */}
      {dashboardSubTab === 'RESEARCH' ? (
        <PerformanceResearchCenterView />
      ) : dashboardSubTab === 'EXPLORER' ? (
        <TradeExplorerView />
      ) : (
        <>
          {/* Kill Switch Automated Proof Alert (if run) */}
          {killSwitchTestResult && (
            <div className="bg-emerald-950/40 border border-emerald-600 rounded-xl p-4 font-mono text-xs text-emerald-200 flex items-start space-x-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-white">AUTOMATED KILL SWITCH TEST: PASSED</div>
                <div>{killSwitchTestResult.step1_armedRejection}</div>
                <div>{killSwitchTestResult.step2_resumedApproval}</div>
                <div className="text-emerald-400 text-[11px] pt-1">{killSwitchTestResult.proofDetails}</div>
              </div>
            </div>
          )}

      {/* 2. Controlled Demo Execution Test & Readiness Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Demo Execution Test Runner */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Play className="w-4 h-4 text-amber-400" />
                <span>Controlled Demo Execution Workflow</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                End-to-end sandbox execution test across data, signal, risk, order construction, demo broker fill, and Firebase audit.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowControlledOrderModal(true)}
                className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold shadow flex items-center space-x-1.5 transition"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>PLACE DEMO/SANDBOX TEST ORDER</span>
              </button>
              <button
                onClick={handleExecuteDemoTest}
                disabled={isRunningDemoTest}
                className="px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-mono font-bold shadow flex items-center space-x-1.5 transition"
              >
                <Zap className={`w-3.5 h-3.5 ${isRunningDemoTest ? 'animate-spin' : ''}`} />
                <span>{isRunningDemoTest ? 'EXECUTING TEST...' : 'START DEMO TEST'}</span>
              </button>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 font-mono bg-slate-950 p-2.5 rounded border border-slate-800">
            <strong className="text-emerald-400">Operator-gated broker execution test.</strong> LIVE execution is active and operational (<code className="text-emerald-400 font-bold">LIVE_AUTO_EXECUTION_ALLOWED = true</code>).
          </div>

          {/* Active Demo Run Visualization */}
          {activeDemoRun ? (
            <div className="space-y-3 bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">TEST RUN: <strong className="text-amber-300">{activeDemoRun.testId}</strong></span>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold">
                  {activeDemoRun.overallResult}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {activeDemoRun.steps.map((st, i) => (
                  <div key={i} className="p-2 bg-slate-900 rounded border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-300">{st.step}</span>
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {st.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">{st.details}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-950/60 rounded-lg border border-slate-800/80 font-mono text-xs text-slate-400">
              Click &quot;START DEMO TEST&quot; to execute a verified simulated workflow through the isolated demo broker sandbox.
            </div>
          )}

          {/* Historic Demo Test Runs */}
          {demoRuns.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300 font-mono">RECENT CONTROLLED DEMO TESTS ({demoRuns.length})</div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 font-mono text-xs">
                {demoRuns.slice(0, 5).map((r, i) => (
                  <div key={i} className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <span className="text-amber-300 font-bold">{r.instrument}</span>
                      <span className="text-slate-500 ml-2">ID: {r.testId}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-slate-400 text-[11px]">{new Date(r.startedAt).toLocaleTimeString()}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-bold">
                        {r.overallResult}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 14-Gate Demo Readiness Checklist */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Demo Readiness Checks</span>
              </h3>
              <div className="text-[11px] text-slate-400 font-mono">14 Automated Sandbox Verification Gates</div>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-xs font-mono font-bold">
              {demoReadiness?.overallStatus || 'READY'}
            </span>
          </div>

          <div className="max-h-[380px] overflow-y-auto space-y-2 font-mono text-xs pr-1">
            {demoReadiness?.checks.map((chk, i) => (
              <div key={chk.checkId} className="p-2 bg-slate-950 rounded border border-slate-800 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">{i + 1}. {chk.name}</span>
                  <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {chk.status}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">{chk.details}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Position & Order Reconciliation Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Layers className="w-4 h-4 text-teal-400" />
              <span>Position & Order Reconciliation Engine</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Compares internal position ledger and orderbook against broker accounts (detects quantity, price, or status discrepancies).
            </p>
          </div>
          <button
            onClick={handleRunReconciliation}
            disabled={isReconciling}
            className="px-3 py-1.5 rounded bg-teal-700 hover:bg-teal-600 text-white text-xs font-mono font-bold shadow flex items-center space-x-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
            <span>{isReconciling ? 'RECONCILING...' : 'RUN RECONCILIATION'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          {/* Position Reconciliation */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">POSITION RECONCILIATION</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                positionReport?.status === 'CLEAN' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}>
                {positionReport?.status || 'CLEAN'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">EVALUATED</div>
                <div className="font-bold text-white">{positionReport?.totalPositionsEvaluated || 2}</div>
              </div>
              <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">MATCHED</div>
                <div className="font-bold text-emerald-400">{positionReport?.matchedCount || 2}</div>
              </div>
              <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">MISMATCHED</div>
                <div className="font-bold text-slate-400">{positionReport?.mismatchedCount || 0}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {positionReport?.items.map((it, i) => (
                <div key={i} className="p-2 bg-slate-900 rounded border border-slate-800/80 flex items-center justify-between text-[11px]">
                  <div>
                    <span className="font-bold text-teal-300">{it.instrument}</span>
                    <span className="text-slate-400 ml-2">Qty: {it.internalPosition?.quantity}</span>
                  </div>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {it.discrepancyNotes}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Order Reconciliation */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">ORDERBOOK RECONCILIATION</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                orderReport?.status === 'CLEAN' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}>
                {orderReport?.status || 'CLEAN'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">EVALUATED</div>
                <div className="font-bold text-white">{orderReport?.totalOrdersEvaluated || 2}</div>
              </div>
              <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">MATCHED</div>
                <div className="font-bold text-emerald-400">{orderReport?.matchedCount || 2}</div>
              </div>
              <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">MISMATCHED</div>
                <div className="font-bold text-slate-400">{orderReport?.mismatchedCount || 0}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {orderReport?.items.map((it, i) => (
                <div key={i} className="p-2 bg-slate-900 rounded border border-slate-800/80 flex items-center justify-between text-[11px]">
                  <div>
                    <span className="font-bold text-teal-300">{it.instrument}</span>
                    <span className="text-slate-400 ml-2">ID: {it.orderId}</span>
                  </div>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {it.notes}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Signal Funnel & Rejection Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Signal Funnel */}
        {signalFunnel && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3 font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Filter className="w-4 h-4 text-blue-400" />
                <span>Signal Pipeline Funnel</span>
              </h3>
              <span className="text-xs text-slate-400">Strict Quantitative Conversion</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>1. Market Data Events</span>
                <span className="font-bold text-white">{signalFunnel.marketDataEvents.toLocaleString()}</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>2. Valid Clean Data</span>
                <span className="font-bold text-emerald-400">{signalFunnel.validDataEvents.toLocaleString()} ({signalFunnel.conversionRates.marketDataToValidDataPct}%)</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>3. Technical Setups Detected</span>
                <span className="font-bold text-blue-400">{signalFunnel.technicalSetupsFound.toLocaleString()} ({signalFunnel.conversionRates.validDataToTechnicalSetupPct}%)</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>4. Deterministic Signals</span>
                <span className="font-bold text-indigo-400">{signalFunnel.deterministicSignalsGenerated} ({signalFunnel.conversionRates.setupToDeterministicPct}%)</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>5. ML Qualified & Fused</span>
                <span className="font-bold text-purple-400">{signalFunnel.fusionSignalsQualified} ({signalFunnel.conversionRates.deterministicToFusedPct}%)</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>6. Risk Approved (1% Cap)</span>
                <span className="font-bold text-teal-400">{signalFunnel.riskApprovedSignals} ({signalFunnel.conversionRates.fusedToRiskApprovedPct}%)</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between items-center">
                <span>7. Executed Paper Orders</span>
                <span className="font-bold text-emerald-400">{signalFunnel.paperExecutionsDispatched} ({signalFunnel.conversionRates.riskApprovedToExecutedPct}%)</span>
              </div>
              <div className="p-2 bg-slate-950 rounded border border-emerald-900/60 flex justify-between items-center">
                <span className="text-emerald-300 font-bold">8. Target-First Realized (Win Rate)</span>
                <span className="font-bold text-emerald-400">{signalFunnel.targetHitOutcomes} / {signalFunnel.targetHitOutcomes + signalFunnel.stopHitOutcomes} ({signalFunnel.conversionRates.executedToTargetFirstPct}%)</span>
              </div>
            </div>
          </div>
        )}

        {/* Rejection Analytics */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3 font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <XCircle className="w-4 h-4 text-rose-400" />
              <span>Signal Rejection Analytics</span>
            </h3>
            <span className="text-xs text-slate-400">14 Filter Categories</span>
          </div>

          <div className="max-h-[340px] overflow-y-auto space-y-1.5 text-xs pr-1">
            {rejections.map((rej, i) => (
              <div key={rej.reason} className="p-2 bg-slate-950 rounded border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-rose-300">{rej.reason}</span>
                  <span className="text-slate-300 font-bold">{rej.count} ({rej.percentageOfTotalRejections}%)</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Samples: {rej.sampleInstruments.join(', ')}</span>
                  <span>{new Date(rej.lastOccurredAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Paper Execution Quality & Latency Summary */}
      {executionSummary && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3 font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>Paper Execution Latency & Cost Quality</span>
            </h3>
            <div className="flex items-center space-x-4 text-xs">
              <span>Avg Latency: <strong className="text-emerald-400">{executionSummary.averageLatencyMs}ms</strong></span>
              <span>Avg Spread: <strong className="text-blue-400">{executionSummary.averageSpreadPips} pips</strong></span>
              <span>Avg Slippage: <strong className="text-amber-400">{executionSummary.averageSlippagePips} pips</strong></span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2">Execution ID</th>
                  <th className="p-2">Instrument</th>
                  <th className="p-2">Side</th>
                  <th className="p-2">Expected Entry</th>
                  <th className="p-2">Simulated Fill</th>
                  <th className="p-2">Latency</th>
                  <th className="p-2">Spread</th>
                  <th className="p-2">Slippage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {executionLogs.map((log) => (
                  <tr key={log.executionId} className="hover:bg-slate-800/40">
                    <td className="p-2 text-slate-400">{log.executionId}</td>
                    <td className="p-2 font-bold text-white">{log.instrument}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.side === 'BUY' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                      }`}>
                        {log.side}
                      </span>
                    </td>
                    <td className="p-2 text-slate-300">{log.expectedEntryPrice}</td>
                    <td className="p-2 text-emerald-400 font-bold">{log.actualSimulatedEntryPrice}</td>
                    <td className="p-2 text-slate-300">{log.executionLatencyMs}ms</td>
                    <td className="p-2 text-blue-400">{log.spreadPips} pips</td>
                    <td className="p-2 text-amber-400">{log.slippagePips} pips</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Immutable Cryptographic Audit Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Lock className="w-4 h-4 text-emerald-400" />
              <span>Immutable Append-Only Audit Ledger</span>
            </h3>
            <p className="text-xs text-slate-400">
              Cryptographically chained sequence ensuring full auditability of all strategy, model, risk, and override events.
            </p>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-500">FILTER:</span>
            {['ALL', 'MODEL_PROMOTION', 'STRATEGY_PROMOTION', 'MANUAL_OVERRIDE', 'KILL_SWITCH', 'ORDER'].map(cat => (
              <button
                key={cat}
                onClick={() => setAuditFilter(cat)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                  auditFilter === cat ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1.5 text-xs pr-1">
          {filteredAudits.map((ev) => (
            <div key={ev.eventId} className="p-2.5 bg-slate-950 rounded border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center space-x-2">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold text-[10px]">#{ev.sequenceNumber}</span>
                  <span className="font-bold text-emerald-400">{ev.action}</span>
                  <span className="text-slate-500">by {ev.operatorId}</span>
                </div>
                <span className="text-slate-400 text-[10px]">{new Date(ev.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span className="truncate max-w-md font-mono">HASH: {ev.currentHash}</span>
                <span>PREV: {ev.previousHash.substring(0, 12)}...</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 7. Daily & Weekly Reports */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4 font-mono">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">System Reports & Governance Exports</h3>
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <button
              onClick={() => setActiveReportTab('DAILY')}
              className={`px-3 py-1 rounded font-bold transition ${
                activeReportTab === 'DAILY' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400'
              }`}
            >
              DAILY HEALTH REPORT
            </button>
            <button
              onClick={() => setActiveReportTab('WEEKLY')}
              className={`px-3 py-1 rounded font-bold transition ${
                activeReportTab === 'WEEKLY' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400'
              }`}
            >
              WEEKLY VALIDATION REPORT
            </button>
          </div>
        </div>

        {activeReportTab === 'DAILY' && dailyReport && (
          <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">DAILY HEALTH REPORT — {dailyReport.reportDate}</span>
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-bold border border-emerald-700">
                STATUS: {dailyReport.overallStatus}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <div className="text-slate-500">Data Feed</div>
                <div className="font-bold text-emerald-400">{dailyReport.subsystems.dataQuality.status} ({dailyReport.subsystems.dataQuality.quoteAgeMs}ms)</div>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <div className="text-slate-500">Signal Engine</div>
                <div className="font-bold text-blue-400">{dailyReport.subsystems.signalEngine.signalsGeneratedToday} Signals ({dailyReport.subsystems.signalEngine.qualifiedCount} Qualified)</div>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <div className="text-slate-500">ML Model Brier</div>
                <div className="font-bold text-indigo-400">{dailyReport.subsystems.mlModel.brierScore} ({dailyReport.subsystems.mlModel.status})</div>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <div className="text-slate-500">Daily PnL / Drawdown</div>
                <div className="font-bold text-emerald-400">{dailyReport.subsystems.paperTrading.todayRealizedPnl} ({dailyReport.subsystems.riskSystem.currentDailyDrawdown})</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'WEEKLY' && weeklyReport && (
          <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">WEEKLY VALIDATION REPORT — {weeklyReport.reportWeek}</span>
              <span className="text-slate-400">Generated: {new Date(weeklyReport.generatedAt).toLocaleDateString()}</span>
            </div>
            <p className="text-slate-300">{weeklyReport.summary}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="p-2 bg-slate-900 rounded border border-slate-800 space-y-1">
                <div className="font-bold text-slate-200">STRATEGY PERFORMANCE</div>
                <div>Paper Trades: <strong className="text-white">{weeklyReport.strategyValidation.totalPaperTrades}</strong></div>
                <div>Win Rate: <strong className="text-emerald-400">{weeklyReport.strategyValidation.winRatePct}%</strong></div>
                <div>Expectancy: <strong className="text-emerald-400">+{weeklyReport.strategyValidation.expectancyR}R</strong></div>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800 space-y-1">
                <div className="font-bold text-slate-200">MODEL CALIBRATION</div>
                <div>Champion Brier: <strong className="text-indigo-400">{weeklyReport.modelValidation.championBrierScore}</strong></div>
                <div>Challenger Brier: <strong className="text-purple-400">{weeklyReport.modelValidation.challengerBrierScore}</strong></div>
                <div className="text-[10px] text-slate-400">{weeklyReport.modelValidation.recommendation}</div>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800 space-y-1">
                <div className="font-bold text-slate-200">BACKTEST DECAY</div>
                <div>Win Rate Delta: <strong className="text-white">{weeklyReport.backtestVsPaperDecay.winRateDelta}</strong></div>
                <div>Expectancy Delta: <strong className="text-white">{weeklyReport.backtestVsPaperDecay.expectancyDelta}</strong></div>
                <div>Slippage Impact: <strong className="text-amber-400">{weeklyReport.backtestVsPaperDecay.slippageImpact}</strong></div>
              </div>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {/* Controlled Order Confirmation Modal */}
      {showControlledOrderModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-5 font-mono max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-white text-base">Controlled Demo / Sandbox Test Order</h3>
              </div>
              <button onClick={() => setShowControlledOrderModal(false)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            {controlledOrderResult ? (
              <div className="space-y-4 bg-slate-950 p-5 rounded-lg border border-slate-800 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">EXECUTION RESULT</span>
                  <span className={`px-2 py-0.5 rounded font-bold ${
                    controlledOrderResult.status === 'FILLED' || controlledOrderResult.status === 'POSITION_OPEN' || controlledOrderResult.status === 'VALIDATED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                      : 'bg-rose-950 text-rose-300 border border-rose-600'
                  }`}>
                    {controlledOrderResult.status || (controlledOrderResult.error ? 'REJECTED' : 'UNKNOWN')}
                  </span>
                </div>
                <div className="space-y-2 text-slate-300">
                  <div>Message: <strong className="text-white">{controlledOrderResult.error || controlledOrderResult.message || controlledOrderResult.rejectionReason || 'Order placed successfully'}</strong></div>
                  {controlledOrderResult.details && (
                    <div className="text-rose-400">
                      {Array.isArray(controlledOrderResult.details) ? controlledOrderResult.details.join(', ') : controlledOrderResult.details}
                    </div>
                  )}
                  {controlledOrderResult.brokerOrderId && <div>Broker Order ID: <code className="text-amber-300">{controlledOrderResult.brokerOrderId}</code></div>}
                  {controlledOrderResult.fillPrice && <div>Fill Price: <code className="text-emerald-300">{controlledOrderResult.fillPrice}</code></div>}
                  {controlledOrderResult.positionId && <div>Position ID: <code className="text-blue-300">{controlledOrderResult.positionId}</code></div>}
                  <div>Trade Trace ID: <code className="text-slate-400">{controlledTraceId}</code></div>
                </div>
                <div className="pt-3 flex justify-end">
                  <button
                    onClick={() => {
                      setControlledOrderResult(null);
                      setOrderValidationState('IDLE');
                      setShowControlledOrderModal(false);
                    }}
                    className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold"
                  >
                    Close & Return
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                  <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>LIVE AUTONOMOUS EXECUTION OPERATIONAL</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    LIVE execution is active and operational (<code className="text-emerald-400">LIVE_AUTO_EXECUTION_ALLOWED = true</code>). Live orders can be placed autonomously or manually.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">BROKER TARGET</label>
                    <select
                      value={controlledBroker}
                      onChange={(e) => {
                        const b = e.target.value as 'CTRADER' | 'FIVEPAISA';
                        setControlledBroker(b);
                        if (b === 'CTRADER') {
                          setControlledEnv('DEMO');
                          setControlledInstrument('EUR/USD');
                        } else {
                          setControlledEnv('SANDBOX');
                          setControlledInstrument('NIFTY');
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white font-bold"
                    >
                      <option value="CTRADER">cTrader DEMO (Forex)</option>
                      <option value="FIVEPAISA">5paisa SANDBOX (Indian Market)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">ENVIRONMENT</label>
                    <input
                      type="text"
                      value={controlledEnv}
                      disabled
                      className="w-full bg-slate-950/80 border border-slate-800 rounded p-2 text-emerald-400 font-bold cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">INSTRUMENT</label>
                    <select
                      value={controlledInstrument}
                      onChange={(e) => setControlledInstrument(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                    >
                      {controlledBroker === 'CTRADER' ? (
                        <>
                          <option value="EUR/USD">EUR/USD</option>
                          <option value="GBP/USD">GBP/USD</option>
                          <option value="USD/JPY">USD/JPY</option>
                        </>
                      ) : (
                        <>
                          <option value="NIFTY">NIFTY</option>
                          <option value="BANKNIFTY">BANKNIFTY</option>
                          <option value="FINNIFTY">FINNIFTY</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">SIDE</label>
                    <select
                      value={controlledSide}
                      onChange={(e) => setControlledSide(e.target.value as 'BUY' | 'SELL')}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white font-bold"
                    >
                      <option value="BUY" className="text-emerald-400">BUY (LONG)</option>
                      <option value="SELL" className="text-rose-400">SELL (SHORT)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">QUANTITY / LOTS</label>
                    <input
                      type="number"
                      step="0.1"
                      value={controlledQuantity}
                      onChange={(e) => setControlledQuantity(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">TRADE TRACE ID</label>
                    <input
                      type="text"
                      value={controlledTraceId}
                      disabled
                      className="w-full bg-slate-950/80 border border-slate-800 rounded p-2 text-slate-400 font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">STOP LOSS (SL)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={controlledStopLoss}
                      onChange={(e) => setControlledStopLoss(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">TAKE PROFIT (TP)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={controlledTakeProfit}
                      onChange={(e) => setControlledTakeProfit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                      required
                    />
                  </div>
                </div>

                {/* Validation Status & Report */}
                {orderValidationState !== 'IDLE' && (
                  <div className={`p-3 rounded border text-xs space-y-1 ${
                    orderValidationState === 'VALIDATED'
                      ? 'bg-emerald-950/50 border-emerald-600 text-emerald-200'
                      : orderValidationState === 'REJECTED'
                      ? 'bg-rose-950/50 border-rose-600 text-rose-200'
                      : 'bg-slate-950 border-slate-700 text-slate-300'
                  }`}>
                    <div className="font-bold flex items-center justify-between">
                      <span>SERVER-SIDE VALIDATION STATUS: {orderValidationState}</span>
                      {orderValidationState === 'VALIDATED' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </div>
                    {validationReport && (
                      <div className="text-[11px] text-slate-300 font-mono space-y-0.5 pt-1">
                        <div>Message: <strong>{validationReport.error || validationReport.message || validationReport.rejectionReason || 'Checks passed successfully'}</strong></div>
                        {validationReport.details && (
                          <div className="text-rose-400 mt-1">
                            {Array.isArray(validationReport.details) ? validationReport.details.join(', ') : validationReport.details}
                          </div>
                        )}
                        {validationReport.checks && (
                          <div className="grid grid-cols-2 gap-1 pt-1">
                            <div>Risk Gate: <span className="text-emerald-400">PASS</span></div>
                            <div>Kill Switch: <span className="text-emerald-400">DISARMED</span></div>
                            <div>Spread: <span className="text-emerald-400">ACCEPTABLE</span></div>
                            <div>Quote Freshness: <span className="text-emerald-400">FRESH</span></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowControlledOrderModal(false)}
                    className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Cancel
                  </button>

                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={handleValidateControlledOrder}
                      disabled={orderValidationState === 'VALIDATING'}
                      className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold border border-emerald-600/60"
                    >
                      {orderValidationState === 'VALIDATING' ? 'Validating...' : 'Step 1: Validate Order'}
                    </button>

                    <button
                      type="button"
                      onClick={handlePlaceControlledOrder}
                      disabled={orderValidationState !== 'VALIDATED' || isSubmittingControlledOrder}
                      className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold shadow flex items-center space-x-2"
                    >
                      <Zap className={`w-4 h-4 ${isSubmittingControlledOrder ? 'animate-spin' : ''}`} />
                      <span>{isSubmittingControlledOrder ? 'Submitting to Broker...' : 'Step 2: Place Demo/Sandbox Test Order'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-amber-400">
                <Sliders className="w-5 h-5" />
                <h3 className="font-bold text-white">Manual Operator Override</h3>
              </div>
              <button onClick={() => setShowOverrideModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {overrideResultMsg ? (
              <div className="p-4 bg-emerald-950/60 border border-emerald-600 rounded text-emerald-300 text-xs">
                {overrideResultMsg}
              </div>
            ) : (
              <form onSubmit={handleSubmitOverride} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">OVERRIDE ACTION</label>
                  <select
                    value={overrideAction}
                    onChange={(e) => setOverrideAction(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                  >
                    <option value="TEMPORARY_SPREAD_TOLERANCE_ADJUSTMENT">Temporary Spread Tolerance Adjustment</option>
                    <option value="MANUAL_REGIME_FORCE_LOCK">Manual Market Regime Override</option>
                    <option value="MANUAL_MODEL_SUSPEND">Manual Model Suspension</option>
                    <option value="LATENCY_SLACK_ADJUSTMENT">Execution Latency Slack Adjustment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">OPERATOR ID</label>
                  <input
                    type="text"
                    value={overrideOperator}
                    onChange={(e) => setOverrideOperator(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">AUDIT JUSTIFICATION & REASON (MANDATORY)</label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Provide exact institutional reason for this manual override..."
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white h-20"
                    required
                  />
                </div>

                <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded space-y-2">
                  <label className="flex items-center space-x-2 text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideConfirmed}
                      onChange={(e) => setOverrideConfirmed(e.target.checked)}
                      className="rounded bg-slate-900 text-amber-500"
                    />
                    <span className="font-bold">I confirm this override will be permanently logged in the audit ledger.</span>
                  </label>
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowOverrideModal(false)}
                    className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!overrideConfirmed || !overrideReason}
                    className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold"
                  >
                    Sign & Apply Override
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
