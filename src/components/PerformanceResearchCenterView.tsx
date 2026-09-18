import React, { useState, useEffect } from 'react';
import {
  BarChart2,
  TrendingUp,
  Brain,
  ShieldCheck,
  DollarSign,
  Activity,
  Layers,
  Filter,
  Flame,
  Award,
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
  PlusCircle,
  Database,
  Lock
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend
} from 'recharts';

export const PerformanceResearchCenterView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'performance' | 'signals' | 'model' | 'strategy' | 'costs' | 'dataQuality' | 'experiments' | 'dailySummary'
  >('performance');

  const [execEnv, setExecEnv] = useState<'PAPER' | 'DEMO' | 'SANDBOX'>('PAPER');
  const [selectedInstrument, setSelectedInstrument] = useState<string>('ALL');
  const [reportingCurrency, setReportingCurrency] = useState<'USD' | 'INR'>('USD');

  // Metrics State
  const [metrics, setMetrics] = useState<any>(null);
  const [signalBuckets, setSignalBuckets] = useState<any[]>([]);
  const [modelTelemetry, setModelTelemetry] = useState<any>(null);
  const [dataQualityReport, setDataQualityReport] = useState<any>(null);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any>(null);
  const [consolidatedReport, setConsolidatedReport] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // New Experiment Form State
  const [showNewExpModal, setShowNewExpModal] = useState<boolean>(false);
  const [expName, setExpName] = useState<string>('');
  const [expHypothesis, setExpHypothesis] = useState<string>('');
  const [expCreatedBy, setExpCreatedBy] = useState<string>('QUANT_RESEARCHER_1');

  const fetchResearchData = async () => {
    setIsLoading(true);
    try {
      const [
        metricsRes,
        bucketsRes,
        modelRes,
        dataQualRes,
        expRes,
        summaryRes,
        pnlRes
      ] = await Promise.all([
        fetch(`/api/governance/research/metrics?env=${execEnv}&instrument=${selectedInstrument}`),
        fetch('/api/governance/research/buckets'),
        fetch('/api/governance/research/model-telemetry'),
        fetch('/api/governance/data-quality'),
        fetch('/api/governance/research/experiments'),
        fetch('/api/governance/daily-summary'),
        fetch(`/api/governance/accounting/consolidated-pnl?reportingCurrency=${reportingCurrency}`)
      ]);

      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (bucketsRes.ok) setSignalBuckets(await bucketsRes.json());
      if (modelRes.ok) setModelTelemetry(await modelRes.json());
      if (dataQualRes.ok) setDataQualityReport(await dataQualRes.json());
      if (expRes.ok) setExperiments(await expRes.json());
      if (summaryRes.ok) setDailySummary(await summaryRes.json());
      if (pnlRes.ok) setConsolidatedReport(await pnlRes.json());
    } catch (err) {
      console.error('Failed to load research data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchResearchData();
  }, [execEnv, selectedInstrument, reportingCurrency]);

  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expName || !expHypothesis) return;

    try {
      const res = await fetch('/api/governance/research/experiments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experimentName: expName,
          hypothesis: expHypothesis,
          createdBy: expCreatedBy,
          datasetVersion: 'v1.1.0',
          featureVersion: 'v1.1.0',
          modelVersion: 'gbt_forex_v1.1.0_challenger',
          strategyVersion: 'v2.1.0',
          targetMarket: 'FOREX',
          targetInstrument: 'EUR/USD',
          executionMode: execEnv,
          hyperparameters: { maxDepth: 4, nEstimators: 40, learningRate: 0.05 }
        })
      });

      if (res.ok) {
        setShowNewExpModal(false);
        setExpName('');
        setExpHypothesis('');
        await fetchResearchData();
      }
    } catch (err) {
      console.error('Failed to create research experiment:', err);
    }
  };

  if (isLoading && !metrics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-3 font-mono">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        <div className="text-xs text-slate-300">Loading Research & Performance Telemetry...</div>
      </div>
    );
  }

  return (
    <div id="performance_research_center" className="space-y-4 font-mono text-xs text-slate-100">
      {/* Top Banner & Execution Filter */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Award className="w-5 h-5 text-purple-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Performance & Quantitative Research Center
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                POST-RELEASE VERIFIED
              </span>
            </div>
            <p className="text-slate-400 text-[11px]">
              Firebase-backed quantitative research workspace. Evaluates performance, model calibration, signal quality, and execution costs.
            </p>
          </div>

          {/* Execution Environment Selector (Strictly PAPER / DEMO / SANDBOX) */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <span className="text-slate-500 px-2 text-[10px] uppercase font-bold">MODE:</span>
              {(['PAPER', 'DEMO', 'SANDBOX'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setExecEnv(mode)}
                  className={`px-3 py-1 rounded font-bold transition ${
                    execEnv === mode
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode === 'SANDBOX' ? '5PAISA SANDBOX' : mode === 'DEMO' ? 'cTRADER DEMO' : 'PAPER'}
                </button>
              ))}
            </div>

            <button
              onClick={fetchResearchData}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center space-x-1 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs (2-row 4-column grid, no overflow scroll) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-800/80">
          {[
            { id: 'performance', label: 'Performance Metrics', icon: TrendingUp },
            { id: 'signals', label: 'Signal Quality & Buckets', icon: BarChart2 },
            { id: 'model', label: 'Model Monitoring', icon: Brain },
            { id: 'strategy', label: 'Strategy Analytics', icon: Layers },
            { id: 'costs', label: 'Cost & Execution', icon: DollarSign },
            { id: 'dataQuality', label: 'Data Quality', icon: Database },
            { id: 'experiments', label: 'Research Experiments', icon: Activity },
            { id: 'dailySummary', label: 'Daily Operations', icon: FileSpreadsheet }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center justify-center space-x-1.5 px-2.5 py-2 rounded-lg font-bold transition text-center ${
                  isSel
                    ? 'bg-purple-900/60 text-purple-300 border border-purple-700/80'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. PERFORMANCE METRICS SUBVIEW */}
      {activeTab === 'performance' && metrics && (
        <div className="space-y-4">
          {/* Multi-Currency Consolidation Panel */}
          <div className="bg-slate-900 border border-purple-900/60 rounded-xl p-4 shadow space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <span>Multi-Currency Accounting & Consolidation Layer</span>
                </h3>
                <p className="text-slate-400 text-[11px]">
                  Native-currency accounting preserved. FOREX natively in USD ($), Indian Markets natively in INR (₹).
                </p>
              </div>

              {/* Reporting Currency Switcher */}
              <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold px-1 uppercase">REPORT IN:</span>
                <button
                  onClick={() => setReportingCurrency('USD')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                    reportingCurrency === 'USD' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  $ USD
                </button>
                <button
                  onClick={() => setReportingCurrency('INR')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                    reportingCurrency === 'INR' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ₹ INR
                </button>
              </div>
            </div>

            {consolidatedReport && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* FOREX Native USD Card */}
                <div className="bg-slate-950 p-3 rounded-lg border border-blue-900/50 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-bold">FOREX (NATIVE USD)</span>
                    <span className="bg-blue-950 text-blue-300 border border-blue-800 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      $ USD NATIVE
                    </span>
                  </div>
                  <div className="text-xl font-bold text-blue-400">
                    ${consolidatedReport.nativeSubtotals.USD.netPnL.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400 flex justify-between">
                    <span>Gross: ${consolidatedReport.nativeSubtotals.USD.grossPnL.toLocaleString()}</span>
                    <span>Costs: ${consolidatedReport.nativeSubtotals.USD.costs.toLocaleString()}</span>
                  </div>
                </div>

                {/* Indian Markets Native INR Card */}
                <div className="bg-slate-950 p-3 rounded-lg border border-amber-900/50 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-bold">INDIAN MARKETS (NATIVE INR)</span>
                    <span className="bg-amber-950 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      ₹ INR NATIVE
                    </span>
                  </div>
                  <div className="text-xl font-bold text-amber-400">
                    ₹{consolidatedReport.nativeSubtotals.INR.netPnL.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400 flex justify-between">
                    <span>Gross: ₹{consolidatedReport.nativeSubtotals.INR.grossPnL.toLocaleString()}</span>
                    <span>Costs: ₹{consolidatedReport.nativeSubtotals.INR.costs.toLocaleString()}</span>
                  </div>
                </div>

                {/* Consolidated Total Card */}
                <div className="bg-slate-950 p-3 rounded-lg border border-emerald-900/50 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-bold">CONSOLIDATED ({reportingCurrency})</span>
                    <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      CONVERTED VIEW
                    </span>
                  </div>
                  <div className="text-xl font-bold text-emerald-400">
                    {reportingCurrency === 'INR' ? '₹' : '$'}
                    {consolidatedReport.consolidatedNetPnL.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400 flex flex-col space-y-0.5">
                    <div className="flex justify-between">
                      <span>FX Rate: 1 USD = 86.50 INR</span>
                      <span className="text-amber-300 font-bold">Status: REFERENCE</span>
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-500">
                      <span>Source: RBI benchmark/reference</span>
                      <span>Live FX: NOT_CONFIGURED</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Realized Win Rate</span>
              <div className="text-2xl font-bold text-emerald-400 mt-1">
                {(metrics.winRate * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {metrics.wins} Wins / {metrics.losses} Losses ({metrics.totalTrades} total)
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Profit Factor (Net)</span>
              <div className="text-2xl font-bold text-cyan-400 mt-1">
                {metrics.profitFactor}x
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Expectancy: +{metrics.expectancyR}R per trade
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Sharpe / Sortino</span>
              <div className="text-2xl font-bold text-purple-400 mt-1">
                {metrics.sharpeRatio} / {metrics.sortinoRatio}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Risk-adjusted return ratios
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Net Profit & Drawdown</span>
              <div className="text-2xl font-bold text-emerald-400 mt-1">
                ${metrics.netProfit.toLocaleString()}
              </div>
              <div className="text-[10px] text-rose-400 mt-0.5">
                Max Drawdown: -{metrics.maxDrawdownPct}%
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
            <h3 className="text-xs font-bold text-white uppercase">Detailed Performance Summary ({execEnv})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 text-[10px]">Gross Profit:</span>
                <div className="font-bold text-emerald-400">${metrics.grossProfit.toLocaleString()}</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 text-[10px]">Gross Loss:</span>
                <div className="font-bold text-rose-400">${metrics.grossLoss.toLocaleString()}</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 text-[10px]">Transaction Costs:</span>
                <div className="font-bold text-amber-400">${metrics.transactionCosts.toLocaleString()}</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 text-[10px]">Avg Latency / Slippage:</span>
                <div className="font-bold text-cyan-400">{metrics.avgLatencyMs}ms / {metrics.avgSlippagePips} pips</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. SIGNAL QUALITY & CONFIDENCE BUCKETS */}
      {activeTab === 'signals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-white uppercase flex items-center space-x-1.5">
              <BarChart2 className="w-4 h-4 text-emerald-400" />
              <span>Signal Quality & Confidence Bucket Performance</span>
            </h3>
            <span className="text-[10px] text-slate-400">Model Confidence Calibration</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2.5">Confidence Bucket</th>
                  <th className="p-2.5">Generated</th>
                  <th className="p-2.5">Qualified</th>
                  <th className="p-2.5">Executed</th>
                  <th className="p-2.5">Wins / Losses</th>
                  <th className="p-2.5">Realized Win Rate</th>
                  <th className="p-2.5">Expectancy R</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {signalBuckets.map((b) => (
                  <tr key={b.confidenceBucket} className="hover:bg-slate-800/40">
                    <td className="p-2.5 font-bold text-purple-300">{b.confidenceBucket}</td>
                    <td className="p-2.5">{b.totalSignals}</td>
                    <td className="p-2.5 text-blue-400">{b.qualifiedCount}</td>
                    <td className="p-2.5 text-indigo-400">{b.executedCount}</td>
                    <td className="p-2.5 text-slate-300">{b.realizedWins}W / {b.realizedLosses}L</td>
                    <td className="p-2.5 text-emerald-400 font-bold">
                      {b.executedCount > 0 ? `${(b.realizedWinRate * 100).toFixed(1)}%` : 'N/A'}
                    </td>
                    <td className="p-2.5 text-amber-400 font-bold">
                      {b.executedCount > 0 ? `+${b.expectancyR}R` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. MODEL MONITORING & CALIBRATION */}
      {activeTab === 'model' && modelTelemetry && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Brier Score</span>
              <div className="text-2xl font-bold text-amber-400 mt-1">{modelTelemetry.brierScore}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Lower = tighter calibration</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Log Loss</span>
              <div className="text-2xl font-bold text-purple-400 mt-1">{modelTelemetry.logLoss}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Cross-entropy loss</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Calibration Slope</span>
              <div className="text-2xl font-bold text-emerald-400 mt-1">{modelTelemetry.calibrationSlope}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Target = 1.0</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[10px] text-slate-400 uppercase">Inferences Evaluated</span>
              <div className="text-2xl font-bold text-cyan-400 mt-1">{modelTelemetry.totalInferenceCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Rejected: {modelTelemetry.rejectedPredictionsCount}</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
            <h3 className="text-xs font-bold text-white uppercase">Predicted Probability vs Realized Win Rate</h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelTelemetry.predictedVsRealizedWinRate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="predictedBin" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" unit="%" />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
                  <Bar dataKey="realizedWinRate" name="Realized Win Rate" fill="#10b981" />
                  <Bar dataKey="avgPredictedProb" name="Avg Predicted Prob" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* 4. STRATEGY ANALYTICS */}
      {activeTab === 'strategy' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <h3 className="text-xs font-bold text-white uppercase flex items-center space-x-1.5">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Active Strategy Analytics (`forex_trend_continuation_v2`)</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400 text-[10px]">Strategy ID:</span>
              <div className="font-bold text-purple-300">forex_trend_continuation_v2</div>
            </div>
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400 text-[10px]">Avg Holding Time:</span>
              <div className="font-bold text-cyan-300">45 minutes (3 candles)</div>
            </div>
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400 text-[10px]">Risk / Reward Ratio:</span>
              <div className="font-bold text-emerald-400">1 : 2.0</div>
            </div>
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400 text-[10px]">Max Consecutive Losses:</span>
              <div className="font-bold text-rose-400">2 losses</div>
            </div>
          </div>
        </div>
      )}

      {/* 5. DATA QUALITY CENTER */}
      {activeTab === 'dataQuality' && dataQualityReport && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-white uppercase flex items-center space-x-1.5">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>Data Quality Center & Feed Continuity</span>
            </h3>
            <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
              STATUS: {dataQualityReport.status}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Missing Candles:</span>
              <div className="font-bold text-emerald-400 text-lg">{dataQualityReport.missingCandlesCount}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Duplicate Timestamps:</span>
              <div className="font-bold text-emerald-400 text-lg">{dataQualityReport.duplicateTimestampsCount}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Stale Feed Events:</span>
              <div className="font-bold text-emerald-400 text-lg">{dataQualityReport.staleFeedCount}</div>
            </div>
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Invalid OHLC:</span>
              <div className="font-bold text-emerald-400 text-lg">{dataQualityReport.invalidOhlcCount}</div>
            </div>
          </div>

          <div className="space-y-2">
            <span className="font-bold text-slate-300">Monitored Feed Continuity:</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {dataQualityReport.monitoredInstruments.map((inst: any) => (
                <div key={inst.symbol} className="bg-slate-950 p-2.5 rounded border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-white">{inst.symbol}</span>
                    <div className="text-[10px] text-slate-500">Age: {inst.lastQuoteAgeMs}ms</div>
                  </div>
                  <span className="text-emerald-400 font-bold">{inst.candleContinuityScorePct}% Score</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. RESEARCH EXPERIMENTS & ISOLATION */}
      {activeTab === 'experiments' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-white uppercase flex items-center space-x-1.5">
              <Activity className="w-4 h-4 text-purple-400" />
              <span>Isolated Research Experiments</span>
            </h3>
            <button
              onClick={() => setShowNewExpModal(true)}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold text-xs flex items-center space-x-1 transition"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>NEW EXPERIMENT</span>
            </button>
          </div>

          <div className="space-y-3">
            {experiments.map((exp) => (
              <div key={exp.experimentId} className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-bold text-purple-300">{exp.experimentName}</span>
                    <div className="text-[10px] text-slate-500">ID: {exp.experimentId} | Created by {exp.createdBy}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px] font-bold">
                    {exp.status}
                  </span>
                </div>
                <p className="text-slate-300 text-[11px] bg-slate-900 p-2 rounded">
                  <strong>Hypothesis:</strong> {exp.hypothesis}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                  <span>Model: {exp.modelVersion}</span>
                  <span>Feature: {exp.featureVersion}</span>
                  <span>Dataset: {exp.datasetVersion}</span>
                  <span>Mode: {exp.executionMode}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. DAILY OPERATIONS SUMMARY */}
      {activeTab === 'dailySummary' && dailySummary && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-white uppercase flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Daily Operations Summary — {dailySummary.reportDate}</span>
            </h3>
            <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950 border border-emerald-800 px-2.5 py-0.5 rounded">
              SAFETY: {dailySummary.safetyInvariantStatus}
            </span>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-xs">
            <div className="font-bold text-white">System Health Overview:</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div>App: <strong className="text-emerald-400">{dailySummary.systemHealthOverview.appStatus}</strong></div>
              <div>API: <strong className="text-emerald-400">{dailySummary.systemHealthOverview.apiStatus}</strong></div>
              <div>Firebase: <strong className="text-emerald-400">{dailySummary.systemHealthOverview.firebaseStatus}</strong></div>
              <div>Uptime: <strong className="text-cyan-400">{dailySummary.systemHealthOverview.uptimeSeconds}s</strong></div>
            </div>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-xs">
            <div className="font-bold text-white">Operator Recommendations:</div>
            <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
              {dailySummary.operatorRecommendations.map((rec: string, i: number) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* New Experiment Modal */}
      {showNewExpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white uppercase">Create Research Experiment</h3>

            <form onSubmit={handleCreateExperiment} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Experiment Name:</label>
                <input
                  type="text"
                  value={expName}
                  onChange={(e) => setExpName(e.target.value)}
                  placeholder="e.g. Feature Importance Sensitivity Test"
                  className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Hypothesis:</label>
                <textarea
                  value={expHypothesis}
                  onChange={(e) => setExpHypothesis(e.target.value)}
                  placeholder="e.g. Adding Orderbook Imbalance feature reduces false breakouts..."
                  className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded focus:outline-none focus:border-purple-500 h-20"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewExpModal(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold"
                >
                  Create Isolated Experiment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
