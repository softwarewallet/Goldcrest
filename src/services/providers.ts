import { Candle, DataSourceStatus, OptionChainSummary } from '../markets/common/types';
import { brokerRegistry } from '../brokers/registry';
import { FivePaisaBrokerAdapter } from '../brokers/adapters/fivepaisa/FivePaisaBrokerAdapter';

export interface MarketDataProvider {
  status: DataSourceStatus;
  isLive: boolean;
}

export class LiveIndianMarketProvider implements MarketDataProvider {
  status: DataSourceStatus = 'LIVE';
  isLive = true;

  private cachedUnderlyings: any[] = [];
  private lastFetchTime = 0;

  private getAdapter(): FivePaisaBrokerAdapter {
    const adapter = brokerRegistry.getFivePaisaAdapter('LIVE');
    if (!adapter) {
      throw new Error('5paisa LIVE adapter is unavailable.');
    }
    return adapter;
  }

  async refreshUnderlyings(): Promise<any[]> {
    const adapter = this.getAdapter();
    const data = await adapter.fetchIndianUnderlyingsFrom5Paisa();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('5paisa LIVE market-underlyings feed returned no data.');
    }
    this.cachedUnderlyings = data;
    this.lastFetchTime = Date.now();
    return data;
  }

  async fetchCandles(symbol: string, count = 60): Promise<Candle[]> {
    return this.getAdapter().fetchHistoricalCandlesFrom5Paisa(symbol, count);
  }

  getUnderlyingsOverview(): any[] {
    return [...this.cachedUnderlyings];
  }

  getLastFetchTime(): number {
    return this.lastFetchTime;
  }
}

export class LiveOptionsChainProvider implements MarketDataProvider {
  status: DataSourceStatus = 'LIVE';
  isLive = true;

  private cachedChains = new Map<string, { data: OptionChainSummary; timestamp: number }>();

  private getAdapter(): FivePaisaBrokerAdapter {
    const adapter = brokerRegistry.getFivePaisaAdapter('LIVE');
    if (!adapter) {
      throw new Error('5paisa LIVE adapter is unavailable.');
    }
    return adapter;
  }

  async refreshChain(symbol: string, selectedExpiry?: string, depth = 7): Promise<OptionChainSummary> {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const liveChain = await this.getAdapter().fetchOptionChainFrom5Paisa(clean, selectedExpiry, depth);
    if (!liveChain || liveChain.rows.length === 0) {
      throw new Error(`5paisa LIVE option-chain feed returned no data for ${clean}.`);
    }
    this.cachedChains.set(`${clean}_${selectedExpiry || 'DEFAULT'}_${depth}`, {
      data: liveChain,
      timestamp: Date.now()
    });
    return liveChain;
  }

  getChain(symbol: string, selectedExpiry?: string, depth = 7): OptionChainSummary {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const key = `${clean}_${selectedExpiry || 'DEFAULT'}_${depth}`;
    const cached = this.cachedChains.get(key);
    if (!cached) {
      throw new Error(`5paisa LIVE option-chain data is not yet loaded for ${clean}.`);
    }
    return cached.data;
  }
}
