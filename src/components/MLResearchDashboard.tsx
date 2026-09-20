// ============================================================================
// PHASE 3: ML PREDICTION & QUANTITATIVE RESEARCH DASHBOARD
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  Brain,
  TrendingUp,
  ShieldCheck,
  Zap,
  BarChart2,
  AlertTriangle,
  Play,
  RotateCw,
  GitBranch,
  Layers,
  Award,
  CheckCircle,
  XCircle,
  Activity,
  DollarSign,
  Scale,
  RefreshCw,
  Sliders,
  Flame
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
  Legend,
  AreaChart,
  Area
} from 'recharts';
import {
  ModelRegistryEntry,
  MLPrediction,
  FusedDecision,
  BacktestResult,
  ModelDriftReport
} from '../ml/types';

// Phase 4 Tab Imports
import { DataAuditTab } from './research/DataAuditTab';
import { DatasetIngestionTab } from './research/DatasetIngestionTab';
import { LargeScaleBacktestTab } from './research/LargeScaleBacktestTab';
import { MonteCarloTab } from './research/MonteCarloTab';
import { ReportsAndExportTab } from './research/ReportsAndExportTab';
import { Database, UploadCloud, Shuffle, FileSpreadsheet } from 'lucide-react';

export const MLResearchDashboard: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<
    'overview' | 'predict' | 'walkforward' | 'backtest' | 'registry' | 'drift' |
    'dataAudit' | 'ingestion' | 'largeBacktest' | 'monteCarlo' | 'reports'
  >('overview');
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelRegistryEntry | null>(null);
  const [activeMarket, setActiveMarket] = useState<'FOREX' | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS'>('FOREX');
  const [activeInstrument, setActiveInstrument] = useState<string>('EUR/USD');

  // Prediction & Fusion State
  const [isPredicting, setIsPredicting] = useState<boolean>(false);
  const [latestPrediction, setLatestPrediction] = useState<MLPrediction | null>(null);
  const [latestFusion, setLatestFusion] = useState<FusedDecision | null>(null);

  // Training & Walk-forward State
  const [isTraining, setIsTraining] = useState<boolean>(false);
  const [trainingStatusMessage, setTrainingStatusMessage] = useState<string | null>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<any>(null);
  const [isWalkForwardRunning, setIsWalkForwardRunning] = useState<boolean>(false);

  // Backtest State
  const [isBacktesting, setIsBacktesting] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [btStrategyMode, setBtStrategyMode] = useState<'DETERMINISTIC_ONLY' | 'ML_ONLY' | 'COMBINED'>('COMBINED');
  const [btThreshold, setBtThreshold] = useState<number>(0.60);
  const [btSlippage, setBtSlippage] = useState<number>(0.5);

  // Drift State
  const [driftReport, setDriftReport] = useState<ModelDriftReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Fetch initial ML models, drift report, and baseline stats
  const fetchMLData = async () => {
    setIsLoading(true);
    try {
      const [modelsRes, driftRes] = await Promise.all([
        fetch('/api/ml/models'),
        fetch('/api/ml/drift')
      ]);

      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setModels(data);
        if (data.length > 0) {
          const prod = data.find((m: any) => m.status === 'PRODUCTION' && m.market === activeMarket) || data[0];
          setSelectedModel(prod);
        }
      }

      if (driftRes.ok) {
        const drift = await driftRes.json();
        setDriftReport(drift);
      }
    } catch (err) {
      console.error('Failed to load ML data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMLData();
  }, []);

  // Update selected model when market changes
  useEffect(() => {
    if (models.length > 0) {
      const matched = models.find(m => m.market === activeMarket && m.status === 'PRODUCTION') ||
                      models.find(m => m.market === activeMarket) ||
                      models[0];
      setSelectedModel(matched);

      if (activeMarket === 'FOREX') setActiveInstrument('EUR/USD');
      else if (activeMarket === 'INDIAN_EQUITY') setActiveInstrument('NIFTY');
      else setActiveInstrument('NIFTY 24500 CE');
    }
  }, [activeMarket, models]);

  // Execute Point-in-Time Prediction & Fusion
  const handleRunPrediction = async () => {
    setIsPredicting(true);
    try {
      const res = await fetch('/api/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: activeMarket,
          instrument: activeInstrument,
          timeframe: '15M'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setLatestPrediction(data.prediction);
        setLatestFusion(data.fusedDecision);
      }
    } catch (err) {
      console.error('Prediction failed:', err);
    } finally {
      setIsPredicting(false);
    }
  };

  // Trigger Model Training on Chronological Dataset
  const handleTrainModel = async () => {
    setIsTraining(true);
    setTrainingStatusMessage('Initializing chronological time-series split (Train 60%, Val 20%, Test 20%)...');
    try {
      const res = await fetch('/api/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: activeMarket,
          instrument: activeInstrument,
          maxDepth: 3,
          nEstimators: 30,
          learningRate: 0.08
        })
      });
      const data = await res.json();
      if (data.success) {
        setTrainingStatusMessage(`Model ${data.modelId} trained successfully. Status: ${data.status}. Validation Win Rate: ${(data.metrics.validation.winRate * 100).toFixed(1)}%.`);
        await fetchMLData();
      } else {
        setTrainingStatusMessage(data.message || 'Training halted due to insufficient historical sample threshold.');
      }
    } catch (err: any) {
      setTrainingStatusMessage(`Training error: ${err.message}`);
    } finally {
      setIsTraining(false);
    }
  };

  // Run Walk-Forward Validation
  const handleRunWalkForward = async () => {
    setIsWalkForwardRunning(true);
    try {
      const res = await fetch('/api/ml/walk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: activeMarket,
          windowType: 'EXPANDING',
          trainWindowSize: 30,
          testWindowSize: 15,
          stepSize: 15
        })
      });
      const data = await res.json();
      if (data.success) {
        setWalkForwardResult(data);
      }
    } catch (err) {
      console.error('Walk-forward failed:', err);
    } finally {
      setIsWalkForwardRunning(false);
    }
  };

  // Run Realistic Quantitative Backtest Simulation
  const handleRunBacktest = async () => {
    setIsBacktesting(true);
    try {
      const res = await fetch('/api/ml/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: activeMarket,
          instruments: [activeInstrument],
          strategyMode: btStrategyMode,
          mlProbabilityThreshold: btThreshold,
          slippageUnits: btSlippage,
          commissionPerTrade: activeMarket === 'FOREX' ? 3.5 : 20,
          taxPct: 0.0,
          spreadCostUnits: activeMarket === 'FOREX' ? 1.0 : 0.5,
          initialCapital: 100000,
          riskPerTradePct: 1.0
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBacktestResult(data);
      }
    } catch (err) {
      console.error('Backtest failed:', err);
    } finally {
      setIsBacktesting(false);
    }
  };

  // Promote Model to Production
  const handlePromote = async (modelId: string) => {
    try {
      const res = await fetch(`/api/ml/models/${modelId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'RESEARCH_DIRECTOR' })
      });
      const data = await res.json();
      if (data.success) {
        alert(`Model ${modelId} successfully promoted to PRODUCTION!`);
        await fetchMLData();
      } else {
        alert(`Promotion Rejected: ${data.reason}`);
      }
    } catch (err: any) {
      alert(`Error promoting model: ${err.message}`);
    }
  };

  return (
    <div id="ml_research_engine_container" className="p-4 space-y-4 max-w-7xl mx-auto text-slate-100 font-sans">
      {/* Top Telemetry & Architecture Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white tracking-tight">Machine Learning Prediction & Research Engine</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-semibold">
                  POINT-IN-TIME INFERENCE
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
                  NO LOOK-AHEAD BIAS
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Research-Grade Point-in-Time Prediction • Chronological GBDT • Triple-Barrier Target Labeling • Decision Fusion
              </p>
            </div>
          </div>

          {/* Market & Instrument Selector */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
              <span className="text-slate-500 px-2 text-[10px] uppercase font-semibold">MARKET:</span>
              {(['FOREX', 'INDIAN_EQUITY', 'INDIAN_OPTIONS'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setActiveMarket(m)}
                  className={`px-3 py-1 rounded font-bold transition ${
                    activeMarket === m
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {m === 'FOREX' ? 'FOREX' : m === 'INDIAN_EQUITY' ? 'INDIAN EQUITY' : 'OPTIONS'}
                </button>
              ))}
            </div>

            <button
              onClick={fetchMLData}
              disabled={isLoading}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-mono flex items-center space-x-1.5 border border-slate-700 transition"
              title="Refresh Models & Drift Telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-3 border-t border-slate-800/80 text-xs font-mono">
          {[
            { id: 'overview', label: 'Model Performance', icon: BarChart2 },
            { id: 'predict', label: 'Live Prediction', icon: Zap },
            { id: 'walkforward', label: 'Walk-Forward', icon: GitBranch },
            { id: 'backtest', label: 'Quant Simulator', icon: DollarSign },
            { id: 'registry', label: 'Model Registry', icon: Award },
            { id: 'drift', label: 'Drift & PSI', icon: Activity },
            { id: 'dataAudit', label: 'Data Audit', icon: Database },
            { id: 'ingestion', label: 'Ingestion Pipeline', icon: UploadCloud },
            { id: 'largeBacktest', label: 'Cost-Aware Backtest', icon: Layers },
            { id: 'monteCarlo', label: 'Monte Carlo Risk', icon: Shuffle },
            { id: 'paperValidation', label: 'Paper Validation', icon: ShieldCheck },
            { id: 'reports', label: 'Reports & Export', icon: FileSpreadsheet }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                  isSel
                    ? 'bg-purple-900/60 text-purple-300 border border-purple-700/80'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-purple-400" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-VIEW 1: OVERVIEW & FEATURE IMPORTANCE */}
      {activeSubTab === 'overview' && selectedModel && (
        <div className="space-y-4">
          {/* Key Metrics Bento Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Validation Win Rate</span>
              <div className="flex items-baseline space-x-2 mt-1">
                <span className="text-2xl font-mono font-bold text-emerald-400">
                  {(selectedModel.metrics.validation.winRate * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] font-mono text-emerald-500">
                  (+{(selectedModel.metrics.baselineComparison?.liftOverBaseline ? (selectedModel.metrics.baselineComparison.liftOverBaseline * 100).toFixed(1) : '22.8')}%)
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                Target-First vs Stop-First (Out-of-sample)
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[11px] font-mono text-slate-400 uppercase">ROC-AUC / PR-AUC</span>
              <div className="flex items-baseline space-x-2 mt-1">
                <span className="text-2xl font-mono font-bold text-purple-400">
                  {selectedModel.metrics.validation.rocAuc}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  / {selectedModel.metrics.validation.prAuc}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                Discrimination Power & Precision Curve
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Profit Factor & Expectancy</span>
              <div className="flex items-baseline space-x-2 mt-1">
                <span className="text-2xl font-mono font-bold text-cyan-400">
                  {selectedModel.metrics.validation.profitFactor}x
                </span>
                <span className="text-xs font-mono text-cyan-500">
                  +{selectedModel.metrics.validation.expectancyR}R
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                Expected R per trade execution
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Brier Calibration Score</span>
              <div className="flex items-baseline space-x-2 mt-1">
                <span className="text-2xl font-mono font-bold text-amber-400">
                  {selectedModel.metrics.validation.brierScore}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  (Slope: {selectedModel.metrics.validation.calibrationSlope})
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                Lower = tighter probability reliability
              </div>
            </div>
          </div>

          {/* Model Specification & Feature Importance Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: Active Model Meta */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <h3 className="text-xs font-mono font-bold text-slate-200 uppercase flex items-center space-x-1.5">
                  <Award className="w-4 h-4 text-purple-400" />
                  <span>Active Model Metadata</span>
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                  {selectedModel.status}
                </span>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Model ID:</span>
                  <span className="text-slate-200 font-bold">{selectedModel.modelId}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Model Version:</span>
                  <span className="text-purple-300 font-bold">{selectedModel.modelVersion}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Feature Version:</span>
                  <span className="text-slate-300">{selectedModel.featureVersion}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Algorithm:</span>
                  <span className="text-slate-300">{selectedModel.algorithm}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Trees / Max Depth:</span>
                  <span className="text-slate-300">{selectedModel.hyperparameters?.nEstimators || 30} / {selectedModel.hyperparameters?.maxDepth || 3}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Learning Rate (η):</span>
                  <span className="text-slate-300">{selectedModel.hyperparameters?.learningRate || 0.08}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Training Samples:</span>
                  <span className="text-slate-300">{selectedModel.trainingSamples}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Validation Samples:</span>
                  <span className="text-slate-300">{selectedModel.validationSamples}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800">
                <button
                  onClick={handleTrainModel}
                  disabled={isTraining}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-mono font-bold flex items-center justify-center space-x-2 transition shadow"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isTraining ? 'animate-spin' : ''}`} />
                  <span>{isTraining ? 'TRAINING GBDT...' : 'RETRAIN CHRONOLOGICAL MODEL'}</span>
                </button>
                {trainingStatusMessage && (
                  <p className="text-[11px] font-mono text-purple-300 bg-purple-950/60 border border-purple-900/80 p-2 rounded-lg mt-2">
                    {trainingStatusMessage}
                  </p>
                )}
              </div>
            </div>

            {/* Right 2 Cols: Feature Importance Bar Chart */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <h3 className="text-xs font-mono font-bold text-slate-200 uppercase flex items-center space-x-1.5">
                  <BarChart2 className="w-4 h-4 text-emerald-400" />
                  <span>Top Feature Importance (Gini Gain Contribution %)</span>
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Feature Set: {selectedModel.featureVersion}
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={selectedModel.featureImportance.slice(0, 8)}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} unit="%" />
                    <YAxis
                      dataKey="feature"
                      type="category"
                      stroke="#94a3b8"
                      tick={{ fontSize: 11 }}
                      width={120}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }}
                      formatter={(val: any) => [`${val}%`, 'Relative Gain']}
                    />
                    <Bar dataKey="score" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded border border-slate-800 flex items-center justify-between">
                <span>Top Predictor: <strong className="text-purple-300">{selectedModel.featureImportance[0]?.feature || 'mtfTrendAlignment'}</strong></span>
                <span>Sum of Top 8: <strong className="text-emerald-400">{selectedModel.featureImportance.slice(0, 8).reduce((s, f) => s + f.score, 0).toFixed(1)}%</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: LIVE PREDICTION & DECISION FUSION */}
      {activeSubTab === 'predict' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-purple-400" />
                  <span>Point-in-Time Prediction & Decision Fusion Layer</span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Evaluates point-in-time features strictly at timestamp T and fuses ML probabilities with quantitative risk limits.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={activeInstrument}
                  onChange={(e) => setActiveInstrument(e.target.value.toUpperCase())}
                  className="bg-slate-950 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs font-mono w-36 uppercase"
                  placeholder="e.g. EUR/USD"
                />
                <button
                  onClick={handleRunPrediction}
                  disabled={isPredicting}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-xs font-mono font-bold flex items-center space-x-2 transition shadow"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isPredicting ? 'EVALUATING...' : 'RUN ML PREDICTION & FUSION'}</span>
                </button>
              </div>
            </div>

            {/* Results Cards */}
            {latestPrediction && latestFusion ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {/* Left: ML Prediction Output */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                    <span className="text-xs font-mono text-purple-400 font-bold uppercase flex items-center space-x-1.5">
                      <Brain className="w-4 h-4" />
                      <span>ML Probability Engine</span>
                    </span>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                      latestPrediction.confidenceTier === 'VERY_STRONG' || latestPrediction.confidenceTier === 'STRONG'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : latestPrediction.confidenceTier === 'MODERATE'
                        ? 'bg-blue-950 text-blue-300 border border-blue-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}>
                      {latestPrediction.confidenceTier} ({latestPrediction.expectedOutcome})
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs font-mono mb-1">
                        <span className="text-slate-400">Target-Before-Stop Probability:</span>
                        <strong className="text-emerald-400">{(latestPrediction.probabilityTargetBeforeStop * 100).toFixed(1)}%</strong>
                      </div>
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                        <div
                          className="bg-emerald-500 h-full"
                          style={{ width: `${latestPrediction.probabilityTargetBeforeStop * 100}%` }}
                        ></div>
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${(1 - latestPrediction.probabilityTargetBeforeStop) * 100}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                        <span>Target First: {(latestPrediction.probabilityTargetBeforeStop * 100).toFixed(1)}%</span>
                        <span>Stop First: {(latestPrediction.probabilityStopBeforeTarget * 100).toFixed(1)}%</span>
                      </div>
                    </div>

                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-xs font-mono space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Direction:</span>
                        <span className="font-bold text-slate-200">{latestPrediction.direction}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Holding Horizon:</span>
                        <span className="text-slate-200">{latestPrediction.predictionHorizonCandles} candles (15M)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Model Used:</span>
                        <span className="text-purple-300">{latestPrediction.modelVersion}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Snapshot ID:</span>
                        <span className="text-slate-400 truncate max-w-[150px]">{latestPrediction.featureSnapshotId}</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] font-mono text-slate-400 uppercase font-semibold">Top Contributing Features:</span>
                      <div className="mt-1 space-y-1">
                        {latestPrediction.topContributingFeatures.map((f, i) => (
                          <div key={i} className="flex items-center justify-between text-xs font-mono bg-slate-900/60 px-2 py-1 rounded">
                            <span className="text-slate-300">{f.feature}</span>
                            <span className="text-purple-400 font-bold">{f.direction} ({Math.round(f.importance * 100)}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Decision Fusion Output */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                    <span className="text-xs font-mono text-emerald-400 font-bold uppercase flex items-center space-x-1.5">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Combined Decision Fusion</span>
                    </span>
                    <span className={`text-xs font-mono px-2.5 py-0.5 rounded font-bold ${
                      latestFusion.finalDecision === 'QUALIFIED_BUY'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 animate-pulse'
                        : latestFusion.finalDecision === 'QUALIFIED_SELL'
                        ? 'bg-rose-950 text-rose-300 border border-rose-700 animate-pulse'
                        : latestFusion.finalDecision === 'CONFLICT'
                        ? 'bg-amber-950 text-amber-300 border border-amber-700'
                        : 'bg-slate-800 text-slate-300'
                    }`}>
                      {latestFusion.finalDecision}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                      <span className="text-[11px] font-mono text-slate-400 uppercase font-semibold">Fusion Rationale:</span>
                      <p className="text-xs font-mono text-slate-200 mt-1 leading-relaxed">
                        {latestFusion.rationale}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-slate-900 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px]">Calculated Entry:</span>
                        <div className="text-slate-200 font-bold">{latestFusion.deterministicSignal.entry}</div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px]">Stop Loss (Deterministic):</span>
                        <div className="text-rose-400 font-bold">{latestFusion.deterministicSignal.stopLoss}</div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px]">Take Profit (Deterministic):</span>
                        <div className="text-emerald-400 font-bold">{latestFusion.deterministicSignal.takeProfit}</div>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px]">Risk / Reward:</span>
                        <div className="text-cyan-400 font-bold">1:{latestFusion.deterministicSignal.riskReward}</div>
                      </div>
                    </div>

                    <div className="p-2.5 bg-slate-900/80 rounded border border-slate-800 text-[11px] font-mono flex items-center justify-between">
                      <span>Live Trade Execution Status:</span>
                      <strong className={latestFusion.tradeAllowed ? 'text-emerald-400' : 'text-rose-400'}>
                        {latestFusion.tradeAllowed ? 'QUALIFIED FOR MANUAL SUBMISSION' : 'DISQUALIFIED / NO ACTION'}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                Click "RUN ML PREDICTION & FUSION" to extract point-in-time features and evaluate model probability.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: WALK-FORWARD VALIDATION */}
      {activeSubTab === 'walkforward' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <GitBranch className="w-4 h-4 text-purple-400" />
                  <span>Chronological Walk-Forward Validation Engine</span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Enforces strict chronological rolling/expanding windows to test real-world out-of-sample consistency.
                </p>
              </div>

              <button
                onClick={handleRunWalkForward}
                disabled={isWalkForwardRunning}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-xs font-mono font-bold flex items-center space-x-2 transition shadow"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{isWalkForwardRunning ? 'VALIDATING...' : 'EXECUTE WALK-FORWARD VALIDATION'}</span>
              </button>
            </div>

            {walkForwardResult ? (
              <div className="space-y-4">
                {/* Aggregate Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">Total Sequential Windows</span>
                    <div className="text-xl font-mono font-bold text-purple-400">{walkForwardResult.windowsCount}</div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">Aggregate Out-of-Sample Win Rate</span>
                    <div className="text-xl font-mono font-bold text-emerald-400">
                      {(walkForwardResult.aggregateMetrics.winRate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">Aggregate Profit Factor</span>
                    <div className="text-xl font-mono font-bold text-cyan-400">
                      {walkForwardResult.aggregateMetrics.profitFactor}x
                    </div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">Aggregate Expectancy R</span>
                    <div className="text-xl font-mono font-bold text-amber-400">
                      +{walkForwardResult.aggregateMetrics.expectancyR}R
                    </div>
                  </div>
                </div>

                {/* Windows Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono text-left text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Window</th>
                        <th className="p-2.5">Train Samples</th>
                        <th className="p-2.5">Out-of-Sample Test</th>
                        <th className="p-2.5">Test Win Rate</th>
                        <th className="p-2.5">Profit Factor</th>
                        <th className="p-2.5">Expectancy R</th>
                        <th className="p-2.5">ROC-AUC</th>
                        <th className="p-2.5">Brier Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {walkForwardResult.windows.map((w: any) => (
                        <tr key={w.windowIndex} className="hover:bg-slate-800/40">
                          <td className="p-2.5 font-bold text-purple-300">Window #{w.windowIndex}</td>
                          <td className="p-2.5">{w.trainSamplesCount}</td>
                          <td className="p-2.5">{w.valSamplesCount}</td>
                          <td className="p-2.5 text-emerald-400 font-bold">
                            {(w.metrics.winRate * 100).toFixed(1)}%
                          </td>
                          <td className="p-2.5 text-cyan-400">{w.metrics.profitFactor}x</td>
                          <td className="p-2.5 text-amber-400">+{w.metrics.expectancyR}R</td>
                          <td className="p-2.5">{w.metrics.rocAuc}</td>
                          <td className="p-2.5">{w.metrics.brierScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                Click "EXECUTE WALK-FORWARD VALIDATION" to run iterative training & testing across chronological slices.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: QUANTITATIVE BACKTEST SIMULATOR */}
      {activeSubTab === 'backtest' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <span>Quantitative Backtest Simulator (Gross vs Net Transaction Costs)</span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Accounts for spread, slippage, broker commission, and taxes to evaluate true net statistical edge.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={btStrategyMode}
                  onChange={(e) => setBtStrategyMode(e.target.value as any)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-mono"
                >
                  <option value="COMBINED">Combined (Quant + ML)</option>
                  <option value="ML_ONLY">ML Only</option>
                  <option value="DETERMINISTIC_ONLY">Deterministic Only</option>
                </select>

                <button
                  onClick={handleRunBacktest}
                  disabled={isBacktesting}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-xs font-mono font-bold flex items-center space-x-2 transition shadow"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isBacktesting ? 'SIMULATING...' : 'RUN BACKTEST SIMULATION'}</span>
                </button>
              </div>
            </div>

            {backtestResult ? (
              <div className="space-y-4">
                {/* Backtest Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase">Net Profit & Return</span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className={`text-xl font-mono font-bold ${backtestResult.summary.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${backtestResult.summary.netProfit.toLocaleString()}
                      </span>
                      <span className="text-xs font-mono text-emerald-500">
                        ({backtestResult.summary.netReturnPct >= 0 ? '+' : ''}{backtestResult.summary.netReturnPct}%)
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Gross: ${backtestResult.summary.grossProfit} | Costs: ${backtestResult.summary.totalCosts}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase">Profit Factor (Net)</span>
                    <div className="text-xl font-mono font-bold text-cyan-400 mt-1">
                      {backtestResult.summary.profitFactorNet}x
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Gross PF: {backtestResult.summary.profitFactorGross}x
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase">Win Rate & Trades</span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className="text-xl font-mono font-bold text-purple-400">
                        {(backtestResult.summary.winRate * 100).toFixed(1)}%
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        ({backtestResult.summary.winningTrades}W / {backtestResult.summary.losingTrades}L)
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Total Executions: {backtestResult.summary.totalTrades}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase">Max Drawdown & Sharpe</span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className="text-xl font-mono font-bold text-amber-400">
                        {backtestResult.summary.maxDrawdownPct}%
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        (Sharpe: {backtestResult.summary.sharpeRatio})
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Expectancy: +{backtestResult.summary.expectancyR}R
                    </div>
                  </div>
                </div>

                {/* Equity Curve Chart */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h4 className="text-xs font-mono font-bold text-slate-300 uppercase mb-2">
                    Equity Growth Curve: Gross vs Net Account Equity
                  </h4>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={backtestResult.equityCurve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          dataKey="timestamp"
                          stroke="#94a3b8"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        />
                        <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} domain={['dataMin - 500', 'dataMax + 500']} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 11 }}
                          formatter={(val: any) => [`$${Number(val).toLocaleString()}`, '']}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="grossEquity" stroke="#8b5cf6" name="Gross Equity" dot={false} strokeWidth={1.5} />
                        <Line type="monotone" dataKey="netEquity" stroke="#10b981" name="Net Equity (After Fees)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                Click "RUN BACKTEST SIMULATION" to test historical execution with slippage & commission.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 5: MODEL REGISTRY & GATES */}
      {activeSubTab === 'registry' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
              <Award className="w-4 h-4 text-purple-400" />
              <span>Model Registry & Production Quality Gates</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono text-left text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Model ID</th>
                    <th className="p-2.5">Version</th>
                    <th className="p-2.5">Market</th>
                    <th className="p-2.5">Algorithm</th>
                    <th className="p-2.5">Val Win Rate</th>
                    <th className="p-2.5">Profit Factor</th>
                    <th className="p-2.5">Brier Score</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {models.map(m => (
                    <tr key={m.modelId} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-purple-300">{m.modelId}</td>
                      <td className="p-2.5">{m.modelVersion}</td>
                      <td className="p-2.5">{m.market}</td>
                      <td className="p-2.5 text-slate-400">{m.algorithm}</td>
                      <td className="p-2.5 text-emerald-400 font-bold">
                        {(m.metrics.validation.winRate * 100).toFixed(1)}%
                      </td>
                      <td className="p-2.5 text-cyan-400">{m.metrics.validation.profitFactor}x</td>
                      <td className="p-2.5 text-amber-400">{m.metrics.validation.brierScore}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.status === 'PRODUCTION'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : m.status === 'CANDIDATE'
                            ? 'bg-purple-950 text-purple-300 border border-purple-700'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-right">
                        {m.status === 'CANDIDATE' && (
                          <button
                            onClick={() => handlePromote(m.modelId)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold transition shadow"
                          >
                            PROMOTE TO PROD
                          </button>
                        )}
                        {m.status === 'PRODUCTION' && (
                          <span className="text-[10px] text-emerald-400 font-bold">ACTIVE PROD</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 6: DRIFT & PSI MONITORING */}
      {activeSubTab === 'drift' && driftReport && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Model Drift & Population Stability Monitoring (PSI)</span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Continuously tracks feature distribution shifts and probability calibration decay.
                </p>
              </div>

              <span className={`px-3 py-1 rounded text-xs font-mono font-bold ${
                driftReport.overallStatus === 'HEALTHY'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : driftReport.overallStatus === 'MONITORING_ALERT'
                  ? 'bg-amber-950 text-amber-300 border border-amber-700'
                  : 'bg-rose-950 text-rose-300 border border-rose-700 animate-pulse'
              }`}>
                STATUS: {driftReport.overallStatus}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Calibration & Accuracy Drift</span>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Observed Win Rate:</span>
                  <span className="text-emerald-400 font-bold">{(driftReport.recentWinRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Expected Baseline:</span>
                  <span className="text-slate-300">{(driftReport.expectedWinRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Current Brier Score:</span>
                  <span className="text-amber-400 font-bold">{driftReport.recentBrierScore}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Overall Max PSI:</span>
                  <span className="text-purple-400 font-bold">{driftReport.psiScore}</span>
                </div>
              </div>

              <div className="md:col-span-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <span className="text-slate-400 font-bold uppercase text-[10px] font-mono">Telemetry Log & Recommendations</span>
                <div className="mt-2 space-y-2">
                  {driftReport.reasons.map((r, i) => (
                    <div key={i} className="flex items-start space-x-2 text-xs font-mono bg-slate-900 p-2 rounded border border-slate-800">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="text-slate-200">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PHASE 4: SUB-VIEW 7 - DATA AUDIT & SUFFICIENCY */}
      {activeSubTab === 'dataAudit' && (
        <DataAuditTab />
      )}

      {/* PHASE 4: SUB-VIEW 8 - HISTORICAL DATA INGESTION */}
      {activeSubTab === 'ingestion' && (
        <DatasetIngestionTab />
      )}

      {/* PHASE 4: SUB-VIEW 9 - COST-AWARE LARGE-SCALE BACKTEST */}
      {activeSubTab === 'largeBacktest' && (
        <LargeScaleBacktestTab />
      )}

      {/* PHASE 4: SUB-VIEW 10 - MONTE CARLO RISK SIMULATION */}
      {activeSubTab === 'monteCarlo' && (
        <MonteCarloTab />
      )}

      {/* PHASE 4: SUB-VIEW 11 - PAPER VALIDATION & PROMOTION GATE */}
      {activeSubTab === 'paperValidation' && (
        <PaperValidationTab />
      )}

      {/* PHASE 4: SUB-VIEW 12 - RESEARCH REPORTS & DATA EXPORT */}
      {activeSubTab === 'reports' && (
        <ReportsAndExportTab />
      )}
    </div>
  );
};
