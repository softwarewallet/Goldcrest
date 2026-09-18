import { Candle, DataSourceStatus, EconomicEvent, OptionChainSummary, TradingSignal } from '../markets/common/types';
import { FOREX_PAIRS, getForexPairConfig } from '../markets/forex/instruments';
import { evaluateForexSetup } from '../markets/forex/forexEngine';
import { INDIAN_UNDERLYINGS } from '../markets/india_equity/underlyings';
import { evaluateIndianUnderlying, IndianUnderlyingAnalysis } from '../markets/india_equity/indiaEngine';
import { buildOptionChain } from '../markets/india_options/optionsChain';
import { brokerRegistry } from '../brokers/registry';
import { FivePaisaBrokerAdapter } from '../brokers/adapters/fivepaisa/FivePaisaBrokerAdapter';

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
  status: DataSourceStatus = 'LIVE';
  isDemo: boolean = false;

  private cachedUnderlyings: IndianUnderlyingAnalysis[] = [];
  private lastFetchTime: number = 0;

  private get5PaisaAdapter(): FivePaisaBrokerAdapter | null {
    try {
      const adapter = brokerRegistry.getFivePaisaAdapter();
      if (adapter && typeof adapter.hasActiveSession === 'function' && adapter.hasActiveSession()) {
        return adapter;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  async fetchUnderlyingsOverview(): Promise<IndianUnderlyingAnalysis[]> {
    const adapter = this.get5PaisaAdapter();
    if (!adapter) {
      this.cachedUnderlyings = [];
      return []; // Return blank data when 5paisa API connection is unavailable
    }

    try {
      const liveData = await adapter.fetchIndianUnderlyingsFrom5Paisa();
      if (liveData && liveData.length > 0) {
        this.cachedUnderlyings = liveData;
        this.lastFetchTime = Date.now();
        this.status = 'LIVE';
        return liveData;
      }
    } catch (e) {
      console.error('Error fetching live Indian underlyings from 5paisa:', e);
    }

    this.cachedUnderlyings = [];
    return [];
  }

  getUnderlyingsOverview(): IndianUnderlyingAnalysis[] {
    const adapter = this.get5PaisaAdapter();
    if (!adapter) {
      return []; // Strictly return blank data when 5paisa API is unavailable
    }

    // Trigger async background refresh if stale
    if (Date.now() - this.lastFetchTime > 5000) {
      this.fetchUnderlyingsOverview().catch(() => {});
    }

    return this.cachedUnderlyings;
  }

  async fetchCandles(symbol: string, count: number = 60): Promise<Candle[]> {
    const adapter = this.get5PaisaAdapter();
    if (!adapter) {
      return []; // Strictly return blank candles when 5paisa API is unavailable
    }

    try {
      const liveCandles = await adapter.fetchHistoricalCandlesFrom5Paisa(symbol, count);
      if (liveCandles && liveCandles.length > 0) {
        return liveCandles;
      }
    } catch (e) {
      console.error(`Error fetching 5paisa candles for ${symbol}:`, e);
    }

    return [];
  }

  getCandles(symbol: string, count: number = 60): Candle[] {
    const adapter = this.get5PaisaAdapter();
    if (!adapter) {
      return []; // Return blank data when 5paisa API connection is unavailable
    }

    return [];
  }
}

export class OptionsChainDemoProvider implements MarketDataProvider {
  status: DataSourceStatus = 'LIVE';
  isDemo: boolean = false;

  private cachedChains: Map<string, { data: OptionChainSummary; timestamp: number }> = new Map();

  private get5PaisaAdapter(): FivePaisaBrokerAdapter | null {
    try {
      const adapter = brokerRegistry.getFivePaisaAdapter();
      if (adapter && typeof adapter.hasActiveSession === 'function' && adapter.hasActiveSession()) {
        return adapter;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  async fetchChain(symbol: string, selectedExpiry?: string, depth: number = 7): Promise<OptionChainSummary> {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const cacheKey = `${clean}_${selectedExpiry || 'DEFAULT'}_${depth}`;
    const adapter = this.get5PaisaAdapter();

    if (adapter) {
      try {
        const liveChain = await adapter.fetchOptionChainFrom5Paisa(clean, selectedExpiry, depth);
        if (liveChain && liveChain.rows && liveChain.rows.length > 0) {
          this.cachedChains.set(cacheKey, { data: liveChain, timestamp: Date.now() });
          return liveChain;
        }
      } catch (e) {
        console.error(`Error fetching 5paisa option chain for ${clean}:`, e);
      }
    }

    // Return blank data when 5paisa API connection is unavailable
    const blankChain: OptionChainSummary = {
      underlying: clean,
      spotPrice: 0,
      atmStrike: 0,
      expiry: selectedExpiry || '',
      availableExpiries: [],
      totalCallOI: 0,
      totalPutOI: 0,
      pcr: 0,
      callResistanceStrike: 0,
      putSupportStrike: 0,
      highOIStrikeCall: 0,
      highOIStrikePut: 0,
      rows: [],
      isBlank: true,
      error: '5paisa API Connection Required. Authenticate 5paisa in Broker Settings.',
      timestamp: Date.now()
    };
    return blankChain;
  }

  getChain(symbol: string, selectedExpiry?: string, depth: number = 7): OptionChainSummary {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const cacheKey = `${clean}_${selectedExpiry || 'DEFAULT'}_${depth}`;
    const adapter = this.get5PaisaAdapter();

    if (!adapter) {
      return {
        underlying: clean,
        spotPrice: 0,
        atmStrike: 0,
        expiry: selectedExpiry || '',
        availableExpiries: [],
        totalCallOI: 0,
        totalPutOI: 0,
        pcr: 0,
        callResistanceStrike: 0,
        putSupportStrike: 0,
        highOIStrikeCall: 0,
        highOIStrikePut: 0,
        rows: [],
        isBlank: true,
        error: '5paisa API Connection Required. Authenticate 5paisa in Broker Settings.',
        timestamp: Date.now()
      };
    }

    const cached = this.cachedChains.get(cacheKey);
    if (cached) {
      if (Date.now() - cached.timestamp > 5000) {
        this.fetchChain(clean, selectedExpiry, depth).catch(() => {});
      }
      return cached.data;
    }

    // Trigger async fetch in background
    this.fetchChain(clean, selectedExpiry, depth).catch(() => {});

    return {
      underlying: clean,
      spotPrice: 0,
      atmStrike: 0,
      expiry: selectedExpiry || '',
      availableExpiries: [],
      totalCallOI: 0,
      totalPutOI: 0,
      pcr: 0,
      callResistanceStrike: 0,
      putSupportStrike: 0,
      highOIStrikeCall: 0,
      highOIStrikePut: 0,
      rows: [],
      isBlank: true,
      error: 'Fetching live option chain from 5paisa...',
      timestamp: Date.now()
    };
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
