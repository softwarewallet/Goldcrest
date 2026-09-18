import React from 'react';
import {
  Activity,
  ArrowRight,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  FileCode,
  Layers,
  Link,
  Shield,
  ShieldCheck,
  Target,
  X,
  Zap
} from 'lucide-react';
import { SignalToOrderTrace } from '../../demoExecution/types';

interface SignalTraceModalProps {
  trace: SignalToOrderTrace | null;
  onClose: () => void;
}

export const SignalTraceModal: React.FC<SignalTraceModalProps> = ({ trace, onClose }) => {
  if (!trace) return null;

  const steps = [
    {
      title: '1. Market Data Snapshot',
      id: trace.marketDataSnapshotId,
      icon: Activity,
      desc: 'Raw Level-1 bid/ask quote & synthetic chronological candle buffer.',
      color: 'text-blue-400 bg-blue-500/10 border-blue-500/30'
    },
    {
      title: '2. Feature Engineering',
      id: trace.featureSnapshotId,
      icon: Cpu,
      desc: 'Point-in-time calculation (ATR, Order Flow Imbalance, VWAP, Volatility Regime).',
      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30'
    },
    {
      title: '3. Deterministic Signal & ML Prediction',
      id: `${trace.deterministicAnalysisId} • ${trace.mlPredictionId}`,
      icon: Brain,
      desc: `State: ${trace.decisionFusionState}. GBDT Out-of-Sample Probability.`,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/30'
    },
    {
      title: '4. Risk Decision & Gate',
      id: trace.riskDecisionId,
      icon: Shield,
      desc: 'Pre-order 20-gate matrix evaluated: Margin, Exposure, Spread, SL/TP bounds.',
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    },
    {
      title: '5. Immutable Order Proposal',
      id: trace.orderProposalId,
      icon: FileCode,
      desc: 'Cryptographically signed order specification with invariant validation.',
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30'
    },
    {
      title: '6. Broker Demo Order & Execution',
      id: `Broker Order: ${trace.brokerOrderId || 'BRK-ACK-OK'} | Fills: ${trace.fillIds.join(', ')}`,
      icon: Zap,
      desc: 'Dispatched to Sandbox API. Idempotent clientOrderId verified.',
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    },
    {
      title: '7. Research Database Linking',
      id: trace.researchRecordId,
      icon: Database,
      desc: `Linked to Dataset: ${trace.datasetVersion}, Strategy: v${trace.strategyVersion}, Model: v${trace.modelVersion}`,
      color: 'text-rose-400 bg-rose-500/10 border-rose-500/30'
    }
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-5 font-mono text-xs max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Link className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-white text-sm">
                Signal-to-Order Traceability Ledger
              </h3>
              <p className="text-slate-400 text-[11px]">
                Deterministic lineage from raw market tick to permanent research record.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div key={idx} className="relative pl-6 border-l-2 border-slate-800 space-y-1">
                <div className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-slate-950 border border-slate-700 flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5 text-slate-300" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">{step.title}</span>
                  <span className="text-[10px] text-slate-500">Step {idx + 1} of {steps.length}</span>
                </div>
                <div className={`p-2 rounded border font-mono text-[11px] break-all ${step.color}`}>
                  {step.id}
                </div>
                <div className="text-slate-400 text-[11px]">{step.desc}</div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-slate-800 pt-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition"
          >
            Close Trace Explorer
          </button>
        </div>
      </div>
    </div>
  );
};
