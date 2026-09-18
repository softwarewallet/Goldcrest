// ============================================================================
// DAILY & WEEKLY RESEARCH REPORTS AND DATA EXPORTER TAB
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Calendar,
  Layers,
  Award,
  TrendingUp,
  RefreshCw,
  CheckCircle,
  FileSpreadsheet
} from 'lucide-react';
import { DailyResearchSummary, WeeklyResearchReport } from '../../ml/historical/types';

export const ReportsAndExportTab: React.FC = () => {
  const [dailyReport, setDailyReport] = useState<DailyResearchSummary | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyResearchReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [exporting, setExporting] = useState<boolean>(false);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const dRes = await fetch('/api/ml/reports/daily');
      if (dRes.ok) setDailyReport(await dRes.json());

      const wRes = await fetch('/api/ml/reports/weekly');
      if (wRes.ok) setWeeklyReport(await wRes.json());
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleExport = async (datasetType: string) => {
    setExporting(true);
    try {
      // Fetch sample data for export
      const res = await fetch('/api/ml/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: exportFormat,
          filename: `quant_research_${datasetType}_${Date.now()}`,
          data: dailyReport ? [dailyReport] : []
        })
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `research_${datasetType}.${exportFormat}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-white text-base flex items-center space-x-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            <span>Research Reports & Institutional Data Exporter</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Automated daily logs, multi-week performance retrospectives, and raw CSV/JSON pipeline dumps.
          </p>
        </div>

        <button
          onClick={fetchReports}
          disabled={loading}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs flex items-center space-x-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          <span>Regenerate Reports</span>
        </button>
      </div>

      {/* Daily Research Summary Card */}
      {dailyReport && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-white text-xs uppercase tracking-wider">
                Daily Research Summary — {dailyReport.reportDate}
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              dailyReport.modelDriftStatus === 'HEALTHY'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                : 'bg-amber-950 text-amber-300 border border-amber-700'
            }`}>
              PSI STATUS: {dailyReport.modelDriftStatus} (Avg PSI: {dailyReport.averageFeaturePsi})
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400">Signals Generated:</span>
              <div className="text-lg font-bold text-white font-mono mt-0.5">
                {dailyReport.signalsGeneratedToday} <span className="text-xs text-emerald-400 font-normal">({dailyReport.qualifiedSignalsToday} Qualified)</span>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400">ML Predictions:</span>
              <div className="text-lg font-bold text-cyan-300 font-mono mt-0.5">
                {dailyReport.mlPredictionsMadeToday}
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400">Paper Trades Executed:</span>
              <div className="text-lg font-bold text-white font-mono mt-0.5">
                {dailyReport.paperTradesExecutedToday} <span className="text-xs text-slate-400">({dailyReport.winRateTodayPct}% Win)</span>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded border border-slate-800">
              <span className="text-slate-400">Realized Paper P&L:</span>
              <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
                +${dailyReport.paperRealizedPnlToday.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="mt-3 text-[11px] text-slate-400 border-t border-slate-800 pt-2 flex items-center justify-between">
            <span>Observed Regimes: <strong className="text-slate-200">{dailyReport.marketRegimesObserved.join(', ')}</strong></span>
            <span>{dailyReport.calibrationSummary}</span>
          </div>
        </div>
      )}

      {/* Weekly Report & Insights */}
      {weeklyReport && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-3">
            <Award className="w-4 h-4 text-indigo-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              Weekly Model & Strategy Retrospective ({weeklyReport.reportWeek})
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-950 rounded border border-slate-800">
              <span className="font-bold text-cyan-300 uppercase text-[10px] tracking-wider block mb-1">
                Core Strategy Observations & Actionable Insights
              </span>
              <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                {weeklyReport.actionableInsights.map((insight, idx) => (
                  <li key={idx}>{insight}</li>
                ))}
              </ul>
            </div>

            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-[11px]">
              <span className="font-bold text-emerald-400 uppercase text-[10px] tracking-wider block mb-1">
                Feature Stability & Leakage Verification
              </span>
              <p className="text-slate-300">{weeklyReport.featureStabilitySummary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Export Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
          <div className="flex items-center space-x-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              Download Raw Research Datasets & Artifacts
            </span>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-400">Format:</span>
            <button
              onClick={() => setExportFormat('csv')}
              className={`px-2 py-0.5 rounded font-bold ${exportFormat === 'csv' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'}`}
            >
              CSV
            </button>
            <button
              onClick={() => setExportFormat('json')}
              className={`px-2 py-0.5 rounded font-bold ${exportFormat === 'json' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300'}`}
            >
              JSON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => handleExport('historical_backtest')}
            disabled={exporting}
            className="p-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-left transition text-xs flex items-center justify-between"
          >
            <div>
              <div className="font-bold text-white">Backtest Trades & Costs</div>
              <div className="text-[10px] text-slate-400">Realized R, slippage, gross & net PnL</div>
            </div>
            <Download className="w-4 h-4 text-cyan-400" />
          </button>

          <button
            onClick={() => handleExport('paper_validation')}
            disabled={exporting}
            className="p-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-left transition text-xs flex items-center justify-between"
          >
            <div>
              <div className="font-bold text-white">Paper Signals & Executions</div>
              <div className="text-[10px] text-slate-400">Point-in-time features & model predictions</div>
            </div>
            <Download className="w-4 h-4 text-cyan-400" />
          </button>

          <button
            onClick={() => handleExport('daily_summary')}
            disabled={exporting}
            className="p-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded text-left transition text-xs flex items-center justify-between"
          >
            <div>
              <div className="font-bold text-white">Research Audit Summary</div>
              <div className="text-[10px] text-slate-400">Daily PSI, drift, and calibration metrics</div>
            </div>
            <Download className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>
    </div>
  );
};
