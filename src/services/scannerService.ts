import { TradingSignal } from '../markets/common/types';
import { LiveForexProvider } from '../markets/forex/provider';
import { getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getSystemConfig } from './configService';
import { liveRuntimeLog } from './liveRuntimeLog';

const FOREX_SCAN_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.GOLDCREST_FOREX_SCAN_CONCURRENCY || 4))
);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

function mapForexSignal(signal: any): TradingSignal {
  const direction = String(signal.direction || 'NO_TRADE');
  const normalizedDirection: TradingSignal['direction'] =
    direction.includes('BUY') ? 'BUY' :
    direction.includes('SELL') ? 'SELL' :
    direction === 'NO_TRADE' ? 'NO_TRADE' : 'WAIT';

  return {
    id: signal.id,
    timestamp: signal.timestamp,
    market: 'FOREX',
    instrument: signal.pair,
    direction: normalizedDirection,
    category: signal.signalCategory,
    strategy: signal.strategyVersion,
    score: signal.score,
    scoreBreakdown: {
      trend: signal.scoreBreakdown.trend,
      multiTimeframe: signal.scoreBreakdown.multiTimeframe,
      momentum: signal.scoreBreakdown.momentum,
      marketStructure: signal.scoreBreakdown.marketStructure,
      supportResistance: signal.scoreBreakdown.supportResistance,
      volumeOI: 0,
      mlProbability: signal.mlProbability ?? 0,
      riskReward: signal.scoreBreakdown.riskReward,
      volatility: signal.scoreBreakdown.volatility,
      totalScore: signal.score
    },
    mlProbability: signal.mlProbability ?? 0,
    entryZone: signal.tradePlan
      ? {
          min: signal.tradePlan.entryMin,
          max: signal.tradePlan.entryMax,
          preferred: signal.tradePlan.entryPreferred
        }
      : { min: 0, max: 0, preferred: 0 },
    stopLoss: signal.tradePlan?.stopLoss ?? 0,
    target1: signal.tradePlan?.takeProfit1?.targetPrice ?? 0,
    target2: signal.tradePlan?.takeProfit2?.targetPrice ?? 0,
    target3: signal.tradePlan?.takeProfit3?.targetPrice,
    riskReward: signal.tradePlan?.riskReward ?? 0,
    status: signal.status === 'ACTIVE' ? 'ACTIVE' : signal.status === 'NO_TRADE' ? 'CANCELLED' : 'WAITING',
    invalidationConditions: signal.invalidationConditions || [],
    reasons: signal.reasons || [],
    noTradeReasons: signal.noTradeReasons || [],
    modelVersion: signal.modelVersion
  };
}

export class ScannerService {
  private forexProvider = new LiveForexProvider();
  private forexSignalEngine = new ForexSignalEngine(undefined, this.forexProvider);

  async getForexScanner(pairs?: string[]) {
    const configuredPairs = pairs?.length ? pairs : getSystemConfig().autoLiveForexPairs;
    const selected = configuredPairs.length
      ? configuredPairs.map(symbol => getForexPairConfig(symbol))
      : this.forexProvider.getAvailablePairs();

    const scanned = await mapWithConcurrency(
      selected,
      FOREX_SCAN_CONCURRENCY,
      async pair => {
        try {
          await this.forexProvider.refreshPair(pair.symbol);
          const signal = await this.forexSignalEngine.generateSignal(pair.symbol);
          const quote = this.forexProvider.getQuote(pair.symbol);
          return {
            symbol: pair.symbol,
            description: pair.description,
            bid: quote.bid,
            ask: quote.ask,
            spreadPips: quote.spreadPips,
            changePips: quote.changePips24h,
            changePercent24h: quote.changePercent24h,
            digits: pair.digits,
            signal: mapForexSignal(signal),
            dataStatus: 'LIVE',
            dataSource: quote.provider
          };
        } catch (error: any) {
          return {
            symbol: pair.symbol,
            description: pair.description,
            signal: null,
            dataStatus: 'UNKNOWN',
            error: error?.message || String(error)
          };
        }
      }
    );

    liveRuntimeLog('INFO', 'FOREX_SCANNER_COMPLETED', {
      configuredPairCount: selected.length,
      configuredPairs: selected.map(pair => pair.symbol),
      scannedPairCount: scanned.length,
      actionableCount: scanned.filter(item => item.signal && ['BUY', 'SELL'].includes(item.signal.direction)).length,
      noTradeCount: scanned.filter(item => item.signal && item.signal.direction === 'NO_TRADE').length,
      errorCount: scanned.filter(item => !item.signal || item.dataStatus !== 'LIVE').length,
      scanConcurrency: FOREX_SCAN_CONCURRENCY,
      failedPairs: scanned.filter(item => !item.signal).map(item => ({ symbol: item.symbol, error: item.error }))
    });

    return scanned;
  }

  async getAllSignals(): Promise<TradingSignal[]> {
    const forex = await this.getForexScanner(getSystemConfig().autoLiveForexPairs);
    return forex.map(item => item.signal).filter(Boolean) as TradingSignal[];
  }
}
