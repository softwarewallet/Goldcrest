import { DataSourceStatus } from '../common/types';
import { FOREX_PAIRS, ForexPairConfig, getForexPairConfig } from './instruments';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from './types';
import { getForexSessionState } from '../common/session';
import { brokerRegistry } from '../../brokers/registry';

export interface ForexDataProvider {
  getQuote(pair: string): Promise<ForexQuote> | ForexQuote;
  getCandles(pair: string, timeframe: ForexTimeframe, limit?: number): Promise<ForexCandle[]> | ForexCandle[];
  getLatestCandle(pair: string, timeframe: ForexTimeframe): Promise<ForexCandle> | ForexCandle;
  getAvailablePairs(): Promise<ForexPairConfig[]> | ForexPairConfig[];
  getMarketStatus(): Promise<ForexMarketStatus> | ForexMarketStatus;
}

export interface LiveForexDataProvider extends ForexDataProvider {
  readonly providerName: string;
  readonly status: 'LIVE';
  readonly isDemo: false;
  refreshPair(pair: string): Promise<void>;
}

/**
 * Authoritative live Forex market-data provider.
 * All market data originates from the configured cTrader LIVE adapter.
 */
export class LiveForexProvider implements LiveForexDataProvider {
  readonly providerName = 'CTRADER_LIVE_PROVIDER';
  readonly status = 'LIVE' as const;
  readonly isDemo = false as const;

  private candles = new Map<string, ForexCandle[]>();
  private quotes = new Map<string, ForexQuote>();
  private candleRefreshedAt = new Map<string, number>();

  async refreshPair(pair: string): Promise<void> {
    const config = getForexPairConfig(pair);
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');

    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const timeframes: ForexTimeframe[] = ['5M', '15M', '1H', '4H', 'Daily'];
    // Reuse higher-timeframe scanner data so the UI does not monopolize the
    // shared persistent cTrader connection while Auto Live is executing.
    const refreshTtlMs: Partial<Record<ForexTimeframe, number>> = {
      '5M': 20_000,
      '15M': 60_000,
      '1H': 300_000,
      '4H': 900_000,
      'Daily': 1_800_000
    };
    const now = Date.now();
    const dueTimeframes = timeframes.filter(timeframe => {
      const key = config.symbol + ':' + timeframe;
      const cached = this.candles.get(key);
      const latest = cached?.[cached.length - 1]?.timestamp || 0;
      const refreshedAt = this.candleRefreshedAt.get(key) || 0;
      const ttl = refreshTtlMs[timeframe] ?? 0;
      return !cached || cached.length < 35 || now - refreshedAt >= ttl || now - latest >= ttl;
    });

    const rows = await Promise.all(
      dueTimeframes.map(async timeframe => ({
        timeframe,
        data: await adapter.getHistoricalCandles!(config.symbol, timeframe, 80)
      }))
    );

    const marketStatus = this.getMarketStatus();
    let liveQuote: any = null;
    let quoteDataStatus: ForexCandle['dataStatus'] = 'DELAYED';

    // Historical trendbars remain authoritative when the market is closed.
    // Weekend/closed sessions may have no new spot events, so preserve the
    // broker-reported last close for charting and analysis instead of blanking it.
    if (marketStatus.isOpen) {
      try {
        const quote = await adapter.getQuote(config.symbol);
        if (
          quote.status === 'FRESH'
          && Date.now() - quote.timestamp < 10_000
          && quote.bid > 0
          && quote.ask > 0
        ) {
          liveQuote = quote;
          quoteDataStatus = 'LIVE';
        }
      } catch {
        // Keep historical data available. The execution engine separately
        // enforces a fresh broker quote at the order-dispatch boundary.
      }
    }

    const quoteCandles = this.candles.get(config.symbol + ':15M') || [];
    const latestHistoricalClose = Array.isArray(quoteCandles) && quoteCandles.length > 0
      ? Number(quoteCandles[quoteCandles.length - 1].close)
      : 0;

    if (!liveQuote && !(latestHistoricalClose > 0)) {
      throw new Error(`No authoritative cTrader price is available for ${config.symbol}.`);
    }

    for (const row of rows) {
      if (!Array.isArray(row.data) || row.data.length < 35) {
        throw new Error(`Insufficient live ${row.timeframe} candle history for ${config.symbol}.`);
      }

      const candles: ForexCandle[] = row.data.map((candle, index) => ({
        pair: config.symbol,
        timeframe: row.timeframe,
        timestamp: Number(candle.timestamp),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        // Historical bars provide OHLCV. When an executable live quote is
        // unavailable, bid/ask are anchored to the broker-reported bar close
        // and marked DELAYED rather than being presented as a live quote.
        bid: Number(liveQuote?.bid ?? candle.close),
        ask: Number(liveQuote?.ask ?? candle.close),
        spread: Number(liveQuote ? (liveQuote.ask - liveQuote.bid) : 0),
        volume: Number(candle.volume || 0),
        tickVolume: Number(candle.volume || 0),
        provider: liveQuote ? this.providerName : 'CTRADER_HISTORICAL_CLOSE',
        dataStatus: liveQuote && row.timeframe === '15M' ? 'LIVE' : quoteDataStatus,
      }));

      this.candles.set(`${config.symbol}:${row.timeframe}`, candles);
      this.candleRefreshedAt.set(`${config.symbol}:${row.timeframe}`, now);
    }

    for (const timeframe of timeframes) {
      const key = config.symbol + ':' + timeframe;
      if (!this.candles.has(key)) {
        throw new Error(`Live candle cache is empty for ${config.symbol} ${timeframe}.`);
      }
    }

    const first = quoteCandles[0];
    const latest = quoteCandles[quoteCandles.length - 1];
    const closePrice = latestHistoricalClose;
    const change = latest && first ? latest.close - first.open : 0;
    const changePips = change / config.pipSize;
    const changePct = first?.open ? (change / first.open) * 100 : 0;

    this.quotes.set(config.symbol, {
      pair: config.symbol,
      timestamp: liveQuote?.timestamp ?? Number(latest?.timestamp || Date.now()),
      bid: liveQuote?.bid ?? closePrice,
      ask: liveQuote?.ask ?? closePrice,
      spreadPips: liveQuote
        ? liveQuote.spread * (config.symbol.includes('JPY') ? 100 : 10000)
        : 0,
      digits: config.digits,
      pipSize: config.pipSize,
      changePips24h: Number(changePips.toFixed(1)),
      changePercent24h: Number(changePct.toFixed(2)),
      high24h: quoteCandles.length ? Math.max(...quoteCandles.map(c => c.high)) : closePrice,
      low24h: quoteCandles.length ? Math.min(...quoteCandles.map(c => c.low)) : closePrice,
      provider: liveQuote ? this.providerName : 'CTRADER_HISTORICAL_CLOSE',
      dataStatus: quoteDataStatus,
    });
  }

  getQuote(pair: string): ForexQuote {
    const quote = this.quotes.get(getForexPairConfig(pair).symbol);
    if (!quote) throw new Error(`Live quote cache is empty for ${pair}. Refresh live market data first.`);
    return quote;
  }

  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit = 80): ForexCandle[] {
    const rows = this.candles.get(`${getForexPairConfig(pair).symbol}:${timeframe}`) || [];
    return rows.slice(Math.max(0, rows.length - limit));
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const rows = this.getCandles(pair, timeframe, 2);
    if (!rows.length) throw new Error(`Live candle cache is empty for ${pair} ${timeframe}. Refresh live market data first.`);
    return rows[rows.length - 1];
  }

  getAvailablePairs(): ForexPairConfig[] {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    const isWeekend = session.activeSessions.includes('CLOSED (WEEKEND)');
    return {
      isOpen: !isWeekend,
      status: isWeekend ? 'WEEKEND' : 'OPEN',
      activeSessions: session.activeSessions,
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: new Date().toISOString()
    };
  }
}

/**
 * Validates data quality of candle arrays
 */
export function validateCandleDataQuality(candles: ForexCandle[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!candles || candles.length === 0) {
    errors.push('No candle data supplied');
    return { isValid: false, errors };
  }

  const seenTimestamps = new Set<number>();
  let prevTimestamp = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // Invalid OHLC values
    if (c.high < c.low) {
      errors.push(`Candle at ${i} has High (${c.high}) < Low (${c.low})`);
    }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      errors.push(`Candle at ${i} has non-positive price (Close: ${c.close})`);
    }
    if (c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      errors.push(`Candle at ${i} has Open or Close outside High/Low range`);
    }

    // Duplicate timestamps
    if (seenTimestamps.has(c.timestamp)) {
      errors.push(`Duplicate timestamp detected: ${c.timestamp}`);
    }
    seenTimestamps.add(c.timestamp);

    // Out-of-order timestamps
    if (i > 0 && c.timestamp <= prevTimestamp) {
      errors.push(`Out of order timestamp at bar ${i}: current ${c.timestamp} <= prev ${prevTimestamp}`);
    }
    prevTimestamp = c.timestamp;
  }

  // Check freshness (stale data check: latest candle older than 48 hours unless weekend)
  const now = Date.now();
  const latestTs = candles[candles.length - 1].timestamp;
  if (now - latestTs > 48 * 60 * 60 * 1000) {
    errors.push(`Stale market data: latest candle is older than 48 hours`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
