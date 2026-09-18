// ============================================================================
// DATA AUDIT & SUFFICIENCY RESEARCH TAB
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Database,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  Search,
  Filter
} from 'lucide-react';
import { DataAuditReport, InstrumentAuditSummary } from '../../ml/historical/types';

export const DataAuditTab: React.FC = () => {
  const [auditReport, setAuditReport] = useState<DataAuditReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterMarket, setFilterMarket] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ml/data-audit');
      if (res.ok) {
        const data = await res.json();
        setAuditReport(data);
      }
    } catch (err) {
      console.error('Failed to load data audit report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  const filteredInstruments = (auditReport?.instruments || []).filter(item => {
    const matchesMarket = filterMarket === 'ALL' || item.market === filterMarket;
    const matchesSearch = item.instrument.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesMarket && matchesSearch;
  });

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Top Controls & Sufficiency Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-3">
          <div>
            <h3 className="font-bold text-white text-base flex items-center space-x-2">
              <Database className="w-5 h-5 text-cyan-400" />
              <span>Historical Dataset Quality & Sufficiency Audit</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Comprehensive point-in-time audit of candle density, timestamp gaps, duplicates, and statistical sample size.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchAudit}
              disabled={loading}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs flex items-center space-x-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Re-Run Audit</span>
            </button>
          </div>
        </div>

        {/* 3 Major Market Sufficiency Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Forex Card */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">Forex Dataset</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                auditReport?.overallSufficiency.forexML === 'SUFFICIENT'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}>
                {auditReport?.overallSufficiency.forexML || 'CHECKING'}
              </span>
            </div>
            <div className="text-lg font-bold text-white mt-1">
              {auditReport?.marketSummaries.forex.totalCandles.toLocaleString() || 0} <span className="text-xs text-slate-400">Candles</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {auditReport?.marketSummaries.forex.instrumentCount || 0} Currencies Audited (EUR/USD, GBP/USD, USD/JPY, etc.)
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 border-t border-slate-900 pt-1.5 line-clamp-2">
              {auditReport?.overallSufficiency.forexReason}
            </div>
          </div>

          {/* Indian Equities & Indices Card */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">India Indices & Equities</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                auditReport?.overallSufficiency.indianIndexML === 'SUFFICIENT'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}>
                {auditReport?.overallSufficiency.indianIndexML || 'CHECKING'}
              </span>
            </div>
            <div className="text-lg font-bold text-white mt-1">
              {auditReport?.marketSummaries.indianEquitiesAndIndices.totalCandles.toLocaleString() || 0} <span className="text-xs text-slate-400">Candles</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, Equities
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 border-t border-slate-900 pt-1.5 line-clamp-2">
              {auditReport?.overallSufficiency.indianIndexReason}
            </div>
          </div>

          {/* Options Chains Card */}
          <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-slate-400">Option Chains & Greeks</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                auditReport?.overallSufficiency.optionsML === 'SUFFICIENT'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}>
                {auditReport?.overallSufficiency.optionsML || 'CHECKING'}
              </span>
            </div>
            <div className="text-lg font-bold text-white mt-1">
              {auditReport?.marketSummaries.optionsChains.snapshotCount || 0} <span className="text-xs text-slate-400">Chain Snapshots</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {auditReport?.marketSummaries.optionsChains.totalContracts || 0} Contracts with Point-in-time OI & Delta-OI
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 border-t border-slate-900 pt-1.5 line-clamp-2">
              {auditReport?.overallSufficiency.optionsReason}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-slate-400 font-bold">Filter Market:</span>
          {(['ALL', 'FOREX', 'INDIAN_EQUITY', 'INDIAN_OPTIONS'] as const).map(m => (
            <button
              key={m}
              onClick={() => setFilterMarket(m)}
              className={`px-2.5 py-1 rounded transition ${
                filterMarket === m
                  ? 'bg-cyan-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {m.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search instrument..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Detailed Instrument Audit Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <span className="font-bold text-white text-xs uppercase tracking-wider">
            Audited Instrument Coverage ({filteredInstruments.length})
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            Min. Threshold: Forex &ge; 100, India &ge; 80, Options &ge; 50
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-2.5">Instrument</th>
                <th className="p-2.5">Market</th>
                <th className="p-2.5">TF</th>
                <th className="p-2.5 text-right">Candles</th>
                <th className="p-2.5 text-right">Duplicates</th>
                <th className="p-2.5 text-right">Gaps</th>
                <th className="p-2.5 text-right">Avg Spread</th>
                <th className="p-2.5 text-right">Signals/Trades</th>
                <th className="p-2.5 text-center">Sufficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredInstruments.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition">
                  <td className="p-2.5 font-bold text-white">{item.instrument}</td>
                  <td className="p-2.5 text-slate-400">{item.market}</td>
                  <td className="p-2.5 text-cyan-300">{item.timeframe}</td>
                  <td className="p-2.5 text-right font-bold text-slate-200">{item.candleCount}</td>
                  <td className="p-2.5 text-right text-slate-400">{item.duplicateCandles}</td>
                  <td className="p-2.5 text-right text-amber-400">{item.gapCount}</td>
                  <td className="p-2.5 text-right text-slate-300">{item.averageSpread} pips</td>
                  <td className="p-2.5 text-right text-slate-300">{item.signalCount} / {item.tradeCount}</td>
                  <td className="p-2.5 text-center">
                    <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                      item.sufficiencyStatus === 'SUFFICIENT'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                        : 'bg-rose-950 text-rose-300 border border-rose-700'
                    }`}>
                      {item.sufficiencyStatus === 'SUFFICIENT' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3 h-3 text-rose-400" />
                      )}
                      <span>{item.sufficiencyStatus}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
