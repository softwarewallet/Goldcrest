import { ForexDataProvider } from '../markets/forex/provider';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from '../markets/forex/types';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getForexSessionState } from '../markets/common/session';
import { brokerRegistry } from '../brokers/registry';
import { autoExecutionEngine, refreshAutonomousExecutionPermission, disarmLocalAutonomousExecution } from '../brokers/safety/AutoExecutionEngine';
import { autoTradeReadinessService } from '../brokers/safety/AutoTradeReadiness';
import { getSystemConfig } from './configService';
import { killSwitch } from '../brokers/safety/KillSwitch';
import { BrokerAdapter, NormalizedQuote, OrderRequest } from '../brokers/types';
import { liveRuntimeLog } from './liveRuntimeLog';

const AUTO_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.GOLDCREST_AUTO_TRADING_INTERVAL_MS || 60_000)
);

const AUTO_PAIRS = FOREX_PAIRS
  .filter(pair => pair.quoteCurrency === 'USD')
  .map(pair => pair.symbol);

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

    const quote = await adapter.getQuote(pair);
    if (quote.status !== 'FRESH' || Date.now() - quote.timestamp >= 10_000) {
      throw new Error(`Live quote for ${pair} is stale or delayed.`);
    }

    this.quotes.set(pair, {
      pair,
      timestamp: quote.timestamp,
      bid: quote.bid,
      ask: quote.ask,
      spreadPips: quote.spread * (getForexPairConfig(pair).symbol.includes('JPY') ? 100 : 10000),
      digits: getForexPairConfig(pair).digits,
      pipSize: getForexPairConfig(pair).pipSize,
      changePips24h: 0,
      changePercent24h: 0,
      high24h: 0,
      low24h: 0,
      provider: this.providerName,
      dataStatus: 'LIVE'
    });
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

export type AutoTradingState = 'STOPPED' | 'RUNNING' | 'BLOCKED';

export interface AutoTradingStatus {
  state: AutoTradingState;
  enabledByEnvironment: boolean;
  autonomousPermission: boolean;
  intervalMs: number;
  pairs: string[];
  lastCycleAt: number | null;
  lastCycleResult: string | null;
  lastActions: Array<{
    pair: string;
    result: string;
    signalId?: string;
    reason?: string;
    orderId?: string;
  }>;
}

class AutoTradingService {
  private provider = new LiveForexSignalProvider();
  private signalEngine = new ForexSignalEngine(undefined, this.provider);
  private timer: NodeJS.Timeout | null = null;
  private state: AutoTradingState = 'STOPPED';
  private lastCycleAt: number | null = null;
  private lastCycleResult: string | null = null;
  private lastActions: AutoTradingStatus['lastActions'] = [];
  private cycleInFlight = false;

  private isRequested(): boolean {
    return process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
      && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  }

  getStatus(): AutoTradingStatus {
    const autonomousPermission = refreshAutonomousExecutionPermission();
    return {
      state: this.state,
      enabledByEnvironment: this.isRequested(),
      autonomousPermission,
      intervalMs: AUTO_INTERVAL_MS,
      pairs: [...AUTO_PAIRS],
      lastCycleAt: this.lastCycleAt,
      lastCycleResult: this.lastCycleResult,
      lastActions: [...this.lastActions]
    };
  }

  start(): AutoTradingStatus {
    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_START_ATTEMPT', {
      previousState: this.state,
      requestedFlags: {
        autoTrading: process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true',
        autonomousLiveExecution: process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true'
      }
    });

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

    if (!this.isRequested()) {
      this.state = 'BLOCKED';
      this.lastCycleResult = 'Auto trading is not enabled. Both GOLDCREST_AUTO_TRADING_ENABLED and GOLDCREST_AUTONOMOUS_LIVE_EXECUTION must be true.';
      liveRuntimeLog('WARN', 'AUTO_TRADING_START_BLOCKED', {
        stage: 'REQUEST_FLAGS',
        reason: this.lastCycleResult
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

    this.state = 'RUNNING';
    this.lastCycleResult = 'Auto-trading loop started.';
    liveRuntimeLog('SYSTEM', 'AUTO_TRADING_STARTED', { intervalMs: AUTO_INTERVAL_MS, pairs: AUTO_PAIRS });
    void this.runCycle();

    this.timer = setInterval(() => {
      void this.runCycle();
    }, AUTO_INTERVAL_MS);
    this.timer.unref?.();

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

  private async runCycle(): Promise<void> {
    if (this.state !== 'RUNNING' || this.cycleInFlight) return;
    this.cycleInFlight = true;

    this.lastCycleAt = Date.now();
    this.lastActions = [];
    liveRuntimeLog('INFO', 'AUTO_TRADING_CYCLE_STARTED', { timestamp: this.lastCycleAt, pairs: AUTO_PAIRS });

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

      const session = getForexSessionState();
      if (session.activeSessions.includes('CLOSED (WEEKEND)')) {
        this.lastCycleResult = 'Market closed; no orders evaluated.';
        liveRuntimeLog('INFO', 'AUTO_TRADING_MARKET_CLOSED', { session: session.activeSessions });
        return;
      }

      for (const pair of AUTO_PAIRS) {
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
      await this.provider.refreshPair(pair);
      liveRuntimeLog('INFO', 'LIVE_DATA_REFRESHED', { pair });
      const signal = await this.signalEngine.generateSignal(pair);
      liveRuntimeLog('INFO', 'SIGNAL_EVALUATED', { pair, signalId: signal.id, direction: signal.direction, score: signal.score, status: signal.status, strategyId: signal.strategyVersion });

      if (!['BUY', 'SELL'].includes(signal.direction) || !signal.tradePlan) {
        this.lastActions.push({ pair, result: 'NO_TRADE', signalId: signal.id, reason: 'Signal engine did not produce an actionable directional setup.' });
        liveRuntimeLog('INFO', 'NO_TRADE', { pair, signalId: signal.id, reason: 'No actionable directional setup.' });
        return;
      }

      if (signal.score < 75) {
        this.lastActions.push({ pair, result: 'FILTERED', signalId: signal.id, reason: `Signal score ${signal.score} is below the actionable threshold of 75.` });
        liveRuntimeLog('INFO', 'SIGNAL_FILTERED', { pair, signalId: signal.id, score: signal.score, threshold: 75 });
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

      const riskBudget = Math.max(0, Number(account.balance || 0) * (Number(getSystemConfig().defaultRiskPct) / 100));
      const stopDistance = Math.abs(entryPrice - plan.stopLoss);
      if (!(riskBudget > 0 && stopDistance > 0)) {
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason: 'Unable to calculate positive risk budget and stop distance.' });
        return;
      }

      const maxNotionalQuantity = Number(getSystemConfig().maxTradeValueForexUsd) / entryPrice;
      let quantity = Math.min(riskBudget / stopDistance, maxNotionalQuantity);
      const step = Number(instrument.stepQuantity) > 0 ? Number(instrument.stepQuantity) : 1;
      quantity = Math.floor(quantity / step) * step;

      if (!(quantity >= Number(instrument.minQuantity))) {
        this.lastActions.push({ pair, result: 'BLOCKED', signalId: signal.id, reason: `Calculated quantity ${quantity} is below broker minimum ${instrument.minQuantity} under the configured trade-value limit.` });
        return;
      }

      quantity = Math.min(quantity, Number(instrument.maxQuantity));

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
      const positions = await adapter.getPositions();
      const totalExposure = positions
        .filter(position => position.currency === 'USD' && position.market === 'FOREX')
        .reduce((sum, position) => sum + Math.abs(Number(position.quantity || 0)) * Number(position.currentPrice || 0), 0)
        + (quantity * entryPrice);

      liveRuntimeLog('INFO', 'ORDER_CANDIDATE', { pair, signalId: signal.id, side: order.side, quantity, entryPrice, stopLoss: order.stopLoss, takeProfit: order.takeProfit, notional: quantity * entryPrice });

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
          maxOpenPositions: Number(getSystemConfig().maxOpenPositions)
        }
      );

      this.lastActions.push({
        pair,
        result: result.executed ? 'EXECUTED' : 'BLOCKED',
        signalId: signal.id,
        reason: result.reason,
        orderId: result.order?.brokerOrderId || result.order?.id
      });
      liveRuntimeLog(result.executed ? 'TRADE' : 'WARN', result.executed ? 'AUTO_ORDER_EXECUTION_RESULT' : 'AUTO_ORDER_BLOCKED', { pair, signalId: signal.id, result: result.executed ? 'EXECUTED' : 'BLOCKED', code: result.code, reason: result.reason, brokerOrderId: result.order?.brokerOrderId, brokerStatus: result.order?.status });
    } catch (error: any) {
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
