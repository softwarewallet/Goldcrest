import React, { useEffect, useState } from 'react';
import { Server, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Lock, Sliders, Database } from 'lucide-react';
import { BrokerCredentialStatus, ConnectionTestResult, BrokerType, TradingEnvironment } from '../brokers/types';

interface BrokerSettingsPanelProps {
  currentEnvironment: TradingEnvironment;
  selectedBroker?: BrokerType;
  onEnvironmentChange: (env: TradingEnvironment) => void;
  onBrokerSelect?: (broker: BrokerType) => void;
  onRefreshGlobal?: () => void;
}

type CTraderForm = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  accountId: string;
};

const emptyCTrader: CTraderForm = {
  clientId: '',
  clientSecret: '',
  accessToken: '',
  accountId: ''
};

export const BrokerSettingsPanel: React.FC<BrokerSettingsPanelProps> = ({
  onRefreshGlobal
}) => {
  const [status, setStatus] = useState<BrokerCredentialStatus | null>(null);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [form, setForm] = useState<CTraderForm>({ ...emptyCTrader });
  const [ack, setAck] = useState(false);
  const [cTraderApiMode, setCTraderApiMode] = useState<'LIVE' | 'DEMO'>('DEMO');
  const [maxForexUsd, setMaxForexUsd] = useState(100000);
  const [forexStopLossPips, setForexStopLossPips] = useState(20);
  const [forexTakeProfitPips, setForexTakeProfitPips] = useState(40);
  const [autoLiveMinSignalScore, setAutoLiveMinSignalScore] = useState(75);
  const [autoLiveMaxTradesPerPair, setAutoLiveMaxTradesPerPair] = useState(4);
  const [maxOpenPositions, setMaxOpenPositions] = useState(5);
  const [autoLiveForexPairs, setAutoLiveForexPairs] = useState<string[]>([
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'
  ]);
  const [newForexPair, setNewForexPair] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [savingControls, setSavingControls] = useState(false);
  const [savingUniverse, setSavingUniverse] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch('/api/brokers/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/config', { cache: 'no-store' }).catch(() => null)
      ]);
      if (statusRes?.ok) {
        const data = await statusRes.json();
        const next = Array.isArray(data?.credentials)
          ? data.credentials.find((item: BrokerCredentialStatus) => item.broker === 'CTRADER')
          : null;
        setStatus(next || null);
      }
      if (configRes?.ok) {
        const config = await configRes.json();
        if (config.cTraderApiMode === 'LIVE' || config.cTraderApiMode === 'DEMO') setCTraderApiMode(config.cTraderApiMode);
        if (Number.isFinite(Number(config.maxTradeValueForexUsd))) setMaxForexUsd(Number(config.maxTradeValueForexUsd));
        if (Number.isFinite(Number(config.forexStopLossPips))) setForexStopLossPips(Number(config.forexStopLossPips));
        if (Number.isFinite(Number(config.forexTakeProfitPips))) setForexTakeProfitPips(Number(config.forexTakeProfitPips));
        if (Number.isFinite(Number(config.autoLiveMinSignalScore))) setAutoLiveMinSignalScore(Number(config.autoLiveMinSignalScore));
        if (Number.isFinite(Number(config.autoLiveMaxTradesPerPair))) setAutoLiveMaxTradesPerPair(Number(config.autoLiveMaxTradesPerPair));
        if (Number.isFinite(Number(config.maxOpenPositions))) setMaxOpenPositions(Number(config.maxOpenPositions));
        if (Array.isArray(config.autoLiveForexPairs) && config.autoLiveForexPairs.length) setAutoLiveForexPairs(config.autoLiveForexPairs);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const update = (key: keyof CTraderForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const saveCredentials = async () => {
    if (!ack) {
      setMessage('Acknowledge the cTrader credential warning before saving.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const credentials = Object.fromEntries(
        Object.entries(form).filter(([, value]) => String(value).trim() !== '')
      );
      const res = await fetch('/api/brokers/credentials/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker: 'CTRADER', credentials, userConfirmedAcknowledge: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'cTrader credential update failed.');
      setForm({ ...emptyCTrader });
      setMessage('cTrader credentials saved.');
      await load();
      onRefreshGlobal?.();
    } catch (err: any) {
      setMessage(err?.message || 'cTrader credential update failed.');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setMessage('');
    try {
      const res = await fetch('/api/brokers/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker: 'CTRADER' })
      });
      const data = await res.json().catch(() => ({}));
      const next = Array.isArray(data?.results) ? data.results[0] : data;
      setResult(next || null);
      if (!res.ok) setMessage(next?.error || 'cTrader connection test failed.');
      else setMessage(next?.connected ? 'cTrader connection test completed.' : (next?.error || 'cTrader connection unavailable.'));
      await load();
    } catch (err: any) {
      setMessage(err?.message || 'cTrader connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  const saveMode = async () => {
    setSavingMode(true);
    setMessage('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cTraderApiMode })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save cTrader API mode.');
      setMessage('cTrader API mode saved as ' + cTraderApiMode + '.');
      onRefreshGlobal?.();
    } catch (err: any) {
      setMessage(err?.message || 'Failed to save cTrader API mode.');
    } finally {
      setSavingMode(false);
    }
  };

  const saveControls = async () => {
    const score = Number(autoLiveMinSignalScore);
    const pairLimit = Number(autoLiveMaxTradesPerPair);
    const systemLimit = Number(maxOpenPositions);
    const tradeValue = Number(maxForexUsd);
    const stopLossPips = Number(forexStopLossPips);
    const takeProfitPips = Number(forexTakeProfitPips);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      setMessage('Minimum signal score must be an integer from 0 to 100.');
      return;
    }
    if (!Number.isInteger(pairLimit) || pairLimit < 1 || pairLimit > 20) {
      setMessage('Maximum trades per pair must be an integer from 1 to 20.');
      return;
    }
    if (!Number.isInteger(systemLimit) || systemLimit < 1 || systemLimit > 100) {
      setMessage('Maximum system positions must be an integer from 1 to 100.');
      return;
    }
    if (!Number.isFinite(tradeValue) || tradeValue <= 0) {
      setMessage('Maximum Forex trade value must be positive.');
      return;
    }
    if (!Number.isFinite(stopLossPips) || stopLossPips <= 0) {
      setMessage('Forex Stop Loss must be greater than 0 pips.');
      return;
    }
    if (!Number.isFinite(takeProfitPips) || takeProfitPips <= 0) {
      setMessage('Forex Take Profit must be greater than 0 pips.');
      return;
    }
    setSavingControls(true);
    setMessage('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxTradeValueForexUsd: tradeValue,
          forexStopLossPips: stopLossPips,
          forexTakeProfitPips: takeProfitPips,
          autoLiveMinSignalScore: score,
          autoLiveMaxTradesPerPair: pairLimit,
          maxOpenPositions: systemLimit
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save Forex Auto Live controls.');
      setMessage('Forex Auto Live controls saved.');
      onRefreshGlobal?.();
    } catch (err: any) {
      setMessage(err?.message || 'Failed to save Forex Auto Live controls.');
    } finally {
      setSavingControls(false);
    }
  };

  const saveUniverse = async () => {
    if (!autoLiveForexPairs.length) {
      setMessage('Select at least one Forex pair.');
      return;
    }
    setSavingUniverse(true);
    setMessage('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoLiveForexPairs })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save Forex working universe.');
      setMessage('Forex working universe saved.');
      onRefreshGlobal?.();
    } catch (err: any) {
      setMessage(err?.message || 'Failed to save Forex working universe.');
    } finally {
      setSavingUniverse(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono outline-none focus:border-emerald-600';

  return (
    <div id="broker_settings_panel" className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-emerald-400 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-white">cTrader Forex Configuration</div>
            <p className="text-xs text-slate-400 mt-1">
              Goldcrest is a Forex-only terminal. cTrader is the sole broker integration. The cTrader Open API selector controls whether the broker transport uses LIVE or DEMO; Goldcrest's application trading environment remains LIVE_ONLY.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <div className="rounded-lg border border-cyan-900/60 bg-slate-950 p-4">
            <div className="text-[10px] uppercase text-cyan-300 font-mono mb-2">cTrader Open API Mode</div>
            <div className="flex items-end gap-2">
              <select value={cTraderApiMode} onChange={e => setCTraderApiMode(e.target.value as 'LIVE' | 'DEMO')} className={inputClass}>
                <option value="LIVE">LIVE</option>
                <option value="DEMO">DEMO</option>
              </select>
              <button type="button" disabled={savingMode} onClick={saveMode} className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-bold">
                {savingMode ? 'SAVING...' : 'SAVE MODE'}
              </button>
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-2">Selected mode controls the cTrader Open API endpoint and account discovery.</div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-slate-500 font-mono">cTrader Credential Status</span>
              <span className={status?.configured ? 'text-emerald-400 text-xs font-bold' : 'text-amber-400 text-xs font-bold'}>
                {loading ? 'LOADING' : status?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
              </span>
            </div>
            <div className="mt-2 text-xs font-mono text-slate-300">Account: {status?.maskedAccountId || '—'}</div>
            <div className="text-xs font-mono text-slate-500 mt-1">Transport: cTrader {cTraderApiMode}</div>
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 text-xs text-amber-300 font-mono">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          I acknowledge that these credentials access the selected cTrader environment.
        </label>

        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <label><span className="text-[10px] uppercase text-slate-500 font-mono">Client ID</span><input className={inputClass} value={form.clientId} onChange={e => update('clientId', e.target.value)} autoComplete="off" /></label>
          <label><span className="text-[10px] uppercase text-slate-500 font-mono">Client Secret</span><input className={inputClass} type="password" value={form.clientSecret} onChange={e => update('clientSecret', e.target.value)} autoComplete="off" /></label>
          <label><span className="text-[10px] uppercase text-slate-500 font-mono">Access Token</span><input className={inputClass} type="password" value={form.accessToken} onChange={e => update('accessToken', e.target.value)} autoComplete="off" /></label>
          <label><span className="text-[10px] uppercase text-slate-500 font-mono">Account ID</span><input className={inputClass} value={form.accountId} onChange={e => update('accountId', e.target.value)} autoComplete="off" /></label>
        </div>

        <div className="flex gap-2 mt-3">
          <button type="button" onClick={saveCredentials} disabled={saving} className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold">{saving ? 'SAVING...' : 'SAVE CREDENTIALS'}</button>
          <button type="button" onClick={testConnection} disabled={testing || loading} className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold border border-slate-700"><RefreshCw className={`inline w-3 h-3 mr-1 ${testing ? 'animate-spin' : ''}`} />{testing ? 'TESTING...' : 'TEST CONNECTION'}</button>
        </div>

        {result && (
          <div className={`mt-3 p-3 rounded border text-xs font-mono ${result.connected ? 'border-emerald-800 bg-emerald-950/30' : 'border-rose-800 bg-rose-950/30'}`}>
            <div className="flex items-center gap-2 font-bold">{result.connected ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}{result.connected ? 'CONNECTED' : 'UNAVAILABLE'}</div>
            <div className="mt-1 text-slate-400">Mode: {result.apiMode || cTraderApiMode} · Endpoint: {result.apiEndpoint || '—'}</div>
            {result.connected && <div className="mt-1 text-slate-400">Account: {result.account || '—'} · {result.accountType || '—'} · {result.currency || '—'} · Balance: {typeof result.balance === 'number' ? result.balance.toLocaleString() : '—'}</div>}
            {!result.connected && <div className="mt-1 text-rose-300 break-words">{result.error || 'Connection unavailable.'}</div>}
          </div>
        )}

        {message && <div className="mt-3 text-[10px] text-cyan-300 font-mono">{message}</div>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Forex Auto Live Controls</div>
            <p className="text-xs text-slate-400 mt-1">These are the server-side controls used by the autonomous Forex execution loop.</p>
            <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-3 mt-4">
              <label><span className="text-[10px] uppercase text-slate-500 font-mono">Max Forex Trade Value / Volume</span><input type="number" min="1" step="1" value={maxForexUsd} onChange={e => setMaxForexUsd(Number(e.target.value))} className={inputClass} /><span className="text-[10px] text-slate-600 font-mono">cTrader protocol contract</span></label>
              <label><span className="text-[10px] uppercase text-slate-500 font-mono">Stop Loss (pips)</span><input type="number" min="0.1" step="0.1" value={forexStopLossPips} onChange={e => setForexStopLossPips(Number(e.target.value))} className={inputClass} /></label>
              <label><span className="text-[10px] uppercase text-slate-500 font-mono">Take Profit (pips)</span><input type="number" min="0.1" step="0.1" value={forexTakeProfitPips} onChange={e => setForexTakeProfitPips(Number(e.target.value))} className={inputClass} /></label>
              <label><span className="text-[10px] uppercase text-slate-500 font-mono">Minimum Signal Score</span><input type="number" min="0" max="100" step="1" value={autoLiveMinSignalScore} onChange={e => setAutoLiveMinSignalScore(Number(e.target.value))} className={inputClass} /></label>
              <label><span className="text-[10px] uppercase text-slate-500 font-mono">Max Trades / Pair</span><input type="number" min="1" max="20" step="1" value={autoLiveMaxTradesPerPair} onChange={e => setAutoLiveMaxTradesPerPair(Number(e.target.value))} className={inputClass} /></label>
              <label><span className="text-[10px] uppercase text-slate-500 font-mono">Max Trades / System</span><input type="number" min="1" max="100" step="1" value={maxOpenPositions} onChange={e => setMaxOpenPositions(Number(e.target.value))} className={inputClass} /></label>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 font-mono">Stop Loss and Take Profit are configured in pips and applied when each Forex order is prepared. Defaults: SL 20 pips · TP 40 pips.</div>
            <button type="button" onClick={saveControls} disabled={savingControls} className="mt-3 px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold">{savingControls ? 'SAVING...' : 'SAVE FOREX AUTO LIVE CONTROLS'}</button>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-cyan-900/60 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sliders className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-white">Forex Working Universe</div>
            <p className="text-xs text-slate-400 mt-1">Select the Forex pairs Goldcrest actively monitors for Auto Live.</p>
            <div className="flex gap-2 mb-3 mt-3">
              <input value={newForexPair} onChange={e => setNewForexPair(e.target.value.toUpperCase())} placeholder="e.g. CAD/JPY" className={inputClass} />
              <button type="button" onClick={() => {
                const pair = newForexPair.trim().toUpperCase();
                if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) return setMessage('Use BASE/QUOTE format, e.g. CAD/JPY.');
                if (autoLiveForexPairs.includes(pair)) return setMessage(pair + ' is already selected.');
                setAutoLiveForexPairs(prev => [...prev, pair]);
                setNewForexPair('');
              }} className="shrink-0 px-3 py-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold">ADD PAIR</button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','AUD/JPY','EUR/AUD','GBP/AUD','XAU/USD'].map(pair => {
                const checked = autoLiveForexPairs.includes(pair);
                return <label key={pair} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer ${checked ? 'border-emerald-700 bg-emerald-950/30 text-emerald-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}>
                  <input type="checkbox" checked={checked} onChange={() => setAutoLiveForexPairs(prev => checked ? prev.filter(item => item !== pair) : [...prev, pair])} />
                  <span className="font-mono text-xs">{pair}</span>
                </label>;
              })}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button type="button" onClick={saveUniverse} disabled={savingUniverse || !autoLiveForexPairs.length} className="px-4 py-2 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs font-bold">{savingUniverse ? 'SAVING...' : 'SAVE FOREX WORKING UNIVERSE'}</button>
              <span className="text-[10px] text-slate-500 font-mono">{autoLiveForexPairs.length} Forex pairs selected</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-cyan-400" /><span className="text-sm font-bold text-white">Routing & Safety</span></div>
        <div className="grid md:grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">FOREX → <strong className="text-emerald-400">cTrader ({cTraderApiMode})</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">APPLICATION MODE → <strong className="text-cyan-400">LIVE_ONLY</strong></div>
          <div className="p-2 bg-slate-950 border border-slate-800 rounded">QUOTE SAFETY → <strong className="text-cyan-400">30s MAX AGE</strong></div>
          <div className="p-2 bg-slate-950 border border-rose-900 rounded">AUTONOMOUS EXECUTION → <strong className="text-rose-400">GATED</strong></div>
          <div className="p-2 bg-slate-950 border border-cyan-900 rounded flex items-center gap-2"><Database className="w-3 h-3" /> APPLICATION PERSISTENCE → <strong className="text-cyan-400">SQLITE</strong></div>
        </div>
      </div>
    </div>
  );
};
