// ============================================================================
// HISTORICAL DATA INGESTION & REGISTRY TAB
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  Database,
  CheckCircle,
  AlertCircle,
  Clock,
  Layers,
  FileText,
  ShieldCheck,
  RefreshCw,
  Hash
} from 'lucide-react';
import { DatasetRegistryEntry } from '../../ml/historical/types';

export const DatasetIngestionTab: React.FC = () => {
  const [datasets, setDatasets] = useState<DatasetRegistryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [ingesting, setIngesting] = useState<boolean>(false);
  const [ingestionMessage, setIngestionMessage] = useState<string | null>(null);

  // Form State
  const [provider, setProvider] = useState<'CTRADER_OPEN_API' | 'FIVE_PAISA_API' | 'CSV_JSON_IMPORT'>('CTRADER_OPEN_API');
  const [market, setMarket] = useState<'FOREX' | 'INDIAN_EQUITY' | 'INDIAN_OPTIONS'>('FOREX');
  const [instrument, setInstrument] = useState<string>('EUR/USD');
  const [timeframe, setTimeframe] = useState<string>('M15');
  const [datasetVersion, setDatasetVersion] = useState<string>('v1.1.0');
  const [correctionReason, setCorrectionReason] = useState<string>('');

  const fetchDatasets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ml/datasets');
      if (res.ok) {
        const data = await res.json();
        setDatasets(data);
      }
    } catch (err) {
      console.error('Failed to load datasets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, []);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngesting(true);
    setIngestionMessage(null);

    try {
      const res = await fetch('/api/ml/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          market,
          instrument,
          timeframe,
          datasetVersion,
          correctionReason: correctionReason || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        setIngestionMessage(`Successfully ingested ${data.ingestedCount} candles into dataset '${data.datasetId}' (${data.datasetVersion}) with Quality Score ${data.qualityScore}/100.`);
        fetchDatasets();
      } else {
        setIngestionMessage(`Ingestion error: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setIngestionMessage(`Failed to execute ingestion: ${err.message}`);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Ingestion Pipeline Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center space-x-2 border-b border-slate-800 pb-3 mb-4">
          <UploadCloud className="w-5 h-5 text-cyan-400" />
          <h3 className="font-bold text-white text-base">Historical Ingestion & Normalization Engine</h3>
        </div>

        <form onSubmit={handleIngest} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Source Provider</label>
              <select
                value={provider}
                onChange={e => {
                  const val = e.target.value as any;
                  setProvider(val);
                  if (val === 'CTRADER_OPEN_API') {
                    setMarket('FOREX');
                    setInstrument('EUR/USD');
                  } else if (val === 'FIVE_PAISA_API') {
                    setMarket('INDIAN_EQUITY');
                    setInstrument('NIFTY');
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="CTRADER_OPEN_API">cTrader Open API (Forex)</option>
                <option value="FIVE_PAISA_API">5paisa API (India Equities & Options)</option>
                <option value="CSV_JSON_IMPORT">CSV / JSON Point-in-Time Import</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-1">Market Domain</label>
              <select
                value={market}
                onChange={e => setMarket(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="FOREX">FOREX (UTC Timezone)</option>
                <option value="INDIAN_EQUITY">INDIAN EQUITIES / INDICES (Asia/Kolkata)</option>
                <option value="INDIAN_OPTIONS">INDIAN OPTIONS CHAIN & GREEKS</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-1">Instrument Symbol</label>
              <input
                type="text"
                value={instrument}
                onChange={e => setInstrument(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                placeholder="e.g. EUR/USD, NIFTY, BANKNIFTY"
                required
              />
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-1">Timeframe</label>
              <select
                value={timeframe}
                onChange={e => setTimeframe(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-cyan-500"
              >
                <option value="M1">M1 (1 Minute)</option>
                <option value="M5">M5 (5 Minutes)</option>
                <option value="M15">M15 (15 Minutes)</option>
                <option value="H1">H1 (1 Hour)</option>
                <option value="D1">D1 (Daily)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-1">Target Dataset Version</label>
              <input
                type="text"
                value={datasetVersion}
                onChange={e => setDatasetVersion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                placeholder="e.g. v1.1.0"
                required
              />
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-1">Audit / Correction Reason (Optional)</label>
              <input
                type="text"
                value={correctionReason}
                onChange={e => setCorrectionReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                placeholder="e.g. Ingesting October 2024 revised tick bars"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Pipeline enforces: Zero Overwrite Rule &bull; UTC Normalization &bull; Deduplication &bull; Strict OHLC Bounds</span>
            </div>

            <button
              type="submit"
              disabled={ingesting}
              className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center space-x-2 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ingesting ? 'animate-spin' : ''}`} />
              <span>{ingesting ? 'Processing Ingestion...' : 'Run Ingestion Pipeline'}</span>
            </button>
          </div>
        </form>

        {ingestionMessage && (
          <div className="mt-3 p-3 rounded bg-slate-950 border border-cyan-800 text-cyan-200 text-xs flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span>{ingestionMessage}</span>
          </div>
        )}
      </div>

      {/* Dataset Version Registry Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-slate-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              Immutable Dataset Registry ({datasets.length} Versions)
            </span>
          </div>

          <button
            onClick={fetchDatasets}
            disabled={loading}
            className="text-[11px] text-slate-400 hover:text-white flex items-center space-x-1 transition"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-2.5">Dataset ID</th>
                <th className="p-2.5">Version</th>
                <th className="p-2.5">Instrument</th>
                <th className="p-2.5">Market</th>
                <th className="p-2.5">Timeframe</th>
                <th className="p-2.5 text-right">Records</th>
                <th className="p-2.5 text-right">Quality Score</th>
                <th className="p-2.5">Immutable Hash</th>
                <th className="p-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {datasets.map((ds, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition">
                  <td className="p-2.5 font-bold text-white">{ds.datasetId}</td>
                  <td className="p-2.5 text-cyan-300 font-bold">{ds.datasetVersion}</td>
                  <td className="p-2.5 text-slate-200">{ds.instrument}</td>
                  <td className="p-2.5 text-slate-400">{ds.market}</td>
                  <td className="p-2.5 text-slate-400">{ds.timeframe}</td>
                  <td className="p-2.5 text-right font-bold text-slate-200">{ds.recordCount}</td>
                  <td className="p-2.5 text-right">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      ds.qualityScore >= 90 ? 'text-emerald-300 bg-emerald-950/50' : 'text-amber-300 bg-amber-950/50'
                    }`}>
                      {ds.qualityScore}/100
                    </span>
                  </td>
                  <td className="p-2.5 text-slate-500 text-[10px] truncate max-w-[120px]">{ds.immutableHash}</td>
                  <td className="p-2.5 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      {ds.status}
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
