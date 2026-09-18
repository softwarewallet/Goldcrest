import React, { useEffect, useState } from 'react';
import { Server, ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Lock, Database } from 'lucide-react';
import { BrokerCredentialStatus, BrokerType, TradingEnvironment, ConnectionTestResult } from '../brokers/types';

interface BrokerSettingsPanelProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker?: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect?: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}

type LiveForm = Record<string, string>;

const emptyCTrader: LiveForm = { clientId: '', clientSecret: '', accessToken: '', accountId: '' };
const emptyFivePaisa: LiveForm = { appName: '', appSource: '', userId: '', password: '', userKey: '', encryptionKey: '', clientCode: '', accessToken: '', totpSecret: '', pin: '' };

export const BrokerSettingsPanel: React.FC<BrokerSettingsPanelProps> = ({
  currentEnvironment,
  onRefreshGlobal
}) => {
  const [statuses, setStatuses] = useState<BrokerCredentialStatus[]>([]);
  const [results, setResults] = useState<Record<string, ConnectionTestResult | null>>({});
  const [forms, setForms] = useState<Record<'CTRADER' | 'FIVE_PAISA', LiveForm>>({
    CTRADER: { ...emptyCTrader },
    FIVE_PAISA: { ...emptyFivePaisa }
  });
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/brokers/status');
      if (res.ok) {
        const data = await res.json();
        setStatuses(data.credentials || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateField = (broker: 'CTRADER' | 'FIVE_PAISA', key: string, value: string) =>
    setForms(prev => ({ ...prev, [broker]: { ...prev[broker], [key]: value } }));

  const save = async (broker: 'CTRADER' | 'FIVE_PAISA') => {
    if (!ack) {
      alert('Acknowledge the LIVE broker credential warning before saving.');
      return;
    }
    setSaving(broker);
    try {
      const credentials = Object.fromEntries(Object.entries(forms[broker]).filter(([, v]) => String(v).trim() !== ''));
      const res = await fetch('/api/brokers/credentials/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, credentials, userConfirmedAcknowledge: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Credential update failed');
      setForms(prev => ({ ...prev, [broker]: broker === 'CTRADER' ? { ...emptyCTrader } : { ...emptyFivePaisa } }));
      await load();
      onRefreshGlobal?.();
    } catch (err: any) {
      alert(err.message || 'Credential update failed');
    } finally {
      setSaving(null);
    }
  };

  const test = async (broker: 'CTRADER' | 'FIVE_PAISA') => {
    setTesting(broker);
    try {
      const res = await fetch('/api/brokers/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      const data = await res.json();
      const result = Array.isArray(data.results) ? data.results[0] : data;
      setResults(prev => ({ ...prev, [broker]: result }));
      await load();
    } catch (err: any) {
      setResults(prev => ({ ...prev, [broker]: {
        broker, environment: 'LIVE', connected: false, timestamp: Date.now(), error: err.message
      }}));
    } finally {
      setTesting(null);
    }
  };

  const statusFor = (broker: BrokerType) => statuses.find(s => s.broker === broker && s.environment === 'LIVE');
  const inputClass = 'w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono outline-none focus:border-emerald-600';
  const Field = ({ broker, name, label, secret=false }: { broker: 'CTRADER'|'FIVE_PAISA'; name: string; label: string; secret?: boolean }) => (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase text-slate-500 font-mono">{label}</span>
      <input className={inputClass} type={secret ? 'password' : 'text'} value={forms[broker][name] || ''} onChange={e => updateField(broker, name, e.target.value)} autoComplete="off" />
    </label>
  );

  return (
    <div id="broker_settings_panel" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-white">LIVE Broker Configuration</div>
            <p className="text-xs text-slate-400 mt-1">Goldcrest is LIVE-only. Both broker APIs remain active simultaneously; market type determines routing. Broker credentials are held by the server and must never be exposed in the client UI.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-xs text-amber-300 font-mono">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          I acknowledge that these credentials access LIVE broker accounts.
        </label>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        {(['CTRADER', 'FIVE_PAISA'] as const).map(broker => {
          const s = statusFor(broker);
          const result = results[broker];
          const isC = broker === 'CTRADER';
          return (
            <div key={broker} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Server className="w-4 h-4 text-cyan-400" /><h3 className="text-sm font-bold text-white">{isC ? 'cTrader' : '5paisa'} LIVE</h3></div>
                <span className={s?.configured ? 'text-emerald-400 text-[10px] font-bold' : 'text-amber-400 text-[10px] font-bold'}>{s?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {isC ? <>
                  <Field broker={broker} name="clientId" label="Client ID" />
                  <Field broker={broker} name="clientSecret" label="Client Secret" secret />
                  <Field broker={broker} name="accessToken" label="Access Token" secret />
                  <Field broker={broker} name="accountId" label="Account ID" />
                </> : <>
                  <Field broker={broker} name="appName" label="App Name" />
                  <Field broker={broker} name="appSource" label="App Source" />
                  <Field broker={broker} name="userId" label="User ID" />
                  <Field broker={broker} name="password" label="Password" secret />
                  <Field broker={broker} name="userKey" label="User Key" secret />
                  <Field broker={broker} name="encryptionKey" label="Encryption Key" secret />
                  <Field broker={broker} name="clientCode" label="Client Code" />
                  <Field broker={broker} name="accessToken" label="Access Token" secret />
                </>}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => save(broker)} disabled={saving === broker} className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold">
                  {saving === broker ? 'SAVING…' : 'SAVE LIVE CREDENTIALS'}
                </button>
                <button onClick={() => test(broker)} disabled={testing === broker || loading} className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold border border-slate-700">
                  <RefreshCw className={`inline w-3 h-3 mr-1 ${testing === broker ? 'animate-spin' : ''}`} /> TEST CONNECTION
                </button>
              </div>
              {result && (
                <div className={`mt-3 p-3 rounded border text-xs font-mono ${result.connected ? 'border-emerald-800 bg-emerald-950/30' : 'border-rose-800 bg-rose-950/30'}`}>
                  <div className="flex items-center gap-2 font-bold">{result.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}{result.connected ? 'CONNECTED' : 'UNAVAILABLE'}</div>
                  {result.connected && <div className="mt-1 text-slate-400">Account: {result.account || '—'} · {result.currency || '—'} {typeof result.balance === 'number' ? result.balance.toLocaleString() : '—'}</div>}
                  {!result.connected && <div className="mt-1 text-rose-300 break-words">{result.error || 'Connection unavailable'}</div>}
                </div>
              )}
              {s?.lastTestResult && !result && (
                <div className="mt-3 text-[10px] text-slate-500 font-mono">Last test: {s.lastTestResult.connected ? 'CONNECTED' : 'FAILED'}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-cyan-400" /><span className="text-sm font-bold text-white">Routing & Safety</span></div>
        <div className="grid md:grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">FOREX → <strong className="text-emerald-400">cTrader LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_EQUITY → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_FUTURES → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">INDIAN_OPTIONS → <strong className="text-emerald-400">5paisa LIVE</strong></div>
          <div className="p-2 bg-slate-950 border border-rose-900 rounded">AUTONOMOUS LIVE EXECUTION → <strong className="text-rose-400">BLOCKED</strong></div>
          <div className="p-2 bg-slate-950 border border-cyan-900 rounded">APPLICATION PERSISTENCE → <strong className="text-cyan-400">SQLITE</strong></div>
        </div>
      </div>

      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2"><Database className="w-3 h-3" /> Environment enforced by server: LIVE_ONLY. No paper/demo credential workflow is exposed.</div>
    </div>
  );
};
