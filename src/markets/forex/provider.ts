import { DataSourceStatus } from '../common/types';
import { FOREX_PAIRS, ForexPairConfig, getForexPairConfig } from './instruments';
import { ForexCandle, ForexMarketStatus, ForexQuote, ForexTimeframe } from './types';
import { getForexSessionState } from '../common/session';

export interface ForexDataProvider {
  getQuote(pair: string): Promise<ForexQuote> | ForexQuote;
  getCandles(pair: string, timeframe: ForexTimeframe, limit?: number): Promise<ForexCandle[]> | ForexCandle[];
  getLatestCandle(pair: string, timeframe: ForexTimeframe): Promise<ForexCandle> | ForexCandle;
  getAvailablePairs(): Promise<ForexPairConfig[]> | ForexPairConfig[];
  getMarketStatus(): Promise<ForexMarketStatus> | ForexMarketStatus;
}

const TIMEFRAME_MINUTES: Record<ForexTimeframe, number> = {
  '1M': 1,
  '5M': 5,
  '15M': 15,
  '30M': 30,
  '1H': 60,
  '4H': 240,
  'Daily': 1440
};

export class ForexDemoProvider implements ForexDataProvider {
  readonly providerName = 'DEMO_PROVIDER_V2';
  readonly status: DataSourceStatus = 'DEMO';
  readonly isDemo = true;

  // Realistically grounded base prices for pairs
  private basePrices: Record<string, number> = {
    'EUR/USD': 1.08450,
    'GBP/USD': 1.29820,
    'USD/JPY': 152.450,
    'USD/CHF': 0.88720,
    'AUD/USD': 0.65420,
    'USD/CAD': 1.38540,
    'NZD/USD': 0.59240,
    'EUR/GBP': 0.83540,
    'EUR/JPY': 165.350,
    'GBP/JPY': 197.900,
    'AUD/JPY': 99.720,
    'EUR/AUD': 1.65820,
    'GBP/AUD': 1.98450,
    'XAU/USD': 2685.50
  };

  /**
   * Generates realistic candles for a given timeframe with synthetic micro-trends,
   * realistic bid/ask spreads, and volume.
   */
  getCandles(pair: string, timeframe: ForexTimeframe = '15M', limit: number = 80): ForexCandle[] {
    const config = getForexPairConfig(pair);
    const base = this.basePrices[config.symbol] ?? 1.1000;
    const intervalMinutes = TIMEFRAME_MINUTES[timeframe] || 15;
    const intervalMs = intervalMinutes * 60 * 1000;

    // Volatility scales with sqrt of timeframe duration
    const tfFactor = Math.sqrt(intervalMinutes / 15);
    const baseVol = config.pipSize === 0.01 ? 0.0025 : 0.0012;
    const volatility = baseVol * tfFactor;

    // Directional bias based on pair profile
    const trendBias = config.symbol.includes('EUR') ? 0.0002 : config.symbol.includes('JPY') ? 0.0003 : -0.0001;

    const candles: ForexCandle[] = [];
    const now = Date.now();
    let currentClose = base;

    const spreadPips = config.typicalSpreadPips;
    const spreadValue = spreadPips * config.pipSize;

    for (let i = limit - 1; i >= 0; i--) {
      const timestamp = now - i * intervalMs;
      // Realistic sinusoidal cyclical movement + macro trend drift
      const cycle = Math.sin(i * 0.35) * volatility + Math.cos(i * 0.12) * (volatility * 0.5);
      const drift = trendBias * ((limit - i) / limit);
      const totalPctChange = cycle + drift;

      const open = currentClose;
      const close = Number((open * (1 + totalPctChange)).toFixed(config.digits));
      const wickExt = Math.abs(totalPctChange * 0.45) + (config.pipSize * 3);
      const high = Number((Math.max(open, close) + wickExt).toFixed(config.digits));
      const low = Number((Math.min(open, close) - wickExt).toFixed(config.digits));

      // Realistic tick volume that surges around breakout points
      const baseTickVol = Math.round(1200 * tfFactor);
      const cycleTickVol = Math.round(Math.abs(Math.sin(i * 0.5)) * 2800 * tfFactor);
      const volume = baseTickVol + cycleTickVol;

      const halfSpread = spreadValue / 2;
      const bid = Number((close - halfSpread).toFixed(config.digits));
      const ask = Number((close + halfSpread).toFixed(config.digits));

      candles.push({
        pair: config.symbol,
        timeframe,
        timestamp,
        open,
        high,
        low,
        close,
        bid,
        ask,
        spread: spreadPips,
        volume,
        tickVolume: volume,
        provider: this.providerName,
        dataStatus: this.status
      });

      currentClose = close;
    }

    return candles;
  }

  getLatestCandle(pair: string, timeframe: ForexTimeframe = '15M'): ForexCandle {
    const candles = this.getCandles(pair, timeframe, 2);
    return candles[candles.length - 1];
  }

  getQuote(pair: string): ForexQuote {
    const config = getForexPairConfig(pair);
    const candles = this.getCandles(pair, '15M', 96); // 24h of 15m candles
    const latest = candles[candles.length - 1];
    const open24h = candles[0].open;

    const change = latest.close - open24h;
    const changePips = change / config.pipSize;
    const changePct = (change / open24h) * 100;

    const high24h = Math.max(...candles.map(c => c.high));
    const low24h = Math.min(...candles.map(c => c.low));

    return {
      pair: config.symbol,
      timestamp: latest.timestamp,
      bid: latest.bid,
      ask: latest.ask,
      spreadPips: config.typicalSpreadPips,
      digits: config.digits,
      pipSize: config.pipSize,
      changePips24h: Number(changePips.toFixed(1)),
      changePercent24h: Number(changePct.toFixed(2)),
      high24h: Number(high24h.toFixed(config.digits)),
      low24h: Number(low24h.toFixed(config.digits)),
      provider: this.providerName,
      dataStatus: this.status
    };
  }

  getAvailablePairs(): ForexPairConfig[] {
    return FOREX_PAIRS;
  }

  getMarketStatus(): ForexMarketStatus {
    const session = getForexSessionState();
    const utcDate = new Date();
    const day = utcDate.getUTCDay();
    const hour = utcDate.getUTCHours();

    // Forex markets close Friday 21:00 UTC and reopen Sunday 21:00 UTC
    let isWeekend = false;
    if (day === 6) isWeekend = true;
    if (day === 5 && hour >= 21) isWeekend = true;
    if (day === 0 && hour < 21) isWeekend = true;

    return {
      isOpen: !isWeekend,
      status: isWeekend ? 'WEEKEND' : 'OPEN',
      activeSessions: session.activeSessions,
      currentSession: session.activeSessions.join(' / ') || 'Interbank Electronic Off-Peak',
      isLondonNyOverlap: session.isLondonNyOverlap,
      serverUtcTime: utcDate.toISOString()
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
