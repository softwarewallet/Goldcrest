import React, { useState } from 'react';
import {
  Server,
  Key,
  ShieldAlert,
  Sliders,
  Play,
  FileText,
  ShieldCheck,
  Award,
  Layers,
  CheckCircle2,
  Lock,
  Cpu,
  Activity,
  Download
} from 'lucide-react';
import { BrokerSettingsPanel } from './BrokerSettingsPanel';
import { ModelGovernanceDashboard } from './ModelGovernanceDashboard';
import { BrokerType, TradingEnvironment } from '../brokers/types';

interface SettingsHubProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}


const LiveRuntimeLogSettings: React.FC = () => {
  const [status, setStatus] = useState<{
    enabled: boolean;
    file: string;
    exists: boolean;
    sizeBytes: number;
    lastModifiedAt: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    try {
      const res = await fetch('/api/live-log/status');
      const data = await res.json();
      if (res.ok) setStatus(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to read log status.');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const toggle = async () => {
    setBusy(true);
    setMessage('');
    try {
      const endpoint = status?.enabled ? '/api/live-log/stop' : '/api/live-log/start';
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to change log state.');
      setStatus({ ...status, ...data, file: data.file || status?.file || '' });
      setMessage(status?.enabled ? 'Live runtime logging stopped.' : 'Live runtime logging started.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to change log state.');
    } finally {
      setBusy(false);
    }
  };

  const openLog = () => {
    window.open('/api/live-log/file', '_blank', 'noopener,noreferrer');
  };

  const sizeLabel = status ? `${(status.sizeBytes / 1024).toFixed(1)} KB` : '—';

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">LIVE Runtime Audit Log</h3>
            </div>
            <p className="text-xs text-slate-400 mt-2 max-w-3xl">
              Records sanitized live-environment events to a normal text file so runtime activity can be audited after a trading session.
              Credentials and access tokens are redacted before anything is written.
            </p>
          </div>
          <div className={`px-3 py-1 rounded border text-xs font-bold font-mono ${
            status?.enabled
              ? 'text-emerald-300 bg-emerald-950/60 border-emerald-700'
              : 'text-amber-300 bg-amber-950/60 border-amber-700'
          }`}>
            {status?.enabled ? 'RECORDING' : 'STOPPED'}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mt-5">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] uppercase text-slate-500 font-mono">FILE</div>
            <div className="text-xs text-slate-200 font-mono mt-1 break-all">{status?.file || 'logs/goldcrest-live.log'}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] uppercase text-slate-500 font-mono">SIZE</div>
            <div className="text-xs text-slate-200 font-mono mt-1">{sizeLabel}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[10px] uppercase text-slate-500 font-mono">LAST UPDATE</div>
            <div className="text-xs text-slate-200 font-mono mt-1">{status?.lastModifiedAt ? new Date(status.lastModifiedAt).toLocaleString() : '—'}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5">
          <button
            onClick={toggle}
            disabled={busy}
            className={`px-4 py-2 rounded text-xs font-bold border disabled:opacity-50 ${
              status?.enabled
                ? 'bg-rose-950/60 border-rose-700 text-rose-300 hover:bg-rose-900/60'
                : 'bg-emerald-700 border-emerald-600 text-white hover:bg-emerald-600'
            }`}
          >
            {busy ? 'WORKING…' : status?.enabled ? 'STOP LIVE LOG' : 'START LIVE LOG'}
          </button>
          <button
            onClick={openLog}
            disabled={!status?.exists}
            className="px-4 py-2 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50"
          >
            <Download className="inline w-3.5 h-3.5 mr-1" /> OPEN LOG
          </button>
          <button
            onClick={() => void refresh()}
            className="px-4 py-2 rounded bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold"
          >
            REFRESH STATUS
          </button>
          {message && <span className="text-[10px] text-slate-400 font-mono">{message}</span>}
        </div>
      </div>

      <div className="bg-cyan-950/20 border border-cyan-900 rounded-xl p-4 text-xs text-slate-300">
        <div className="font-bold text-cyan-300">Audit workflow</div>
        <div className="mt-2 font-mono text-[11px] leading-5">
          START LIVE LOG → run your live test → STOP LIVE LOG → provide <span className="text-cyan-300">logs/goldcrest-live.log</span> for audit.
        </div>
      </div>
    </div>
  );
};

export const SettingsHub: React.FC<SettingsHubProps> = ({
  currentEnvironment,
  selectedBroker,
  onEnvironmentChange,
  onBrokerSelect,
  onRefreshGlobal
}) => {
  const [activeSettingsSection, setActiveSettingsSection] = useState<'BROKER_CONFIG' | 'GOVERNANCE' | 'LIVE_LOG'>('BROKER_CONFIG');

  return (
    <div id="unified_settings_hub" className="space-y-4">
      {/* Top Settings Sub-Navigation Tabs */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-2 px-3 shadow-md">
        <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-mono">
          <span className="text-slate-500 font-semibold px-2 uppercase text-[10px] hidden sm:inline">
            SETTINGS AREA:
          </span>
          {[
            { id: 'BROKER_CONFIG', label: 'BROKER & RISK CONFIGURATION', icon: Server },
            { id: 'GOVERNANCE', label: 'MODEL GOVERNANCE & READINESS GATES', icon: ShieldCheck },
            { id: 'LIVE_LOG', label: 'LIVE RUNTIME LOG', icon: Activity }
          ].map(tab => {
            const Icon = tab.icon;
            const isSel = activeSettingsSection === tab.id;
            return (
              <button
                key={tab.id}
                id={`settings_section_${tab.id.toLowerCase()}`}
                onClick={() => setActiveSettingsSection(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-lg font-bold transition whitespace-nowrap ${
                  isSel
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="hidden md:flex items-center space-x-2 text-[11px] font-mono text-slate-400">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>Encrypted Secure Storage</span>
        </div>
      </div>

      {activeSettingsSection === 'LIVE_LOG' && (
        <LiveRuntimeLogSettings />
      )}

      {/* Render Selected Sub-Section */}
      {activeSettingsSection === 'BROKER_CONFIG' && (
        <BrokerSettingsPanel
          currentEnvironment={currentEnvironment}
          selectedBroker={selectedBroker}
          onEnvironmentChange={onEnvironmentChange}
          onBrokerSelect={onBrokerSelect}
          onRefreshGlobal={onRefreshGlobal}
        />
      )}

      {activeSettingsSection === 'GOVERNANCE' && (
        <ModelGovernanceDashboard />
      )}
    </div>
  );
};
