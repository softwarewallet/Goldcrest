// ============================================================================
// PAPER TRADING VALIDATION, CALIBRATION & PROMOTION GATE TAB
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Award,
  Activity,
  BarChart2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  GitBranch,
  Lock,
  ZapOff
} from 'lucide-react';
import {
  CalibrationReport,
  PaperVsBacktestComparison,
  PaperPromotionGateEvaluation,
  PaperValidationSignal
} from '../../ml/historical/types';

export const PaperValidationTab: React.FC = () => {
  const [activeSection, setActiveSection] = useState<'calibration' | 'drift' | 'gate' | 'signals'>('calibration');
  const [loading, setLoading] = useState<boolean>(false);

  const [calibrationReport, setCalibrationReport] = useState<CalibrationReport | null>(null);
  const [comparison, setComparison] = useState<PaperVsBacktestComparison | null>(null);
  const [promotionGate, setPromotionGate] = useState<PaperPromotionGateEvaluation | null>(null);
  const [signals, setSignals] = useState<PaperValidationSignal[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Calibration
      const calRes = await fetch('/api/ml/paper/calibration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelVersion: 'gbt_forex_v1.0.0', market: 'FOREX' })
      });
      if (calRes.ok) setCalibrationReport(await calRes.json());

      // 2. Paper vs Backtest
      const compRes = await fetch('/api/ml/paper/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: 'EUR/USD', market: 'FOREX' })
      });
      if (compRes.ok) setComparison(await compRes.json());

      // 3. Promotion Gate
      const gateRes = await fetch('/api/ml/paper/promotion-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelVersion: 'gbt_forex_v1.0.0', market: 'FOREX' })
      });
      if (gateRes.ok) setPromotionGate(await gateRes.json());

      // 4. Signals
      const sigRes = await fetch('/api/ml/paper/signals');
      if (sigRes.ok) setSignals(await sigRes.json());
    } catch (err) {
      console.error('Failed to load paper validation data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Sub-navigation */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveSection('calibration')}
            className={`px-3 py-1.5 rounded transition ${
              activeSection === 'calibration' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Probability Calibration
          </button>
          <button
            onClick={() => setActiveSection('drift')}
            className={`px-3 py-1.5 rounded transition ${
              activeSection === 'drift' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Paper vs Backtest Drift
          </button>
          <button
            onClick={() => setActiveSection('gate')}
            className={`px-3 py-1.5 rounded transition ${
              activeSection === 'gate' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Model Promotion Gate
          </button>
          <button
            onClick={() => setActiveSection('signals')}
            className={`px-3 py-1.5 rounded transition ${
              activeSection === 'signals' ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Live Paper Signals Log
          </button>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs flex items-center space-x-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          <span>Refresh Audit</span>
        </button>
      </div>

      {/* 1. Probability Calibration Section */}
      {activeSection === 'calibration' && calibrationReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Overall Brier Score</span>
              <div className="text-2xl font-bold font-mono text-cyan-300 mt-1">
                {calibrationReport.overallBrierScore}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Target: &le; 0.22 (Lower is superior)
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Max Calibration Error</span>
              <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {calibrationReport.maxCalibrationErrorPct}%
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Max allowable gap: &le; 15%
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-lg">
              <span className="text-xs text-slate-400 font-bold">Model Status</span>
              <div className="mt-1 flex items-center space-x-2">
                <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                  calibrationReport.isCalibrated
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-amber-950 text-amber-300 border border-amber-700'
                }`}>
                  {calibrationReport.isCalibrated ? 'CALIBRATED & RELIABLE' : 'CALIBRATION DRIFT'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {calibrationReport.totalEvaluatedPredictions} evaluated predictions
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="p-3 bg-slate-950 border-b border-slate-800 font-bold text-white text-xs uppercase tracking-wider">
              Probability Calibration Across Confidence Buckets
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-2.5">Confidence Bucket</th>
                    <th className="p-2.5 text-right">Sample Count</th>
                    <th className="p-2.5 text-right">Predicted Prob Avg</th>
                    <th className="p-2.5 text-right">Actual Target-First Rate</th>
                    <th className="p-2.5 text-right">Calibration Error</th>
                    <th className="p-2.5 text-center">Brier Component</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {calibrationReport.buckets.map((b, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-cyan-300">{b.bucketRange}</td>
                      <td className="p-2.5 text-right text-slate-300">{b.sampleCount}</td>
                      <td className="p-2.5 text-right text-slate-200">{(b.predictedProbabilityAvg * 100).toFixed(1)}%</td>
                      <td className="p-2.5 text-right font-bold text-emerald-400">{b.actualTargetFirstRatePct}%</td>
                      <td className="p-2.5 text-right text-amber-400">&plusmn;{b.calibrationErrorPct}%</td>
                      <td className="p-2.5 text-center text-slate-400">{b.brierComponent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. Paper vs Backtest Drift Section */}
      {activeSection === 'drift' && comparison && (
        <div className="space-y-4">
          <div className={`p-4 rounded-lg border flex items-center justify-between text-xs ${
            !comparison.divergence.isPerformanceDriftDetected
              ? 'bg-emerald-950/40 border-emerald-800'
              : 'bg-rose-950/40 border-rose-800'
          }`}>
            <div className="space-y-1">
              <div className="font-bold text-sm text-white flex items-center space-x-2">
                <span>{comparison.divergence.driftFlag}</span>
              </div>
              <p className="text-slate-300 text-xs">{comparison.divergence.driftExplanation}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
              <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-3">Historical Backtest Baseline</h4>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Sample Count:</span>
                  <span className="text-white font-bold">{comparison.backtestMetrics.sampleCount}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Win Rate:</span>
                  <span className="text-emerald-400 font-bold">{comparison.backtestMetrics.winRatePct}%</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Expectancy:</span>
                  <span className="text-slate-200 font-bold">{comparison.backtestMetrics.expectancyR.toFixed(2)} R</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Avg Slippage:</span>
                  <span className="text-slate-200">{comparison.backtestMetrics.avgSlippagePips} pips</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
              <h4 className="font-bold text-cyan-400 text-xs uppercase tracking-wider mb-3">Live Paper Execution Performance</h4>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Sample Count:</span>
                  <span className="text-white font-bold">{comparison.paperMetrics.sampleCount}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Win Rate:</span>
                  <span className="text-emerald-400 font-bold">{comparison.paperMetrics.winRatePct}%</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Expectancy:</span>
                  <span className="text-slate-200 font-bold">{comparison.paperMetrics.expectancyR.toFixed(2)} R</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Avg Slippage:</span>
                  <span className="text-slate-200">{comparison.paperMetrics.avgSlippagePips} pips</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Model Promotion Gate Section */}
      {activeSection === 'gate' && promotionGate && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="font-bold text-white text-base flex items-center space-x-2">
                  <Award className="w-5 h-5 text-cyan-400" />
                  <span>Model Candidate Promotion Gate ({promotionGate.modelVersion})</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  7-Point Strict Safety & Statistical Integrity Audit.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <span className={`px-3 py-1 rounded text-xs font-bold ${
                  promotionGate.overallDecision === 'READY_FOR_OPERATOR_APPROVAL'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-amber-950 text-amber-300 border border-amber-700'
                }`}>
                  {promotionGate.overallDecision}
                </span>
              </div>
            </div>

            {/* Checklist Table */}
            <div className="space-y-2 text-xs">
              {promotionGate.requirements.map((req, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded bg-slate-950 border border-slate-800/80">
                  <div className="flex items-center space-x-3">
                    {req.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    )}
                    <div>
                      <span className="font-bold text-white">{req.criterion}</span>
                      <span className="text-slate-400 text-[11px] block">{req.requirement}</span>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className={`font-bold ${req.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {req.actualValue}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Strict Safety Banner */}
            <div className="mt-4 p-3 rounded bg-slate-950 border border-rose-900 text-xs text-rose-300 flex items-center space-x-2">
              <ZapOff className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>
                <strong>SAFETY CONTROL ACTIVE:</strong> Automatic live order execution is strictly disabled. Passing promotion gates marks the model candidate as verified for internal paper trading only.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 4. Live Paper Signals Section */}
      {activeSection === 'signals' && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="p-3 bg-slate-950 border-b border-slate-800 font-bold text-white text-xs uppercase tracking-wider">
            Point-in-Time Live Paper Signals ({signals.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2.5">Date (UTC)</th>
                  <th className="p-2.5">Instrument</th>
                  <th className="p-2.5">Direction</th>
                  <th className="p-2.5 text-right">ML Prob</th>
                  <th className="p-2.5 text-right">Regime</th>
                  <th className="p-2.5 text-right">Model Ver</th>
                  <th className="p-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {signals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-slate-500">
                      No paper signals captured yet. Signals generated by Forex and Indian engines will appear here in real-time.
                    </td>
                  </tr>
                ) : (
                  signals.map((s, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="p-2.5 text-slate-400">{s.dateUtc}</td>
                      <td className="p-2.5 font-bold text-white">{s.instrument}</td>
                      <td className={`p-2.5 font-bold ${s.signalDirection === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{s.signalDirection}</td>
                      <td className="p-2.5 text-right text-cyan-300 font-bold">{(s.mlProbability * 100).toFixed(1)}%</td>
                      <td className="p-2.5 text-right text-slate-300">{s.marketRegime}</td>
                      <td className="p-2.5 text-right text-slate-400">{s.modelVersion}</td>
                      <td className="p-2.5 text-center text-emerald-400 font-bold">{s.executionStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
