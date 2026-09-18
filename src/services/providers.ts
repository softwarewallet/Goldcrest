import { Candle, DataSourceStatus, EconomicEvent, OptionChainSummary, TradingSignal } from '../markets/common/types';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { evaluateForexSetup } from '../markets/forex/forexEngine';
import { INDIAN_UNDERLYINGS } from '../markets/india_equity/underlyings';
import { evaluateIndianUnderlying, IndianUnderlyingAnalysis } from '../markets/india_equity/indiaEngine';
import { buildOptionChain } from '../markets/india_options/optionsChain';

export interface MarketDataProvider {
  status: DataSourceStatus;
  isDemo: boolean;
}

/**
 * Generates synthetic deterministic realistic candles for demo testing
 */
export function generateDemoCandles(
  basePrice: number,
  count: number = 80,
  volatility: number = 0.0015,
  trendBias: number = 0.0003
): Candle[] {
  const candles: Candle[] = [];
  let currentClose = basePrice;
  const now = Date.now();
  const intervalMs = 15 * 60 * 1000; // 15-minute candles

  let cumulativeTPV = 0;
  let cumulativeVol = 0;

  for (let i = count - 1; i >= 0; i--) {
    const timestamp = now - i * intervalMs;
    const changePct = (Math.sin(i * 0.4) * volatility) + (trendBias * (count - i) / count);
    const open = currentClose;
    const close = Number((open * (1 + changePct)).toFixed(5));
    const high = Number((Math.max(open, close) * (1 + Math.abs(changePct * 0.5) + 0.0004)).toFixed(5));
    const low = Number((Math.min(open, close) * (1 - Math.abs(changePct * 0.5) - 0.0004)).toFixed(5));
    const volume = Math.round(1500 + Math.abs(Math.sin(i)) * 4000);

    const typicalPrice = (high + low + close) / 3;
    cumulativeTPV += typicalPrice * volume;
    cumulativeVol += volume;
    const vwap = cumulativeVol > 0 ? Number((cumulativeTPV / cumulativeVol).toFixed(5)) : close;

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      vwap
    });

    currentClose = close;
  }

  return candles;
}

export class ForexDemoProvider implements MarketDataProvider {
  status: DataSourceStatus = 'DEMO';
  isDemo: boolean = true;

  // Base spot references
  private basePrices: Record<string, number> = {
    'EUR/USD': 1.0845,
    'GBP/USD': 1.2980,
    'USD/JPY': 152.40,
    'USD/CHF': 0.8870,
    'AUD/USD': 0.6540,
    'USD/CAD': 1.3850,
    'NZD/USD': 0.5920,
    'EUR/GBP': 0.8355,
    'EUR/JPY': 165.25,
    'GBP/JPY': 197.80,
    'AUD/JPY': 99.65,
    'EUR/AUD': 1.6580,
    'GBP/AUD': 1.9840,
    'XAU/USD': 2685.50
  };

  getCandles(symbol: string, count: number = 80): Candle[] {
    const cfg = getForexPairConfig(symbol);
    const base = this.basePrices[cfg.symbol] ?? 1.1000;
    const volatility = cfg.pipSize === 0.01 ? 0.003 : 0.0018;
    const trend = cfg.symbol.includes('EUR') ? 0.0004 : -0.0002;
    return generateDemoCandles(base, count, volatility, trend);
  }

  getPairsOverview() {
    return FOREX_PAIRS.map(pair => {
      const candles = this.getCandles(pair.symbol, 60);
      const latest = candles[candles.length - 1];
      const prev = candles[candles.length - 2] ?? latest;
      const change = latest.close - prev.close;
      const changePips = change / pair.pipSize;
      const spread = pair.typicalSpreadPips;
      const halfSpread = (spread * pair.pipSize) / 2;
      const bid = Number((latest.close - halfSpread).toFixed(pair.digits));
      const ask = Number((latest.close + halfSpread).toFixed(pair.digits));

      const signal = evaluateForexSetup(pair.symbol, candles);

      return {
        symbol: pair.symbol,
        description: pair.description,
        bid,
        ask,
        spreadPips: spread,
        changePips: Number(changePips.toFixed(1)),
        changePercent: Number(((change / prev.close) * 100).toFixed(2)),
        digits: pair.digits,
        signal,
        dataStatus: this.status
      };
    });
  }
}

export class IndianMarketDemoProvider implements MarketDataProvider {
  status: DataSourceStatus = 'DEMO';
  isDemo: boolean = true;

  private spotPrices: Record<string, number> = {
    'NIFTY': 25420.50,
    'BANKNIFTY': 52380.00,
    'FINNIFTY': 24150.25,
    'MIDCPNIFTY': 13240.80,
    'SENSEX': 82950.00
  };

  getCandles(symbol: string, count: number = 60): Candle[] {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const base = this.spotPrices[clean] ?? 25000;
    return generateDemoCandles(base, count, 0.0025, 0.0005);
  }

  getUnderlyingsOverview(): IndianUnderlyingAnalysis[] {
    return INDIAN_UNDERLYINGS.map(u => {
      const spot = this.spotPrices[u.symbol] ?? 25000;
      const candles = this.getCandles(u.symbol, 50);
      return evaluateIndianUnderlying(u.symbol, candles, spot, 13.8, 1.12);
    });
  }
}

export class OptionsChainDemoProvider implements MarketDataProvider {
  status: DataSourceStatus = 'DEMO';
  isDemo: boolean = true;

  getChain(symbol: string, selectedExpiry?: string, depth: number = 7): OptionChainSummary {
    const indianProv = new IndianMarketDemoProvider();
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const spot = (indianProv as any).spotPrices[clean] ?? 25420.50;
    return buildOptionChain(clean, spot, selectedExpiry, depth);
  }
}

export class EconomicCalendarDemoProvider implements MarketDataProvider {
  status: DataSourceStatus = 'DEMO';
  isDemo: boolean = true;

  getEvents(): EconomicEvent[] {
    const now = Date.now();
    return [
      {
        id: 'ec_1',
        title: 'US Federal Reserve FOMC Interest Rate Decision',
        currency: 'USD',
        impact: 'HIGH',
        timestamp: now + 38 * 60 * 1000,
        minutesUntil: 38,
        blocksNewEntry: false
      },
      {
        id: 'ec_2',
        title: 'ECB Monetary Policy Statement & Press Conference',
        currency: 'EUR',
        impact: 'HIGH',
        timestamp: now + 160 * 60 * 1000,
        minutesUntil: 160,
        blocksNewEntry: false
      },
      {
        id: 'ec_3',
        title: 'RBI Monetary Policy Committee Announcement',
        currency: 'INR',
        impact: 'HIGH',
        timestamp: now + 340 * 60 * 1000,
        minutesUntil: 340,
        blocksNewEntry: false
      },
      {
        id: 'ec_4',
        title: 'US Core CPI Inflation (YoY)',
        currency: 'USD',
        impact: 'HIGH',
        timestamp: now + 720 * 60 * 1000,
        minutesUntil: 720,
        blocksNewEntry: false
      },
      {
        id: 'ec_5',
        title: 'Bank of Japan (BOJ) Policy Rate Announcement',
        currency: 'JPY',
        impact: 'HIGH',
        timestamp: now + 940 * 60 * 1000,
        minutesUntil: 940,
        blocksNewEntry: false
      }
    ];
  }
}
