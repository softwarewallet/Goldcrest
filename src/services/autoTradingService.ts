import { ForexDataProvider } from '../markets/forex/provider';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from '../markets/forex/types';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexSessionState } from '../markets/common/session';
import { getAutoLiveMarketGate, AutoLiveMarketGate } from './marketOpenGate';
import { fetchLiveForexNews, LiveNewsSnapshot } from './liveNewsService';
import { brokerRegistry } from '../brokers/registry';
import { autoExecutionEngine, refreshAutonomousExecutionPermission, disarmLocalAutonomousExecution } from '../brokers/safety/AutoExecutionEngine';
import { autoTradeReadinessService } from '../brokers/safety/AutoTradeReadiness';
import { getSystemConfig } from './configService';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { BrokerAdapter, NormalizedQuote, OrderRequest } from '../brokers/types';
import { liveRuntimeLog } from './liveRuntimeLog';
import { sizeForexOrderToMaxTradeValue } from '../brokers/safety/TradeSizing';

const AUTO_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.GOLDCREST_AUTO_TRADING_INTERVAL_MS || 60_000)
);

const DEFAULT_AUTO_FOREX_PAIRS = FOREX_PAIRS
  .filter(pair => pair.quoteCurrency === 'USD')
  .map(pair => pair.symbol);

function getConfiguredAutoForexPairs(): string[] {
  const configured = getSystemConfig().autoLiveForexPairs;
  if (!Array.isArray(configured) || configured.length === 0) return [...DEFAULT_AUTO_FOREX_PAIRS];
  return [...new Set(configured
    .map(symbol => String(symbol).toUpperCase().trim())
    .filter(symbol => /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)))];
}

// Pre-open preparation is background work. Keep the operator-facing arm fast,
// avoid repeating the same broker history fetch every minute, and bound
// concurrent pair preparation so cTrader is not flooded with sessions.
const PREOPEN_PREPARATION_MIN_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.GOLDCREST_PREOPEN_MIN_INTERVAL_MS || 120_000)
);
const PREOPEN_PAIR_CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.GOLDCREST_PREOPEN_PAIR_CONCURRENCY || 3))
);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

class LiveForexSignalProvider implements ForexDataProvider {
  readonly providerName = 'CTRADER_LIVE_PROVIDER';
  readonly status = 'LIVE' as const;
  readonly isDemo = false;

  private candles = new Map<string, ForexCandle[]>();
  private quotes = new Map<string, ForexQuote>();

  async refreshPair(pair: string): Promise<void> {
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const timeframes: ForexTimeframe[] = ['5M', '15M', '1H', '4H', 'Daily'];
    const rows = await Promise.all(
      timeframes.map(async timeframe => ({
        timeframe,
        data: await adapter.getHistoricalCandles(pair, timeframe, 80)
      }))
    );

    for (const row of rows) {
      if (!Array.isArray(row.data) || row.data.length < 35) {
        throw new Error(`Insufficient live ${row.timeframe} candle history for ${pair}.`);
      }
      this.candles.set(`${pair}:${row.timeframe}`, row.data as ForexCandle[]);
    }

    // Pre-open trend preparation only needs historical candles. A live quote
    // is fetched again at the execution boundary, so opening another broker
    // WebSocket here only adds latency and can block preparation unnecessarily.
  }

  getQuote(pair: string): ForexQuote {
    const quote = this.quotes.get(pair);
    if (!quote) throw new Error(`Live quote cache is empty for ${pair}.`);
    return quote;
  }

  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit = 80): ForexCandle[] {
    const rows = this.candles.get(`${pair}:${timeframe}`) || [];
    return rows.slice(Math.max(0, rows.length - limit));
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const rows = this.getCandles(pair, timeframe, 2);
    if (!rows.length) throw new Error(`Live candle cache is empty for ${pair} ${timeframe}.`);
    return rows[rows.length - 1];
  }

  getAvailablePairs() {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    const isOpen = !session.activeSessions.includes('CLOSED (WEEKEND)');
    return {
      isOpen,
      status: isOpen ? 'OPEN' : 'WEEKEND',
      activeSessions: session.activeSessions,
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: new Date().toISOString()
    };
  }
}

export type AutoTradingState = 'STOPPED' | 'PREPARING' | 'RUNNING' | 'BLOCKED';
export type AutoTradingExecutionStage = 'IDLE' | 'SCANNING_MARKET' | 'ANALYZING_SIGNAL' | 'PREPARING_ORDER' | 'SAFETY_GATE' | 'SUBMITTING_ORDER' | 'TRADE_EXECUTED' | 'REJECTED';

export interface AutoTradingExecutionStatus {
  stage: AutoTradingExecutionStage;
  pair: string | null;
  side: 'BUY' | 'SELL' | null;
  signalId: string | null;
  message: string;
  updatedAt: number;
}

export interface AutoTradingStatus {
  state: AutoTradingState;
  enabledByEnvironment: boolean;
  autonomousPermission: boolean;
  intervalMs: number;
  minSignalScore: number;
  maxTradesPerPair: number;
  pairs: string[];
  indianUnderlyings: string[];
  lastCycleAt: number | null;
  lastCycleResult: string | null;
  lastActions: Array<{
    pair: string;
    result: string;
    signalId?: string;
    reason?: string;
    orderId?: string;
  }>;
  marketGate: AutoLiveMarketGate;
  currentExecution: AutoTradingExecutionStatus;
  lastExecution: AutoTradingExecutionStatus | null;
  preOpenPreparation: {
    lastPreparedAt: number | null;
    trendPairsEvaluated: number;
    news: LiveNewsSnapshot | null;
    status: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE';
  };
  requiresClosedMarketConfirmation?: boolean;
}

class AutoTradingService {
  private provider = new LiveForexSignalProvider();
  private signalEngine = new ForexSignalEngine(undefined, this.provider);
  private timer: NodeJS.Timeout | null = null;
  private state: AutoTradingState = 'STOPPED';
  private lastCycleAt: number | null = null;
  private lastCycleResult: string | null = null;
  private lastActions: AutoTradingStatus['lastActions'] = [];
  private lastPreOpenPreparedAt: number | null = null;
  private preOpenTrendPairsEvaluated = 0;
  private preOpenNews: LiveNewsSnapshot | null = null;
  private preOpenStatus: 'IDLE' | 'RUNNING' | 'READY' | 'UNAVAILABLE' = 'IDLE';
  private cycleInFlight = false;
  private currentExecution: AutoTradingExecutionStatus = {
    stage: 'IDLE',
    pair: null,
    side: null,
    signalId: null,
    message: 'Waiting for the next Auto Live cycle.',
    updatedAt: Date.now()
  };
  private lastExecution: AutoTradingExecutionStatus | null = null;

  private isRequested(): boolean {
    return (process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
      && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true')
      || process.env.NODE_ENV !== 'production'
      || process.env.GOLDCREST_LOCAL_DEVELOPMENT === 'true';
  }

  private setExecutionStatus(update: Partial<AutoTradingExecutionStatus> & Pick<AutoTradingExecutionStatus, 'stage' | 'message'>): void {
    this.currentExecution = { ...this.currentExecution, ...update, updatedAt: Date.now() };
    liveRuntimeLog('INFO', 'AUTO_TRADING_EXECUTION_STAGE', this.currentExecution);
  }

  private finishExecution(stage: 'TRADE_EXECUTED' | 'REJECTED', message: string, extra: Partial<AutoTradingExecutionStatus> = {}): void {
    this.setExecutionStatus({ stage, message, ...extra });
    this.lastExecution = { ...this.currentExecution };
  }

  getStatus(): AutoTradingStatus {
    const autonomousPermission = refreshAutonomousExecutionPermission();
    return {
      state: this.state,
      enabledByEnvironment: this.isRequested(),
      autonomousPermission,
      intervalMs: AUTO_INTERVAL_MS,
      minSignalScore: Number(getSystemConfig().autoLiveMinSignalScore),
      maxTradesPerPair: Number(getSystemConfig().autoLiveMaxTradesPerPair),
      pairs: getConfiguredAutoForexPairs(),
      indianUnderlyings: [...getSystemConfig().autoLiveIndianUnderlyings],
      lastCycleAt: this.lastCycleAt,
      lastCycleResult: this.lastCycleResult,
      lastActions: [...this.lastActions],
      marketGate: getAutoLiveMarketGate(),
      currentExecution: { ...this.currentExecution },
      lastExecution: this.lastExecution ? { ...this.lastExecution } : null,
      preOpenPreparation: {
        lastPreparedAt: this.lastPreOpenPreparedAt,
        trendPairsEvaluated: this.preOpenTrendPairsEvaluated,
        news: this.preOpenNews,
        status: this.preOpenStatus
      }
    };
  }

  start(options: { confirmWhenClosed?: boolean } = {}): AutoTradingStatus {
    const marketGate = getAutoLiveMarketGate();

    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_START_ATTEMPT', {
      previousState: this.state,
      requestedFlags: {
        autoTrading: process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true',
        autonomousLiveExecution: process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true'
      },
      marketGate,
      confirmWhenClosed: Boolean(options.confirmWhenClosed)
    });

    if (marketGate.bothMarketsClosed && !options.confirmWhenClosed) {
      const message = 'Markets are closed, do you still want to start Auto Live';
      this.lastCycleResult = message;
      liveRuntimeLog('INFO', 'AUTO_TRADING_CLOSED_MARKET_CONFIRMATION_REQUIRED', {
        message,
        marketGate
      });
      return {
        ...this.getStatus(),
        requiresClosedMarketConfirmation: true
      };
    }

    if (!this.isRequested()) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'Autonomous execution is not enabled. Both GOLDCREST_AUTO_TRADING_ENABLED and GOLDCREST_AUTONOMOUS_LIVE_EXECUTION must be true.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'REQUEST_FLAGS',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    const activation = autoExecutionEngine.enableAutomaticExecution();
    if (!activation.success) {
      this.state = 'BLOCKED';
      this.lastCycleResult = activation.message;
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'ARM',
        code: activation.code,
        reason: activation.message
      });
      return this.getStatus();
    }

    if (!getSystemConfig().liveTradingEnabled) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'LIVE_TRADING_ENABLED is not true.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'LIVE_TRADING_CONFIG',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    const permission = refreshAutonomousExecutionPermission();
    if (!permission) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'Autonomous execution is not currently permitted. The strategy must be calibrated and the safety controls must pass.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'AUTONOMOUS_PERMISSION',
        reason: this.lastCycleResult
      });
      return this.getStatus();
    }

    if (this.timer) return this.getStatus();

    if (marketGate.anyMarketOpen) {
      this.state = 'RUNNING';
      this.lastCycleResult = 'Auto-trading loop started.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STARTED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      void this.runCycle();
    } else {
      this.state = 'PREPARING';
      this.lastCycleResult = 'Markets are closed. Auto Live is armed; pre-open preparation is running and the system will begin evaluating trades as soon as a supported market opens.';
      this.preOpenStatus = 'RUNNING';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_PRE_OPEN_ARMED', {
        intervalMs: AUTO_INTERVAL_MS,
        pairs: getConfiguredAutoForexPairs(),
        marketGate
      });
      void this.runScheduledCycle();
    }

    this.timer = setInterval(() => {
      void this.runScheduledCycle();
    }, AUTO_INTERVAL_MS);
    this.timer.unref?.();

    return this.getStatus();
  }

  abandonClosedMarketStart(): AutoTradingStatus {
    this.lastCycleResult = 'Auto Live start abandoned while markets were closed.';
    liveRuntimeLog('INFO', 'AUTO_TRADING_CLOSED_MARKET_START_ABANDONED', {
      marketGate: getAutoLiveMarketGate()
    });
    return this.getStatus();
  }

  stop(reason = 'Operator stopped auto trading.'): AutoTradingStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = 'STOPPED';
    this.lastCycleResult = reason;
    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STOPPED', { reason });
    disarmLocalAutonomousExecution();
    return this.getStatus();
  }

  private async runScheduledCycle(): Promise<void> {
    if (!['PREPARING', 'RUNNING'].includes(this.state) || this.cycleInFlight) return;

    const marketGate = getAutoLiveMarketGate();

    if (marketGate.bothMarketsClosed) {
      if (this.state === 'RUNNING') {
        this.state = 'PREPARING';
        this.lastCycleResult = 'Markets closed. Auto Live remains armed and has returned to pre-open preparation.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED_PREPARATION_RESUMED', { marketGate });
      }
      await this.runPreOpenPreparation(marketGate);
      return;
    }

    if (this.state === 'PREPARING') {
      this.state = 'RUNNING';
      this.lastCycleResult = 'A supported market is now open. Auto Live is moving from preparation to live signal evaluation.';
      liveRuntimeLog('SYSTEM', 'AUTO_TRADING_MARKET_OPENED', { marketGate });
    }

    await this.runCycle();
  }

  private async runPreOpenPreparation(marketGate: AutoLiveMarketGate): Promise<void> {
    if (this.state !== 'PREPARING' || this.cycleInFlight) return;

    const sinceLastPreparation = this.lastPreOpenPreparedAt
      ? Date.now() - this.lastPreOpenPreparedAt
      : Number.POSITIVE_INFINITY;
    const hasFreshNews = this.preOpenNews?.status === 'LIVE';
    const hasFreshPreparation =
      sinceLastPreparation < PREOPEN_PREPARATION_MIN_INTERVAL_MS
      && this.preOpenStatus === 'READY'
      && hasFreshNews;

    if (hasFreshPreparation) {
      this.lastCycleResult = `Pre-open preparation is already fresh (${Math.round(sinceLastPreparation / 1000)}s old). Auto Live remains armed.`;
      liveRuntimeLog('INFO', 'PREOPEN_PREPARATION_SKIPPED_FRESH', {
        ageMs: sinceLastPreparation,
        minIntervalMs: PREOPEN_PREPARATION_MIN_INTERVAL_MS,
        newsStatus: this.preOpenNews?.status,
        newsFetchedAt: this.preOpenNews?.fetchedAt
      });
      return;
    }

    this.cycleInFlight = true;
    this.preOpenStatus = 'RUNNING';

    try {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_BLOCKED', { reason: this.lastCycleResult });
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous permission was withdrawn during pre-open preparation.';
        this.preOpenStatus = 'UNAVAILABLE';
        liveRuntimeLog('WARN', 'AUTO_TRADING_PRE_OPEN_BLOCKED', { reason: this.lastCycleResult });
        return;
      }

      const newsPromise = fetchLiveForexNews({
        pairs: getConfiguredAutoForexPairs()
      });
      const trendResultsRaw = await mapWithConcurrency(
        getConfiguredAutoForexPairs(),
        PREOPEN_PAIR_CONCURRENCY,
        async pair => {
          try {
            await this.provider.refreshPair(pair);
            const analysis = this.signalEngine.analyzePair(pair);
            liveRuntimeLog('INFO', 'PREOPEN_TREND_EVALUATED', {
              pair,
              trend: analysis.trend.direction,
              strength: analysis.trend.strength,
              regime: analysis.regime,
              alignment: analysis.multiTimeframe.alignment,
              signalScore: analysis.signal.score
            });
            return {
              pair,
              trend: analysis.trend.direction,
              strength: analysis.trend.strength,
              regime: analysis.regime,
              alignment: analysis.multiTimeframe.alignment,
              score: analysis.signal.score
            };
          } catch (error: any) {
            liveRuntimeLog('WARN', 'PREOPEN_TREND_UNAVAILABLE', {
              pair,
              error: error?.message || String(error)
            });
            return null;
          }
        }
      );

      const trendResults = trendResultsRaw.filter(Boolean) as Array<{
        pair: string;
        trend: string;
        strength: number;
        regime: string;
        alignment: string;
        score: number;
      }>;

      this.preOpenTrendPairsEvaluated = trendResults.length;
      this.preOpenNews = await newsPromise;
      this.preOpenStatus = this.preOpenNews.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';

      liveRuntimeLog(
        this.preOpenNews.status === 'UNAVAILABLE' ? 'WARN' : 'INFO',
        'PREOPEN_NEWS_EVALUATED',
        {
          source: this.preOpenNews.source,
          status: this.preOpenNews.status,
          articleCount: this.preOpenNews.articleCount,
          highImpactCount: this.preOpenNews.highImpactCount,
          elevatedCount: this.preOpenNews.elevatedCount,
          riskLevel: this.preOpenNews.riskLevel,
          providerStatus: this.preOpenNews.providerStatus,
          sentimentSummary: this.preOpenNews.sentimentSummary,
          error: this.preOpenNews.error
        }
      );

      this.lastPreOpenPreparedAt = Date.now();
      this.preOpenStatus = this.preOpenNews.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'READY';
      this.lastCycleResult = this.preOpenNews.status === 'UNAVAILABLE'
        ? `Pre-open trend preparation completed for ${trendResults.length} pairs, but live news is unavailable. No trade is placed until the normal execution gates pass.`
        : `Pre-open preparation completed: ${trendResults.length} live Forex pairs evaluated and live news checked. Waiting for a supported market to open.`;

      liveRuntimeLog('INFO', 'PREOPEN_PREPARATION_COMPLETED', {
        marketGate,
        trendPairsEvaluated: trendResults.length,
        newsStatus: this.preOpenNews.status,
        newsRiskLevel: this.preOpenNews.riskLevel,
        preparedAt: this.lastPreOpenPreparedAt
      });
    } catch (error: any) {
      this.preOpenStatus = 'UNAVAILABLE';
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_PRE_OPEN_ERROR', { error: this.lastCycleResult });
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.state !== 'RUNNING' || this.cycleInFlight) return;
    this.cycleInFlight = true;

    this.lastCycleAt = Date.now();
    this.lastActions = [];
    liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_STARTED', { timestamp: this.lastCycleAt, pairs: getConfiguredAutoForexPairs() });

    try {
      if (killSwitch.isHalted()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Emergency kill switch is active.';
        return;
      }

      if (!refreshAutonomousExecutionPermission()) {
        this.state = 'BLOCKED';
        this.lastCycleResult = 'Autonomous permission was withdrawn before cycle execution.';
        return;
      }

      // Live news is an execution input, not just a display metric. The
      // deterministic technical strategy can only enter a new trade when a
      // current authoritative news snapshot is available.
      const cycleNews = await fetchLiveForexNews({
        pairs: getConfiguredAutoForexPairs()
      });
      this.preOpenNews = cycleNews;
      this.preOpenStatus = cycleNews.status === 'LIVE' ? 'READY' : 'UNAVAILABLE';

      liveRuntimeLog(
        cycleNews.status === 'LIVE' ? 'INFO' : 'WARN',
        'LIVE_NEWS_CYCLE_INPUT',
        {
          source: cycleNews.source,
          status: cycleNews.status,
          articleCount: cycleNews.articleCount,
          highImpactCount: cycleNews.highImpactCount,
          activeHighImpactCount: cycleNews.activeHighImpactCount,
          elevatedCount: cycleNews.elevatedCount,
          riskLevel: cycleNews.riskLevel,
          providerStatus: cycleNews.providerStatus,
          sentimentSummary: cycleNews.sentimentSummary,
          error: cycleNews.error
        }
      );

      if (cycleNews.status !== 'LIVE') {
        this.lastActions = getConfiguredAutoForexPairs().map(pair => ({
          pair,
          result: 'BLOCKED',
          reason: 'Authoritative live news feed is unavailable; autonomous entry is blocked until fresh news is available.'
        }));
        this.lastCycleResult = 'Auto Live cycle blocked: authoritative live news is unavailable. No new trade is submitted.';
        liveRuntimeLog('WARN', 'AUTO_TRADING_BLOCKED_NEWS_UNAVAILABLE', {
          status: cycleNews.status,
          source: cycleNews.source,
          error: cycleNews.error
        });
        return;
      }

      const configuredPairs = getConfiguredAutoForexPairs();
      const blockedNewsPairs = configuredPairs.filter(pair => {
        const pairRisk = cycleNews.pairRisk?.[pair];
        // Backward-compatible fallback for snapshots produced by an older
        // process without pairRisk diagnostics.
        return pairRisk
          ? pairRisk.riskLevel === 'HIGH'
          : cycleNews.riskLevel === 'HIGH';
      });

      if (blockedNewsPairs.length > 0) {
        liveRuntimeLog('WARN', 'AUTO_TRADING_PAIR_NEWS_BLOCKS', {
          blockedPairs: blockedNewsPairs,
          articleCount: cycleNews.articleCount,
          highImpactCount: cycleNews.highImpactCount,
          pairRisk: cycleNews.pairRisk
        });
      }

      const session = getForexSessionState();
      if (session.activeSessions.includes('CLOSED (WEEKEND)')) {
        this.state = 'PREPARING';
        this.lastCycleResult = 'Forex market closed; pre-open preparation resumed.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED', { session: session.activeSessions });
        return;
      }

      for (const pair of configuredPairs) {
        const pairRisk = cycleNews.pairRisk?.[pair];
        const highImpactBlocked = pairRisk
          ? pairRisk.riskLevel === 'HIGH'
          : cycleNews.riskLevel === 'HIGH';

        if (highImpactBlocked) {
          const reason = 'Active pair-relevant high-impact news is inside the configured blackout window for ' + pair + '.';
          this.lastActions.push({
            pair,
            result: 'BLOCKED',
            reason
          });
          liveRuntimeLog('WARN', 'AUTO_TRADING_PAIR_BLOCKED_NEWS', {
            pair,
            signalId: undefined,
            reason,
            pairRisk: pairRisk || null
          });
          continue;
        }

        await this.evaluatePair(pair);
      }

      this.lastCycleResult = 'Cycle completed.';
      liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_COMPLETED', { actions: this.lastActions });
    } catch (error: any) {
      this.lastCycleResult = error?.message || String(error);
      liveRuntimeLog('ERROR', 'AUTO_TRADING_CYCLE_ERROR', { error: this.lastCycleResult });
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async evaluatePair(pair: string): Promise<void> {
    try {
      this.setExecutionStatus({
        stage: 'SCANNING_MARKET',
        pair,
        side: null,
        signalId: null,
        message: 'Scanning live market data for ' + pair + '.'
      });
      await this.provider.refreshPair(pair);
      liveRuntimeLog('INFO', 'LIVE_DATA_REFRESHED', { pair });
      const signal = await this.signalEngine.generateSignal(pair);
      this.setExecutionStatus({
        stage: 'ANALYZING_SIGNAL',
        pair,
        side: signal.direction === 'BUY' || signal.direction === 'SELL' ? signal.direction : null,
        signalId: signal.id,
        message: 'Analyzing ' + pair + ' signal and execution conditions.'
      });
      liveRuntimeLog('INFO', 'SIGNAL_EVALUATED', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, status: signal.status, strategyId: signal.strategyVersion });

      if (!['BUY', 'SELL'].includes(signal.direction) || !signal.tradePlan) {
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason: 'Signal engine did not produce an actionable directional setup.' });
        liveRuntimeLog('INFO', 'NO_TRADE', { pair, signalId: signal.id, reason: 'No actionable directional setup.' });
        return;
      }

      const config = getSystemConfig();
      const minSignalScore = Math.max(0, Math.min(100, Math.round(Number(config.autoLiveMinSignalScore))));
      if (signal.score < minSignalScore) {
        this.lastActions.push({ pair, result: 'FILTERED', signalId: signal.id, reason: `Signal score ${signal.score} is below the configured Auto Live threshold of ${minSignalScore}.` });
        liveRuntimeLog('INFO', 'SIGNAL_FILTERED', { pair, signalId: signal.id, score: signal.score, threshold: minSignalScore });
        return;
      }

      const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');
      const quote = await adapter.getQuote(pair);
      if (quote.status !== 'FRESH' || Date.now() - quote.timestamp >= 10_000) {
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason: 'Fresh broker quote unavailable at dispatch boundary.' });
        return;
      }

      const plan = signal.tradePlan;
      const entryPrice = signal.direction === 'BUY' ? quote.ask : quote.bid;
      if (entryPrice < plan.entryMin || entryPrice > plan.entryMax) {
        this.lastActions.push({ pair, result: 'WAITING_ENTRY', signalId: signal.id, reason: `Live quote ${entryPrice} is outside entry zone ${plan.entryMin} - ${plan.entryMax}.` });
        liveRuntimeLog('INFO', 'WAITING_ENTRY', { pair, signalId: signal.id, entryPrice, entryMin: plan.entryMin, entryMax: plan.entryMax });
        return;
      }

      const account = await adapter.getAccount();
      if (String(account.currency || '').toUpperCase() !== 'USD') {
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason: 'Auto Forex sizing currently requires a USD-denominated cTrader account.' });
        return;
      }

      const instrument = await adapter.getInstrument(pair);
      if (!instrument) {
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason: 'Live broker instrument metadata unavailable.' });
        return;
      }

      const maxTradesPerPair = Math.max(1, Math.min(20, Math.floor(Number(config.autoLiveMaxTradesPerPair))));
      const positions = await adapter.getPositions();
      const activePairPositionsCount = positions.filter(position =>
        String(position.symbol || '').toUpperCase() === pair.toUpperCase()
      ).length;
      if (activePairPositionsCount >= maxTradesPerPair) {
        this.lastActions.push({
          pair,
          result: 'BLOCKED',
          signalId: signal.id,
          reason: `Maximum simultaneous Auto Live trades for ${pair} is ${maxTradesPerPair}; ${activePairPositionsCount} position(s) are already open.`
        });
        liveRuntimeLog('INFO', 'AUTO_TRADING_PAIR_POSITION_LIMIT', {
          pair,
          signalId: signal.id,
          activePairPositionsCount,
          maxTradesPerPair,
          score: signal.score
        });
        return;
      }

      const riskBudget = Math.max(0, Number(account.balance || 0) * (Number(getSystemConfig().defaultRiskPct) / 100));
      const stopDistance = Math.abs(entryPrice - plan.stopLoss);
      if (!(riskBudget > 0 && stopDistance > 0)) {
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason: 'Unable to calculate positive risk budget and stop distance.' });
        return;
      }

      const riskQuantity = riskBudget / stopDistance;
      let sizing;
      try {
        sizing = await sizeForexOrderToMaxTradeValue(
          adapter,
          pair,
          entryPrice,
          instrument,
          riskQuantity
        );
      } catch (sizingError: any) {
        this.lastActions.push({
          pair,
          result: 'BLOCKED',
          signalId: signal.id,
          reason: sizingError?.message || String(sizingError)
        });
        liveRuntimeLog('WARN', 'AUTO_ORDER_SIZING_BLOCKED', {
          pair,
          signalId: signal.id,
          requestedQuantity: riskQuantity,
          maxTradeValueUsd: getSystemConfig().maxTradeValueForexUsd,
          error: sizingError?.message || String(sizingError)
        });
        return;
      }

      const quantity = sizing.quantity;

      this.setExecutionStatus({
        stage: 'PREPARING_ORDER',
        pair,
        side: signal.direction === 'BUY' ? 'BUY' : 'SELL',
        signalId: signal.id,
        message: 'Preparing live order for ' + pair + '.'
      });

      const order: OrderRequest = {
        market: 'FOREX',
        symbol: pair,
        side: signal.direction === 'BUY' ? 'BUY' : 'SELL',
        orderType: 'MARKET',
        quantity,
        price: entryPrice,
        stopLoss: plan.stopLoss,
        takeProfit: plan.takeProfit1.targetPrice,
        strategyId: signal.strategyVersion,
        signalId: signal.id,
        comment: 'Goldcrest autonomous FX strategy'
      };

      const dailyRealizedPnL = typeof adapter.getDailyRealizedPnL === 'function'
        ? await adapter.getDailyRealizedPnL()
        : 0;
      const totalExposure = positions
        .filter(position => position.currency === 'USD' && position.market === 'FOREX')
        .reduce((sum, position) => sum + Math.abs(Number(position.quantity || 0)) * Number(position.currentPrice || 0), 0)
        + (quantity * entryPrice);

      liveRuntimeLog('INFO', 'ORDER_CANDIDATE', {
        pair,
        signalId: signal.id,
        side: order.side,
        quantity,
        requestedRiskQuantity: riskQuantity,
        entryPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        notionalUsd: sizing.estimatedTradeValueUsd,
        maxTradeValueUsd: sizing.maxTradeValueUsd,
        sizingAdjusted: sizing.adjusted,
        quoteToUsdRate: sizing.quoteToUsdRate
      });

      this.setExecutionStatus({
        stage: 'SAFETY_GATE',
        pair,
        side: order.side,
        signalId: signal.id,
        message: 'Running live safety and readiness gates for ' + pair + '.'
      });

      const result = await autoExecutionEngine.processSignal(
        {
          signalId: signal.id,
          strategyId: signal.strategyVersion,
          market: 'FOREX',
          symbol: pair,
          side: order.side,
          signalTimestamp: signal.timestamp,
          entryPrice,
          currentPrice: entryPrice,
          stopLoss: plan.stopLoss,
          takeProfit: plan.takeProfit1.targetPrice,
          spread: quote.spread,
          broker: 'CTRADER',
          environment: 'LIVE'
        },
        order,
        {
          signalAgeMs: Date.now() - signal.timestamp,
          currentQuote: {
            symbol: pair,
            bid: quote.bid,
            ask: quote.ask,
            spread: quote.spread,
            timestamp: quote.timestamp,
            source: quote.source,
            environment: 'LIVE',
            status: quote.status
          } satisfies NormalizedQuote,
          isMarketOpen: true,
          dailyRealizedLoss: Math.max(0, -Number(dailyRealizedPnL || 0)),
          dailyLossLimit: Math.max(Number(account.balance || 0) * (Number(getSystemConfig().maxDailyLossPct) / 100), 1),
          totalAccountExposure: totalExposure,
          maxAllowedExposure: Math.max(Number(account.equity || 0), 1),
          activePositionsCount: positions.length,
          maxOpenPositions: Number(config.maxOpenPositions),
          activePairPositionsCount,
          maxPairPositions: maxTradesPerPair
        },
        () => {
          this.setExecutionStatus({
            stage: 'SUBMITTING_ORDER',
            pair,
            side: order.side,
            signalId: signal.id,
            message: 'Submitting ' + pair + ' ' + order.side + ' to the live broker API.'
          });
        }
      );

      if (result.executed) {
        this.finishExecution('TRADE_EXECUTED', pair + ' ' + order.side + ' trade confirmed by the execution engine.', {
          pair,
          side: order.side,
          signalId: signal.id
        });
      } else {
        this.finishExecution('REJECTED', pair + ' ' + order.side + ' was blocked or rejected before confirmed execution.', {
          pair,
          side: order.side,
          signalId: signal.id
        });
      }

      this.lastActions.push({
        pair,
        result: result.executed ? 'EXECUTED' : 'BLOCKED',
        signalId: signal.id,
        reason: result.reason,
        orderId: result.order?.brokerOrderId || result.order?.id
      });
      liveRuntimeLog(result.executed ? 'TRADE' : 'WARN', result.executed ? 'AUTO_ORDER_EXECUTION_RESULT' : 'AUTO_ORDER_BLOCKED', { pair, signalId: signal.id, result: result.executed ? 'EXECUTED' : 'BLOCKED', code: result.code, reason: result.reason, brokerOrderId: result.order?.brokerOrderId, brokerStatus: result.order?.status });
    } catch (error: any) {
      this.finishExecution('REJECTED', pair + ' evaluation failed: ' + (error?.message || String(error)), { pair });
      this.lastActions.push({
        pair,
        result: 'ERROR',
        reason: error?.message || String(error)
      });
      liveRuntimeLog('ERROR', 'PAIR_EVALUATION_ERROR', { pair, error: error?.message || String(error) });
    }
  }
}

export const autoTradingService = new AutoTradingService();
