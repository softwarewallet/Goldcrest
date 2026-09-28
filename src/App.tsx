import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { MarketHub } from './components/MarketHub';
import { SignalsView } from './components/SignalsView';
import { TradingHub } from './components/TradingHub';
import { TradingOperationsDashboard } from './components/TradingOperationsDashboard';
import { TradingControlCenter } from './components/TradingControlCenter';
import { HistoryPage } from './components/HistoryPage';
import { DatabaseExplorerPage } from './components/DatabaseExplorerPage';
import { SettingsHub } from './components/SettingsHub';
import { ForexTerminalDashboard } from './components/ForexTerminalDashboard';
import { GlobalAppShell } from './components/GlobalAppShell';
import { SignalModal } from './components/SignalModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { OrderConfirmationModal } from './components/OrderConfirmationModal';
import { TradingSignal, Candle, ForexSessionState } from './markets/common/types';
import { getForexSessionState } from './markets/common/session';
import { BrokerType, TradingEnvironment, OrderRequest } from './brokers/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('forex_terminal');
  const [forexPairs, setForexPairs] = useState<any[]>([]);
  const [forexSessions, setForexSessions] = useState<ForexSessionState>(() => getForexSessionState(new Date()));
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [candlesMap, setCandlesMap] = useState<Record<string, Candle[]>>({});
  const [selectedSignal, setSelectedSignal] = useState<TradingSignal | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const terminalRefreshInFlightRef = useRef<Promise<void> | null>(null);

  const [environment] = useState<TradingEnvironment>('LIVE');
  const [selectedBroker] = useState<BrokerType>('CTRADER');
  const [maskedAccount, setMaskedAccount] = useState('****');
  const [currency, setCurrency] = useState('USD');
  const [balance, setBalance] = useState(0);
  const [isEmergencyHalted, setIsEmergencyHalted] = useState(false);
  const [autoTradingStatus, setAutoTradingStatus] = useState<any | null>(null);
  const [activeForexUniverse, setActiveForexUniverse] = useState<string[]>([]);
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setForexSessions(getForexSessionState(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshBrokerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/brokers/status', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setIsEmergencyHalted(Boolean(data.emergencyStop?.isHalted));
      const account = data.activeAccount || data.brokers?.find((item: any) => item.broker === 'CTRADER')?.account;
      if (account) {
        setMaskedAccount(String(account.accountId || '****'));
        setCurrency(String(account.currency || 'USD'));
        setBalance(Number(account.balance || 0));
      } else {
        const cred = data.credentials?.find((item: any) => item.broker === 'CTRADER');
        if (cred) setMaskedAccount(cred.maskedAccountId || cred.maskedClientId || '****');
      }
    } catch (err) {
      console.warn('Broker status endpoint temporarily unavailable:', err);
    }
  }, []);

  const safeFetchJson = useCallback(async (url: string, fallback: any = []) => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
    return fallback;
  }, []);

  const refreshTerminalData = useCallback(async (showSpinner = true) => {
    if (terminalRefreshInFlightRef.current) return terminalRefreshInFlightRef.current;
    const run = (async () => {
      if (showSpinner) setIsRefreshing(true);
      try {
        const [fxPairs, sigs, autoStatus, config] = await Promise.all([
          safeFetchJson('/api/forex/pairs'),
          safeFetchJson('/api/signals/all'),
          safeFetchJson('/api/auto-trading/status', null),
          safeFetchJson('/api/config', null)
        ]);

        if (config && Array.isArray(config.autoLiveForexPairs)) {
          setActiveForexUniverse(config.autoLiveForexPairs);
        }

        const selected = Array.isArray(config?.autoLiveForexPairs)
          ? new Set(config.autoLiveForexPairs.map((item: unknown) => String(item).toUpperCase()))
          : null;

        if (Array.isArray(fxPairs) && fxPairs.length) {
          setForexPairs(selected
            ? fxPairs.filter((row: any) => selected.has(String(row?.symbol || '').toUpperCase()))
            : fxPairs);
        }

        if (Array.isArray(sigs) && sigs.length) setSignals(sigs);
        if (autoStatus && typeof autoStatus === 'object') setAutoTradingStatus(autoStatus);

        const candles = await safeFetchJson('/api/candles/EUR%2FUSD');
        if (Array.isArray(candles) && candles.length) {
          setCandlesMap(prev => ({ ...prev, 'EUR/USD': candles }));
        }
      } catch (err) {
        console.error('Failed to load Forex terminal data:', err);
      } finally {
        if (showSpinner) setIsRefreshing(false);
        setLoadingInitial(false);
      }
    })();
    terminalRefreshInFlightRef.current = run;
    try { await run; } finally { terminalRefreshInFlightRef.current = null; }
  }, [safeFetchJson]);

  useEffect(() => {
    void refreshBrokerStatus();
    void refreshTerminalData(true);
    const timer = setInterval(() => void refreshTerminalData(false), 30000);
    return () => clearInterval(timer);
  }, [refreshBrokerStatus, refreshTerminalData]);

  const handleToggleKillSwitch = async () => {
    const action = isEmergencyHalted ? 'RESUME' : 'HALT';
    if (action === 'HALT' && !confirm('CRITICAL: Are you sure you want to trigger the EMERGENCY STOP? This will cancel all pending orders and immediately block any new trade orders.')) return;
    try {
      const res = await fetch('/api/brokers/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: 'Operator manual UI button' })
      });
      if (res.ok) {
        const data = await res.json();
        setIsEmergencyHalted(Boolean(data.emergencyStop?.isHalted));
      }
    } catch (err) {
      console.error('Failed to change emergency stop state:', err);
    }
  };

  const ensureCandlesLoaded = useCallback(async (symbol: string) => {
    if (!symbol) return;
    const encoded = encodeURIComponent(symbol);
    try {
      const res = await fetch('/api/candles/' + encoded, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setCandlesMap(prev => ({ ...prev, [symbol]: data }));
      }
    } catch {}
  }, []);

  const handleExecuteConfirmedOrder = async (confirmedOrder: OrderRequest) => {
    setPendingOrder(null);
    try {
      const idempotencyKey = confirmedOrder.signalId || `manual-${confirmedOrder.symbol}-${confirmedOrder.side}-${Date.now()}`;
      const res = await fetch('/api/brokers/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          ...confirmedOrder,
          broker: 'CTRADER',
          environment: 'LIVE',
          operatorConfirmed: true
        })
      });
      const data = await res.json();
      if (res.ok && (data.success || ['EXECUTED', 'ACCEPTED', 'PARTIALLY_FILLED', 'DUPLICATE_REPLAY'].includes(data.status))) {
        alert(`Order placed. Broker: cTrader. ID: ${data.order?.orderId || data.order?.id || '—'}. Status: ${data.order?.status || data.status}`);
        await refreshBrokerStatus();
      } else {
        alert(`Order rejected / failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Order execution error: ${err?.message || String(err)}`);
    }
  };

  return (
    <GlobalAppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      forexSessionLabel={forexSessions.activeSessions.join(' / ') || 'CLOSED'}
      forexOpen={forexSessions.activeSessions.length > 0 && !forexSessions.activeSessions.includes('CLOSED (WEEKEND)')}
      header={
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          onRefresh={() => refreshTerminalData(true)}
          isRefreshing={isRefreshing}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          environment={environment}
          onRequestEnvironmentChange={() => undefined}
          selectedBroker={selectedBroker}
          maskedAccount={maskedAccount}
          autoTradingStatus={autoTradingStatus}
          isEmergencyHalted={isEmergencyHalted}
          onToggleKillSwitch={handleToggleKillSwitch}
        />
      }
    >
      <main className="min-h-[calc(100vh-162px)] w-full px-4 sm:px-6 lg:px-8 py-5 space-y-4 bg-[#03070d] text-slate-100">
        {loadingInitial ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3 font-mono">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-slate-300">Initializing Forex Trading Terminal...</div>
            <div className="text-xs text-slate-500">Loading cTrader, SQLite, market data and risk gates</div>
          </div>
        ) : (
          <>
            {activeTab === 'forex_terminal' && (
              <ForexTerminalDashboard
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                forexSessions={forexSessions}
                selectedBroker={selectedBroker}
                environment={environment}
                maskedAccount={maskedAccount}
                balance={balance}
                currency={currency}
                isEmergencyHalted={isEmergencyHalted}
                isRefreshing={isRefreshing}
                onRefresh={() => refreshTerminalData(true)}
                onToggleKillSwitch={handleToggleKillSwitch}
                candlesMap={candlesMap}
                forexPairs={forexPairs}
                signals={signals}
                onSelectSignal={setSelectedSignal}
                onRequestOrder={setPendingOrder}
              />
            )}

            {activeTab === 'market_watch' && (
              <MarketHub
                forexPairs={forexPairs}
                candlesMap={candlesMap}
                onSelectSignal={setSelectedSignal}
                onEnsureCandles={ensureCandlesLoaded}
                environment={environment}
              />
            )}

            {activeTab === 'signals' && <SignalsView signals={signals} onSelectSignal={setSelectedSignal} />}

            {activeTab === 'trading' && (
              <TradingHub
                environment={environment}
                selectedBroker={selectedBroker}
                maskedAccount={maskedAccount}
                balance={balance}
                currency={currency}
                isEmergencyHalted={isEmergencyHalted}
                onRequestEnvironmentChange={() => undefined}
              />
            )}

            {(activeTab === 'pnl' || activeTab === 'accounting') && (
              <TradingControlCenter
                initialSection="ACCOUNT_OVERVIEW"
                reportsMode
                onSelectSignalModal={setSelectedSignal}
                autoTradingStatus={autoTradingStatus}
                onAutoTradingStatusChange={setAutoTradingStatus}
              />
            )}

            {(activeTab === 'control_center' || activeTab === 'operations' || activeTab === 'reconciliation' || activeTab === 'reconcile') && (
              <TradingControlCenter
                onSelectSignalModal={setSelectedSignal}
                autoTradingStatus={autoTradingStatus}
                onAutoTradingStatusChange={setAutoTradingStatus}
              />
            )}

            {activeTab === 'alerts' && <TradingOperationsDashboard initialSubTab="OPS" />}
            {activeTab === 'history' && <HistoryPage />}
            {activeTab === 'database' && <DatabaseExplorerPage />}
            {activeTab === 'settings' && (
              <SettingsHub
                currentEnvironment={environment}
                selectedBroker={selectedBroker}
                onEnvironmentChange={() => undefined}
                onBrokerSelect={() => undefined}
                onRefreshGlobal={refreshBrokerStatus}
              />
            )}
          </>
        )}
      </main>

      {selectedSignal && <SignalModal signal={selectedSignal} onClose={() => setSelectedSignal(null)} />}
      {showDiagnostics && <DiagnosticsModal onClose={() => setShowDiagnostics(false)} />}
      {pendingOrder && (
        <OrderConfirmationModal
          isOpen
          onClose={() => setPendingOrder(null)}
          onConfirm={handleExecuteConfirmedOrder}
          order={pendingOrder}
          broker="CTRADER"
          environment="LIVE"
          maskedAccount={maskedAccount}
          currentPrice={pendingOrder.price || 0}
        />
      )}
    </GlobalAppShell>
  );
}
