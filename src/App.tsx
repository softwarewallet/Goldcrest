import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { MarketHub } from './components/MarketHub';
import { SignalsView } from './components/SignalsView';
import { TradingHub } from './components/TradingHub';
import { MLResearchDashboard } from './components/MLResearchDashboard';
import { TradingOperationsDashboard } from './components/TradingOperationsDashboard';
import { TradingControlCenter } from './components/TradingControlCenter';
import { PerformanceResearchCenterView } from './components/PerformanceResearchCenterView';
import { SettingsHub } from './components/SettingsHub';
import { TerminalDashboard } from './components/TerminalDashboard';
import { ForexTerminalDashboard } from './components/ForexTerminalDashboard';
import { GlobalAppShell } from './components/GlobalAppShell';
import { SignalModal } from './components/SignalModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { EnvironmentSwitchModal } from './components/EnvironmentSwitchModal';
import { OrderConfirmationModal } from './components/OrderConfirmationModal';
import { TradingSignal, Candle, ForexSessionState, IndianSessionState } from './markets/common/types';
import { getForexSessionState, getIndianSessionState } from './markets/common/session';
import { BrokerType, TradingEnvironment, OrderRequest } from './brokers/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('forex_terminal');
  const [forexPairs, setForexPairs] = useState<any[]>([]);
  const [forexSessions, setForexSessions] = useState<ForexSessionState>(() => getForexSessionState(new Date()));
  const [indianUnderlyings, setIndianUnderlyings] = useState<any[]>([]);
  const [indianSession, setIndianSession] = useState<IndianSessionState>(() => getIndianSessionState(new Date()));
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [candlesMap, setCandlesMap] = useState<Record<string, Candle[]>>({});
  const [selectedSignal, setSelectedSignal] = useState<TradingSignal | null>(null);
  const [selectedOptionUnderlying, setSelectedOptionUnderlying] = useState<string>('NIFTY');
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(true);

  // Broker Environment & Safety State
  const [environment, setEnvironment] = useState<TradingEnvironment>('LIVE');
  const [selectedBroker, setSelectedBroker] = useState<BrokerType>('CTRADER');
  const [maskedAccount, setMaskedAccount] = useState<string>('****');
  const [currency, setCurrency] = useState<string>('USD');
  const [balance, setBalance] = useState<number>(0);
  const [isEmergencyHalted, setIsEmergencyHalted] = useState<boolean>(false);

  // Modals for environment switch and order confirmation
  const [pendingEnvSwitch, setPendingEnvSwitch] = useState<TradingEnvironment | null>(null);
  const [pendingOrder, setPendingOrder] = useState<OrderRequest | null>(null);

  // Fetch Broker Status
  const refreshBrokerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/brokers/status');
      if (res.ok) {
        const data = await res.json();
        setEnvironment(data.environment || 'LIVE');
        setSelectedBroker(data.selectedBroker || 'CTRADER');
        setIsEmergencyHalted(data.emergencyStop?.isHalted || false);

        if (data.activeAccount) {
          setMaskedAccount(data.activeAccount.accountId || '****');
          setCurrency(data.activeAccount.currency || 'USD');
          setBalance(data.activeAccount.balance || 0);
        } else {
          const cred = data.credentials?.find((c: any) => c.broker === data.selectedBroker && c.environment === data.environment);
          if (cred) {
            setMaskedAccount(cred.maskedAccountId || cred.maskedClientId || '****');
          }
        }
      }
    } catch (err) {
      console.warn('Broker status endpoint temporarily unavailable, using LIVE-only state:', err);
    }
  }, []);

  // Fetch all primary terminal data
  const refreshTerminalData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const safeFetchJson = async (url: string, fallback: any = []) => {
        try {
          const res = await fetch(url);
          if (res.ok) {
            return await res.json();
          }
        } catch (e) {
          console.warn(`Safe fetch failed for ${url}:`, e);
        }
        return fallback;
      };

      // Ensure broker status refresh is executed safely alongside data fetches
      const brokerPromise = refreshBrokerStatus().catch(err => {
        console.warn('Failed to refresh broker status:', err);
      });

      const [fxPairs, inUnder, sigs] = await Promise.all([
        safeFetchJson('/api/forex/pairs'),
        safeFetchJson('/api/india/underlyings'),
        safeFetchJson('/api/signals/all'),
        brokerPromise
      ]);

      if (Array.isArray(fxPairs) && fxPairs.length > 0) setForexPairs(fxPairs);
      if (Array.isArray(inUnder) && inUnder.length > 0) setIndianUnderlyings(inUnder);
      if (Array.isArray(sigs)) setSignals(sigs);

      // Pre-fetch primary candles for EUR/USD and NIFTY
      const [eurCandles, niftyCandles] = await Promise.all([
        safeFetchJson('/api/candles/EUR%2FUSD'),
        safeFetchJson('/api/candles/NIFTY')
      ]);

      setCandlesMap(prev => ({
        ...prev,
        'EUR/USD': Array.isArray(eurCandles) ? eurCandles : [],
        'NIFTY': Array.isArray(niftyCandles) ? niftyCandles : []
      }));
    } catch (err) {
      console.error('Failed to load terminal data:', err);
    } finally {
      setIsRefreshing(false);
      setLoadingInitial(false);
    }
  }, [refreshBrokerStatus]);

  // 1-Second real-time clock & session status ticker (updates clock automatically without page refresh)
  useEffect(() => {
    const tickSessions = () => {
      const now = new Date();
      setForexSessions(getForexSessionState(now));
      setIndianSession(getIndianSessionState(now));
    };

    tickSessions();
    const clockTimer = setInterval(tickSessions, 1000);

    return () => {
      clearInterval(clockTimer);
    };
  }, []);

  // Periodic 15-second background refresh for prices and signals
  useEffect(() => {
    refreshTerminalData();

    const dataTimer = setInterval(() => {
      refreshTerminalData();
    }, 15000);

    return () => {
      clearInterval(dataTimer);
    };
  }, [refreshTerminalData]);

  // Handle environment change request (Confirmation required)
  const handleRequestEnvironmentChange = (targetEnv: TradingEnvironment) => {
    if (targetEnv === environment) return;
    setPendingEnvSwitch(targetEnv);
  };

  // Confirm environment switch
  const handleConfirmEnvironmentSwitch = async () => {
    if (!pendingEnvSwitch) return;
    const targetEnv = pendingEnvSwitch;
    setPendingEnvSwitch(null);

    try {
      const res = await fetch('/api/brokers/environment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: targetEnv, confirmed: true })
      });
      if (res.ok) {
        setEnvironment(targetEnv);
        await refreshBrokerStatus();
      }
    } catch (err) {
      console.error('Failed to change environment:', err);
    }
  };

  // Broker selection handler
  const handleSelectBroker = async (broker: BrokerType) => {
    try {
      const res = await fetch('/api/brokers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker })
      });
      if (res.ok) {
        setSelectedBroker(broker);
        await refreshBrokerStatus();
      }
    } catch (err) {
      console.error('Failed to select broker:', err);
    }
  };

  // Toggle Emergency Kill Switch
  const handleToggleKillSwitch = async () => {
    const action = isEmergencyHalted ? 'RESUME' : 'HALT';
    if (action === 'HALT') {
      const confirmed = confirm('CRITICAL: Are you sure you want to trigger the EMERGENCY STOP? This will cancel all pending orders and immediately block any new trade orders.');
      if (!confirmed) return;
    }

    try {
      const res = await fetch('/api/brokers/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: 'Operator manual UI button' })
      });
      if (res.ok) {
        const data = await res.json();
        setIsEmergencyHalted(data.emergencyStop.isHalted);
      }
    } catch (err) {
      console.error('Failed to trigger emergency stop:', err);
    }
  };

  // Track last fetched timestamps to prevent redundant polling loops
  const candleFetchTimesRef = useRef<Record<string, number>>({});

  // Ensure candles loaded for an instrument
  const ensureCandlesLoaded = useCallback(async (symbol: string) => {
    if (!symbol) return;
    const now = Date.now();
    const lastFetch = candleFetchTimesRef.current[symbol] || 0;
    // Throttle to at most once every 10 seconds per symbol
    if (now - lastFetch < 10000) return;
    candleFetchTimesRef.current[symbol] = now;

    try {
      const encoded = encodeURIComponent(symbol);
      const res = await fetch(`/api/candles/${encoded}`);
      if (res.ok) {
        const data = await res.json();
        setCandlesMap(prev => ({ ...prev, [symbol]: Array.isArray(data) ? data : [] }));
      }
    } catch {
      // Safe fallback when disconnected or server is restarting
      setCandlesMap(prev => ({ ...prev, [symbol]: prev[symbol] || [] }));
    }
  }, []);

  // Execute confirmed order
  const handleExecuteConfirmedOrder = async (confirmedOrder: OrderRequest) => {
    setPendingOrder(null);
    try {
      const res = await fetch('/api/brokers/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broker: selectedBroker,
          environment,
          order: confirmedOrder,
          operatorConfirmed: true
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Order Placed Successfully!\nBroker: ${selectedBroker}\nID: ${data.order?.orderId}\nStatus: ${data.order?.status}`);
        await refreshBrokerStatus();
      } else {
        alert(`Order Rejected / Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Order Execution Error: ${err.message}`);
    }
  };

  return (
    <GlobalAppShell activeTab={activeTab} setActiveTab={setActiveTab} isEmergencyHalted={isEmergencyHalted}>
      {/* Top Fixed Header with Multi-Market Sessions, Environment Selector & Kill Switch */}
      {activeTab === 'market' ? (
        <TerminalDashboard
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          indianSession={indianSession}
          selectedBroker={selectedBroker}
          environment={environment}
          maskedAccount={maskedAccount}
          balance={balance}
          currency={currency}
          isEmergencyHalted={isEmergencyHalted}
          isRefreshing={isRefreshing}
          onRefresh={refreshTerminalData}
          onToggleKillSwitch={handleToggleKillSwitch}
          candlesMap={candlesMap}
          indianUnderlyings={indianUnderlyings}
          signals={signals}
          onSelectSignal={(sig) => setSelectedSignal(sig)}
        />
      ) : activeTab === 'forex_terminal' ? (
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
          onRefresh={refreshTerminalData}
          onToggleKillSwitch={handleToggleKillSwitch}
          candlesMap={candlesMap}
          forexPairs={forexPairs}
          signals={signals}
          onSelectSignal={(sig) => setSelectedSignal(sig)}
        />
      ) : (
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          forexSessions={forexSessions}
          indianSession={indianSession}
          onRefresh={refreshTerminalData}
          isRefreshing={isRefreshing}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          environment={environment}
          onRequestEnvironmentChange={handleRequestEnvironmentChange}
          selectedBroker={selectedBroker}
          maskedAccount={maskedAccount}
          isEmergencyHalted={isEmergencyHalted}
          onToggleKillSwitch={handleToggleKillSwitch}
        />
      )}

      {/* Main Terminal Viewport */}
      {activeTab !== 'market' && activeTab !== 'forex_terminal' && (
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 md:px-6 pt-[120px] pb-10 space-y-4">
        {loadingInitial ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3 font-mono">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-sm text-slate-300">Initializing Quantitative Terminal Engine...</div>
            <div className="text-xs text-slate-500">Loading Broker Adapters (cTrader + 5paisa), SQLite storage, and Risk Gates</div>
          </div>
        ) : (
          <>
            {/* 1. MARKET HUB (Forex, Indian, Options Chain, Scanner) */}
            {(activeTab === 'market' || activeTab === 'forex' || activeTab === 'indian' || activeTab === 'options' || activeTab === 'scanner') && (
              <MarketHub
                forexPairs={forexPairs}
                indianUnderlyings={indianUnderlyings}
                candlesMap={candlesMap}
                onSelectSignal={(sig) => setSelectedSignal(sig)}
                onEnsureCandles={ensureCandlesLoaded}
                initialOptionSymbol={selectedOptionUnderlying}
                environment={environment}
              />
            )}

            {/* 2. SIGNALS HUB (All, Forex, Indian, Options, Qualified, Watch, No Trade) */}
            {activeTab === 'signals' && (
              <SignalsView
                signals={signals}
                onSelectSignal={(sig) => setSelectedSignal(sig)}
              />
            )}

            {/* 3. TRADING HUB (Paper / Demo / Live Execution, Portfolio & Orders) */}
            {(activeTab === 'trading' || activeTab === 'paper') && (
              <TradingHub
                environment={environment}
                selectedBroker={selectedBroker}
                maskedAccount={maskedAccount}
                balance={balance}
                currency={currency}
                isEmergencyHalted={isEmergencyHalted}
                onRequestEnvironmentChange={handleRequestEnvironmentChange}
              />
            )}

            {/* 4. P&L & MULTI-CURRENCY ACCOUNTING HUB */}
            {(activeTab === 'pnl' || activeTab === 'accounting') && (
              <PerformanceResearchCenterView />
            )}

            {/* 5. RESEARCH HUB (ML Models, Walk-Forward, Quant Simulator, Drift, Reports) */}
            {(activeTab === 'research' || activeTab === 'ml') && (
              <MLResearchDashboard />
            )}

            {/* PRIMARY OPERATIONAL HUB: TRADING CONTROL CENTER (10 Core Operational Sections) */}
            {(activeTab === 'control_center' || activeTab === 'operations' || activeTab === 'reconciliation' || activeTab === 'reconcile') && (
              <TradingControlCenter onSelectSignalModal={(sig) => setSelectedSignal(sig)} />
            )}

            {/* 6. SETTINGS HUB (Broker Connections, Safety Controls, Governance & Readiness Gates) */}
            {(activeTab === 'settings' || activeTab === 'governance') && (
              <SettingsHub
                currentEnvironment={environment}
                selectedBroker={selectedBroker}
                onEnvironmentChange={handleRequestEnvironmentChange}
                onBrokerSelect={handleSelectBroker}
                onRefreshGlobal={refreshBrokerStatus}
              />
            )}
          </>
        )}
      </main>
      )}

      {/* Signal Quantitative Inspection Modal */}
      {selectedSignal && (
        <SignalModal
          signal={selectedSignal}
          onClose={() => setSelectedSignal(null)}
        />
      )}

      {/* Database & Diagnostics Modal */}
      {showDiagnostics && (
        <DiagnosticsModal
          onClose={() => setShowDiagnostics(false)}
        />
      )}

      {/* Environment Switch Confirmation Modal */}
      {pendingEnvSwitch && (
        <EnvironmentSwitchModal
          isOpen={!!pendingEnvSwitch}
          onClose={() => setPendingEnvSwitch(null)}
          onConfirm={handleConfirmEnvironmentSwitch}
          currentEnv={environment}
          targetEnv={pendingEnvSwitch}
          broker={selectedBroker}
          maskedAccount={maskedAccount}
          currency={currency}
          balance={balance}
        />
      )}

      {/* Order Confirmation Modal */}
      {pendingOrder && (
        <OrderConfirmationModal
          isOpen={!!pendingOrder}
          onClose={() => setPendingOrder(null)}
          onConfirm={handleExecuteConfirmedOrder}
          order={pendingOrder}
          broker={selectedBroker}
          environment={environment}
          maskedAccount={maskedAccount}
          currentPrice={pendingOrder.price || 0}
        />
      )}
    </GlobalAppShell>
  );
}