import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  Award,
  BarChart2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Target,
  Terminal,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap
} from 'lucide-react';
import {
  ProductionReadinessScorecard,
  ProductionReadinessGate,
  PromotionEvidencePackage,
  PromotionRequest,
  ModelCalibrationSummary,
  ChampionChallengerPair,
  ShadowPredictionRecord,
  StrategyLifecycleState,
  ModelLifecycleState
} from '../governance/types';
import { GovernanceTestResult } from '../governance/governanceTests';

export const ModelGovernanceDashboard: React.FC = () => {
  const [scorecard, setScorecard] = useState<ProductionReadinessScorecard | null>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<PromotionRequest[]>([]);
  const [championPairs, setChampionPairs] = useState<ChampionChallengerPair[]>([]);
  const [shadowPredictions, setShadowPredictions] = useState<ShadowPredictionRecord[]>([]);
  const [testResults, setTestResults] = useState<GovernanceTestResult | null>(null);
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);

  // Active Evidence Package for Inspection
  const [activeEvidence, setActiveEvidence] = useState<PromotionEvidencePackage | null>(null);
  const [isGeneratingEvidence, setIsGeneratingEvidence] = useState<boolean>(false);

  // Operator Promotion Sign-Off Modal
  const [signOffModal, setSignOffModal] = useState<{
    isOpen: boolean;
    type: 'APPROVE' | 'REJECT';
    requestId: string;
    strategyId: string;
    targetStage: string;
  } | null>(null);
  const [operatorId, setOperatorId] = useState<string>('CHIEF_RISK_OFFICER');
  const [signOffReason, setSignOffReason] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'SCORECARD' | 'LIFECYCLES' | 'PROMOTIONS' | 'CALIBRATION' | 'CHAMPION_CHALLENGER' | 'TEST_SUITE'>('SCORECARD');

  const loadAllGovernanceData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [scoreRes, stratRes, modRes, promRes, champRes, shadRes] = await Promise.all([
        fetch('/api/governance/scorecard'),
        fetch('/api/governance/strategies'),
        fetch('/api/governance/models'),
        fetch('/api/governance/promotions'),
        fetch('/api/governance/champion-challenger'),
        fetch('/api/governance/shadow/predictions')
      ]);

      if (scoreRes.ok) setScorecard(await scoreRes.json());
      if (stratRes.ok) setStrategies(await stratRes.json());
      if (modRes.ok) setModels(await modRes.json());
      if (promRes.ok) setPromotions(await promRes.json());
      if (champRes.ok) setChampionPairs(await champRes.json());
      if (shadRes.ok) setShadowPredictions(await shadRes.json());
    } catch (err) {
      console.error('Failed to load governance data:', err);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllGovernanceData();
  }, [loadAllGovernanceData]);

  // Generate Demonstration Evidence Package
  const handleGenerateEvidence = async () => {
    setIsGeneratingEvidence(true);
    try {
      const res = await fetch('/api/governance/promotions/generate-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'forex_trend_continuation_v2',
          strategyVersion: 'v2.0.0',
          modelId: 'gbt_forex_v1.0.0',
          modelVersion: 'v1.0.0',
          datasetVersion: 'v1.0.0',
          featureVersion: 'v1.0.0',
          market: 'FOREX',
          instrument: 'EUR/USD',
          timeframe: 'M15',
          targetEnvironment: 'DEMO'
        })
      });
      if (res.ok) {
        const evidence: PromotionEvidencePackage = await res.json();
        setActiveEvidence(evidence);

        // Submit formal request
        await fetch('/api/governance/promotions/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategyId: evidence.strategyId,
            modelId: evidence.modelId,
            market: evidence.market,
            instrument: evidence.instrument,
            fromStage: 'PAPER',
            toStage: 'DEMO',
            requestedBy: 'LEAD_QUANT_RESEARCHER',
            evidencePackageId: evidence.id,
            notes: 'Generated formal evidence package after 38 paper executions and 16 active days.'
          })
        });

        await loadAllGovernanceData();
        setActiveTab('PROMOTIONS');
      }
    } catch (err) {
      console.error('Evidence generation failed:', err);
    } finally {
      setIsGeneratingEvidence(false);
    }
  };

  // Run Automated Governance Tests
  const handleRunGovernanceTests = async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/governance/run-tests', { method: 'POST' });
      if (res.ok) {
        setTestResults(await res.json());
        await loadAllGovernanceData();
      }
    } catch (err) {
      console.error('Test suite error:', err);
    } finally {
      setIsRunningTests(false);
    }
  };

  // Operator Sign-Off Action
  const handleOperatorDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signOffModal || !signOffReason) return;

    const endpoint = signOffModal.type === 'APPROVE'
      ? '/api/governance/promotions/approve'
      : '/api/governance/promotions/reject';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: signOffModal.requestId,
          operatorId,
          reason: signOffReason
        })
      });
      if (res.ok) {
        setSignOffModal(null);
        setSignOffReason('');
        await loadAllGovernanceData();
      }
    } catch (err) {
      console.error('Sign-off failed:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3 font-mono">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <div className="text-sm text-slate-300">Loading Governance & Production Readiness Framework...</div>
      </div>
    );
  }

  return (
    <div id="model_governance_dashboard" className="space-y-6">
      {/* 1. Header with Overall Readiness Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Model Governance & Production Readiness
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono">
                  INSTITUTIONAL GOVERNANCE
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Institutional promotion gates, 9 independent readiness gates, 9-bucket probability calibration, and champion/challenger tracking.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleGenerateEvidence}
              disabled={isGeneratingEvidence}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold shadow transition"
            >
              <FileCheck className={`w-3.5 h-3.5 ${isGeneratingEvidence ? 'animate-spin' : ''}`} />
              <span>{isGeneratingEvidence ? 'GENERATING...' : 'GENERATE EVIDENCE PACKAGE'}</span>
            </button>

            <button
              onClick={handleRunGovernanceTests}
              disabled={isRunningTests}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold shadow transition"
            >
              <Zap className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              <span>{isRunningTests ? 'RUNNING TESTS...' : 'RUN GOVERNANCE TESTS (13)'}</span>
            </button>

            <button
              onClick={loadAllGovernanceData}
              disabled={isRefreshing}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>REFRESH</span>
            </button>
          </div>
        </div>

        {/* Global Invariant & Readiness Bar */}
        {scorecard && (
          <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center space-x-3">
              <span className="text-slate-400">SCORECARD STATUS:</span>
              <span className={`px-2.5 py-0.5 rounded font-bold ${
                scorecard.overallReadiness === 'READY_FOR_CONTROLLED_DEMO'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : 'bg-amber-950 text-amber-300 border border-amber-700'
              }`}>
                {scorecard.overallReadiness}
              </span>
              <span className="text-slate-500">({scorecard.passingGatesCount}/9 Gates Passing)</span>
            </div>

            {/* Strict Invariant Badge */}
            <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1 rounded border border-slate-800">
              <Lock className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-slate-400">LIVE AUTO EXECUTION:</span>
              <strong className="text-rose-400 font-bold">PERMANENTLY DISABLED (HARD INVARIANT)</strong>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800 overflow-x-auto font-mono text-xs">
        {[
          { id: 'SCORECARD', label: '9 READINESS GATES', icon: ShieldCheck },
          { id: 'LIFECYCLES', label: 'STRATEGY & MODEL LIFECYCLES', icon: Layers },
          { id: 'PROMOTIONS', label: 'PROMOTION WORKFLOW & EVIDENCE', icon: FileCheck },
          { id: 'CALIBRATION', label: '9-BUCKET CALIBRATION', icon: Target },
          { id: 'CHAMPION_CHALLENGER', label: 'CHAMPION / CHALLENGER & SHADOW', icon: Award },
          { id: 'TEST_SUITE', label: 'AUTOMATED SAFETY TEST SUITE', icon: Terminal }
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-lg font-bold transition whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* 2. TAB CONTENT */}

      {/* TAB 1: 9 INDEPENDENT PRODUCTION READINESS GATES */}
      {activeTab === 'SCORECARD' && scorecard && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.values(scorecard.gates) as ProductionReadinessGate[]).map((gate: ProductionReadinessGate) => (
              <div key={gate.gateId} className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3 font-mono">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-slate-200 text-xs">{gate.gateName}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                    gate.status === 'PASS'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                      : 'bg-rose-950 text-rose-300 border border-rose-700'
                  }`}>
                    {gate.status === 'PASS' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {gate.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">{gate.description}</p>
                <div className="space-y-1.5 pt-1 text-[10px]">
                  {gate.criteria.map((c, i) => (
                    <div key={i} className="p-1.5 bg-slate-950 rounded border border-slate-800/80 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-semibold">{c.criterion}</span>
                        <span className="text-emerald-400 font-bold">{c.actual}</span>
                      </div>
                      <div className="text-slate-500">Threshold: {c.expected}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: STRATEGY & MODEL LIFECYCLES */}
      {activeTab === 'LIFECYCLES' && (
        <div className="space-y-6">
          {/* Strategy Lifecycles */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4 font-mono">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Strategy Lifecycles (RESEARCH → RETIRED)</span>
            </h3>
            <div className="space-y-3">
              {strategies.map((st) => (
                <div key={st.strategyId} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-white">{st.strategyId}</span>
                      <span className="text-xs text-slate-500 ml-2">Version: {st.version}</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-xs font-bold w-fit">
                      STATE: {st.state}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{st.notes}</div>

                  {/* Visual Step Progress */}
                  <div className="grid grid-cols-6 gap-1 text-[10px] text-center pt-2">
                    {['RESEARCH', 'BACKTEST', 'PAPER', 'DEMO', 'LIVE_CANDIDATE', 'LIVE_APPROVED'].map((stage, idx) => {
                      const stages = ['RESEARCH', 'BACKTEST', 'PAPER', 'DEMO', 'LIVE_CANDIDATE', 'LIVE_APPROVED'];
                      const currentIdx = stages.indexOf(st.state);
                      const isPastOrCurrent = idx <= currentIdx;
                      return (
                        <div
                          key={stage}
                          className={`p-1.5 rounded border ${
                            st.state === stage
                              ? 'bg-emerald-600 text-white font-bold border-emerald-500 shadow'
                              : isPastOrCurrent
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/80'
                              : 'bg-slate-900 text-slate-600 border-slate-800'
                          }`}
                        >
                          {stage}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Model Lifecycles */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4 font-mono">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>Model Lifecycles (RESEARCH → PRODUCTION)</span>
            </h3>
            <div className="space-y-3">
              {models.map((m) => (
                <div key={m.modelId} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-white">{m.modelId}</span>
                      <span className="text-xs text-slate-500 ml-2">Version: {m.version}</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700 text-xs font-bold w-fit">
                      STATE: {m.state}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{m.notes}</div>

                  {/* Visual Step Progress */}
                  <div className="grid grid-cols-5 gap-1 text-[10px] text-center pt-2">
                    {['RESEARCH', 'CANDIDATE', 'PAPER', 'DEMO', 'PRODUCTION'].map((stage, idx) => {
                      const stages = ['RESEARCH', 'CANDIDATE', 'PAPER', 'DEMO', 'PRODUCTION'];
                      const currentIdx = stages.indexOf(m.state);
                      const isPastOrCurrent = idx <= currentIdx;
                      return (
                        <div
                          key={stage}
                          className={`p-1.5 rounded border ${
                            m.state === stage
                              ? 'bg-indigo-600 text-white font-bold border-indigo-500 shadow'
                              : isPastOrCurrent
                              ? 'bg-indigo-950/40 text-indigo-400 border-indigo-800/80'
                              : 'bg-slate-900 text-slate-600 border-slate-800'
                          }`}
                        >
                          {stage}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PROMOTION WORKFLOW & EVIDENCE REVIEW */}
      {activeTab === 'PROMOTIONS' && (
        <div className="space-y-6 font-mono text-xs">
          {/* Active Promotion Requests */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                <span>Promotion Gate Requests & Operator Sign-Off</span>
              </h3>
              <span className="text-slate-400">Strict Human Operator Approval</span>
            </div>

            {promotions.length === 0 ? (
              <div className="p-6 text-center text-slate-500 bg-slate-950 rounded-lg">
                No active promotion requests. Click &quot;GENERATE EVIDENCE PACKAGE&quot; above to submit a new validation request.
              </div>
            ) : (
              <div className="space-y-3">
                {promotions.map((req) => (
                  <div key={req.id} className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">{req.strategyId}</span>
                        <span className="text-slate-500">({req.instrument} • {req.market})</span>
                        <span className="text-emerald-400 font-bold">{req.fromStage} → {req.toStage}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        req.status === 'APPROVED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' :
                        req.status === 'REJECTED' ? 'bg-rose-950 text-rose-300 border border-rose-700' :
                        'bg-amber-950 text-amber-300 border border-amber-700'
                      }`}>
                        {req.status}
                      </span>
                    </div>

                    <div className="text-slate-400 text-[11px]">
                      Requested by: <strong className="text-slate-200">{req.requestedBy}</strong> at {new Date(req.requestedAt).toLocaleString()}
                    </div>
                    {req.notes && <div className="text-slate-400">{req.notes}</div>}

                    {req.status === 'PENDING_REVIEW' && (
                      <div className="flex items-center space-x-2 pt-2 border-t border-slate-800">
                        <button
                          onClick={() => setSignOffModal({
                            isOpen: true,
                            type: 'APPROVE',
                            requestId: req.id,
                            strategyId: req.strategyId,
                            targetStage: req.toStage
                          })}
                          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition"
                        >
                          Approve Sign-Off
                        </button>
                        <button
                          onClick={() => setSignOffModal({
                            isOpen: true,
                            type: 'REJECT',
                            requestId: req.id,
                            strategyId: req.strategyId,
                            targetStage: req.toStage
                          })}
                          className="px-3 py-1.5 rounded bg-rose-900 hover:bg-rose-800 text-rose-200 font-bold transition"
                        >
                          Reject Request
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detailed Evidence Package Viewer */}
          {activeEvidence && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Promotion Evidence Package: {activeEvidence.id}</span>
                </h3>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold">
                  {activeEvidence.sampleSafety} (N={activeEvidence.paperResults.tradesCount})
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-slate-500">Win Rate 95% CI</div>
                  <div className="text-emerald-400 font-bold mt-1">
                    {activeEvidence.winRateConfidenceInterval.pointEstimate}% [{activeEvidence.winRateConfidenceInterval.lowerBound}%, {activeEvidence.winRateConfidenceInterval.upperBound}%]
                  </div>
                </div>
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-slate-500">Expectancy 95% CI</div>
                  <div className="text-emerald-400 font-bold mt-1">
                    +{activeEvidence.expectancyConfidenceInterval.pointEstimate}R [{activeEvidence.expectancyConfidenceInterval.lowerBound}R, {activeEvidence.expectancyConfidenceInterval.upperBound}R]
                  </div>
                </div>
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-slate-500">Brier Calibration Score</div>
                  <div className="text-indigo-400 font-bold mt-1">
                    {activeEvidence.calibration.overallBrierScore} ({activeEvidence.calibration.status})
                  </div>
                </div>
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-slate-500">Population Stability (PSI)</div>
                  <div className="text-blue-400 font-bold mt-1">
                    {activeEvidence.psiValue} ({activeEvidence.psiStatus})
                  </div>
                </div>
              </div>

              {/* Backtest vs Paper Decay Breakdown */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="font-bold text-slate-200">Backtest vs Paper Decay Metrics</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>Win Rate: <strong className="text-slate-300">{activeEvidence.decayMetrics.backtestWinRatePct}% BT</strong> → <strong className="text-emerald-400">{activeEvidence.decayMetrics.paperWinRatePct}% Paper</strong> ({activeEvidence.decayMetrics.winRateDelta}%)</div>
                  <div>Expectancy: <strong className="text-slate-300">+{activeEvidence.decayMetrics.backtestExpectancyR}R BT</strong> → <strong className="text-emerald-400">+{activeEvidence.decayMetrics.paperExpectancyR}R Paper</strong></div>
                  <div>Spread: <strong className="text-blue-400">{activeEvidence.decayMetrics.spreadDelta} pips delta</strong></div>
                  <div>Slippage: <strong className="text-amber-400">{activeEvidence.decayMetrics.slippageDelta} pips delta</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: 9-BUCKET PROBABILITY CALIBRATION */}
      {activeTab === 'CALIBRATION' && activeEvidence?.calibration && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Target className="w-4 h-4 text-indigo-400" />
                <span>9-Bucket Probability Calibration & Reliability Curve</span>
              </h3>
              <p className="text-slate-400 text-[11px]">
                Evaluates predicted confidence gradient against empirical first-barrier realization rate.
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <span>Overall Brier Score: <strong className="text-indigo-400">{activeEvidence.calibration.overallBrierScore}</strong></span>
              <span>Max Calibration Error: <strong className="text-emerald-400">{activeEvidence.calibration.maxCalibrationError}%</strong></span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2.5">Bucket Range</th>
                  <th className="p-2.5">Samples (N)</th>
                  <th className="p-2.5">Predicted Avg Prob</th>
                  <th className="p-2.5">Actual Target-First Rate</th>
                  <th className="p-2.5">Calibration Error</th>
                  <th className="p-2.5">Brier Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {activeEvidence.calibration.buckets.map((b, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="p-2.5 font-bold text-white">{b.bucketRange}</td>
                    <td className="p-2.5 text-slate-300">{b.sampleCount}</td>
                    <td className="p-2.5 text-indigo-300">{b.predictedAvgProb}%</td>
                    <td className="p-2.5 font-bold text-emerald-400">{b.actualTargetFirstRate}%</td>
                    <td className="p-2.5 text-slate-300">{b.calibrationError}%</td>
                    <td className="p-2.5 text-slate-400">{b.brierContribution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: CHAMPION / CHALLENGER & SHADOW MODE */}
      {activeTab === 'CHAMPION_CHALLENGER' && (
        <div className="space-y-6 font-mono text-xs">
          {/* Head-to-head pairs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {championPairs.map((pair) => (
              <div key={pair.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-white">{pair.instrument} ({pair.market})</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold">
                    {pair.recommendation}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Champion */}
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">CHAMPION MODEL</div>
                    <div className="font-bold text-white truncate">{pair.championModelId}</div>
                    <div className="space-y-1 text-[11px] pt-1 text-slate-300">
                      <div>Win Rate: <strong className="text-emerald-400">{pair.metrics.championWinRatePct}%</strong></div>
                      <div>Expectancy: <strong className="text-emerald-400">+{pair.metrics.championExpectancyR}R</strong></div>
                      <div>Brier Score: <strong className="text-indigo-400">{pair.metrics.championBrierScore}</strong></div>
                      <div>Max Drawdown: <strong className="text-slate-400">{pair.metrics.championDrawdownPct}%</strong></div>
                    </div>
                  </div>

                  {/* Challenger */}
                  <div className="p-3 bg-slate-950 rounded-lg border border-indigo-900/60 space-y-2">
                    <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">CHALLENGER (PAPER)</div>
                    <div className="font-bold text-white truncate">{pair.challengerModelId}</div>
                    <div className="space-y-1 text-[11px] pt-1 text-slate-300">
                      <div>Win Rate: <strong className="text-emerald-400">{pair.metrics.challengerWinRatePct}%</strong></div>
                      <div>Expectancy: <strong className="text-emerald-400">+{pair.metrics.challengerExpectancyR}R</strong></div>
                      <div>Brier Score: <strong className="text-indigo-400">{pair.metrics.challengerBrierScore}</strong></div>
                      <div>Max Drawdown: <strong className="text-slate-400">{pair.metrics.challengerDrawdownPct}%</strong></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Shadow Predictions Stream */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Eye className="w-4 h-4 text-indigo-400" />
                <span>Shadow Mode Predictions (Zero-Execution Routing)</span>
              </h3>
              <span className="text-slate-400">Passive Telemetry</span>
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {shadowPredictions.map((sh) => (
                <div key={sh.id} className="p-2 bg-slate-950 rounded border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-indigo-300">{sh.modelId}</span>
                    <span className="text-slate-500">• {sh.instrument}</span>
                    <span className="text-emerald-400 font-bold">P(Win): {(sh.predictedProbability * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center space-x-3 text-[11px] text-slate-500">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">SHADOW_ONLY</span>
                    <span>{new Date(sh.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: AUTOMATED SAFETY TEST SUITE (13 TESTS) */}
      {activeTab === 'TEST_SUITE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <span>Automated Governance & Safety Test Suite</span>
              </h3>
              <p className="text-slate-400 text-[11px]">
                Validates promotion gates, sample size safety, Brier calibration, drift, reconciliation, kill switch, override ledger, and version locking.
              </p>
            </div>
            <button
              onClick={handleRunGovernanceTests}
              disabled={isRunningTests}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold shadow flex items-center space-x-1.5 transition"
            >
              <Zap className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              <span>{isRunningTests ? 'EXECUTING SUITE...' : 'EXECUTE ALL TESTS'}</span>
            </button>
          </div>

          {testResults ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-slate-950 rounded border border-slate-800">
                <span className="font-bold text-white">SUITE RESULTS: {testResults.suiteName}</span>
                <span className="text-emerald-400 font-bold">
                  {testResults.passedTests}/{testResults.totalTests} Passed ({testResults.durationMs}ms)
                </span>
              </div>

              <div className="space-y-2">
                {testResults.tests.map((t, idx) => (
                  <div key={idx} className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200">{idx + 1}. {t.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                        t.passed ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-700'
                      }`}>
                        {t.passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {t.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    <div className="text-slate-400 text-[11px]">{t.description}</div>
                    {t.details && <div className="text-emerald-400 text-[10px] pt-0.5">{t.details}</div>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-950 rounded-lg border border-slate-800 text-slate-500">
              Click &quot;EXECUTE ALL TESTS&quot; to run the automated verification suite.
            </div>
          )}
        </div>
      )}

      {/* Operator Sign-Off Modal */}
      {signOffModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">
                Operator Promotion Sign-Off: {signOffModal.type}
              </h3>
              <button onClick={() => setSignOffModal(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleOperatorDecision} className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">OPERATOR SIGNATURE / ID</label>
                <input
                  type="text"
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">DECISION JUSTIFICATION & AUDIT REASON</label>
                <textarea
                  value={signOffReason}
                  onChange={(e) => setSignOffReason(e.target.value)}
                  placeholder="Provide detailed risk assessment justification for this promotion decision..."
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white h-24"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSignOffModal(null)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!signOffReason}
                  className={`px-4 py-2 rounded font-bold text-white ${
                    signOffModal.type === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  Confirm Sign-Off
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
