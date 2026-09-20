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

export class LiveForexProvider implements ForexDataProvider {
  readonly providerName = 'CTRADER_LIVE_PROVIDER';
  readonly status: DataSourceStatus = 'LIVE';
  readonly isLive = true;

  private candles = new Map<string, ForexCandle[]>();
  private quotes = new Map<string, ForexQuote>();

  async refreshPair(pair: string): Promise<void> {
    const config = getForexPairConfig(pair);
    const adapter = brokerRegistry.getAdapter('CTRADER', 'LIVE');

    if (!adapter.getHistoricalCandles) {
      throw new Error('Authoritative cTrader historical market-data capability is unavailable.');
    }

    const timeframes: ForexTimeframe[] = ['5M', '15M', '1H', '4H', 'Daily'];
    const rows = await Promise.all(
      timeframes.map(async timeframe => ({
        timeframe,
        data: await adapter.getHistoricalCandles!(config.symbol, timeframe, 80)
      }))
    );

    for (const row of rows) {
      if (!Array.isArray(row.data) || row.data.length < 35) {
        throw new Error(`Insufficient live ${row.timeframe} candle history for ${config.symbol}.`);
      }

      const candles = row.data.map((c: any) => ({
        pair: config.symbol,
        timeframe: row.timeframe,
        timestamp: Number(c.timestamp),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume || 0),
        tickVolume: Number(c.volume || 0),
        provider: this.providerName,
        dataStatus: this.status
      } satisfies ForexCandle));

      this.candles.set(`${config.symbol}:${row.timeframe}`, candles);
    }

    const quote = await adapter.getQuote(config.symbol);
    if (quote.status !== 'FRESH' || Date.now() - quote.timestamp >= 10_000) {
      throw new Error(`Live quote for ${config.symbol} is stale or delayed.`);
    }

    const primary = this.candles.get(`${config.symbol}:15M`) || [];
    const latest = primary[primary.length - 1];
    const open24h = primary[0]?.open ?? latest?.close ?? quote.ask;
    const high24h = primary.length ? Math.max(...primary.map(c => c.high)) : quote.ask;
    const low24h = primary.length ? Math.min(...primary.map(c => c.low)) : quote.bid;
    const mid = (quote.bid + quote.ask) / 2;

    this.quotes.set(config.symbol, {
      pair: config.symbol,
      timestamp: quote.timestamp,
      bid: quote.bid,
      ask: quote.ask,
      spreadPips: quote.spread * (config.symbol.includes('JPY') ? 100 : 10000),
      digits: config.digits,
      pipSize: config.pipSize,
      changePips24h: Number(((mid - open24h) / config.pipSize).toFixed(1)),
      changePercent24h: Number((((mid - open24h) / open24h) * 100).toFixed(2)),
      high24h: Number(high24h.toFixed(config.digits)),
      low24h: Number(low24h.toFixed(config.digits)),
      provider: this.providerName,
      dataStatus: this.status
    });
  }

  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit = 80): ForexCandle[] {
    const config = getForexPairConfig(pair);
    const rows = this.candles.get(`${config.symbol}:${timeframe}`) || [];
    if (!rows.length) {
      throw new Error(`Live cTrader candle cache is empty for ${config.symbol} ${timeframe}; refreshPair() is required.`);
    }
    return rows.slice(Math.max(0, rows.length - limit));
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const rows = this.getCandles(pair, timeframe, 1);
    return rows[rows.length - 1];
  }

  getQuote(pair: string): ForexQuote {
    const config = getForexPairConfig(pair);
    const quote = this.quotes.get(config.symbol);
    if (!quote) {
      throw new Error(`Live cTrader quote cache is empty for ${config.symbol}; refreshPair() is required.`);
    }
    return quote;
  }

  getAvailablePairs(): ForexPairConfig[] {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    return {
      isOpen: !session.activeSessions.includes('CLOSED (WEEKEND)'),
      status: session.activeSessions.includes('CLOSED (WEEKEND)') ? 'WEEKEND' : 'OPEN',
      activeSessions: [...session.activeSessions],
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: new Date().toISOString()
    };
  }
}

/**
 * Validates the structure and freshness of an authoritative live candle series.
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
    if (c.high < c.low) errors.push(`Candle at ${i} has High (${c.high}) < Low (${c.low})`);
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      errors.push(`Candle at ${i} has non-positive price (Close: ${c.close})`);
    }
    if (c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      errors.push(`Candle at ${i} has Open or Close outside High/Low range`);
    }
    if (seenTimestamps.has(c.timestamp)) errors.push(`Duplicate timestamp detected: ${c.timestamp}`);
    seenTimestamps.add(c.timestamp);
    if (i > 0 && c.timestamp <= prevTimestamp) {
      errors.push(`Out of order timestamp at bar ${i}: current ${c.timestamp} <= prev ${prevTimestamp}`);
    }
    prevTimestamp = c.timestamp;
  }

  const latestTs = candles[candles.length - 1].timestamp;
  if (Date.now() - latestTs > 48 * 60 * 60 * 1000) {
    errors.push('Stale market data: latest candle is older than 48 hours');
  }

  return { isValid: errors.length === 0, errors };
}
