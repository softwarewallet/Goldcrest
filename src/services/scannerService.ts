import { TradingSignal } from '../markets/common/types';
import { brokerRegistry } from '../brokers/registry';
import { calculateStrategyPayoff, OptionStrategyType } from '../markets/india_options/strategySkeleton';
import { LiveForexProvider } from '../markets/forex/provider';
import { getForexPairConfig } from '../markets/forex/instruments';
import { ForexSignalEngine } from '../markets/forex/signalEngine';
import { getSystemConfig } from './configService';

export interface OptionsOpportunityCandidate {
  id: string;
  underlying: string;
  spot: number;
  strategyType: OptionStrategyType;
  title: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  mlProbability: number | null;
  entryPremium: number;
  maxLoss: number;
  maxProfit: number;
  breakeven: number[];
  riskReward: number;
  status: 'LONG_CALL' | 'LONG_PUT' | 'BULL_CALL_SPREAD' | 'BEAR_PUT_SPREAD' | 'WAIT' | 'NO_TRADE';
  reasons: string[];
  invalidation: string[];
  expiry: string;
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
    modelVersion: signal.modelVersion,
    expiry: undefined
  };
}

export class ScannerService {
  private forexProvider = new LiveForexProvider();
  private forexSignalEngine = new ForexSignalEngine(undefined, this.forexProvider);

  private getFivePaisaAdapter() {
    const adapter = brokerRegistry.getFivePaisaAdapter();
    if (!adapter) throw new Error('5paisa LIVE adapter is unavailable.');
    return adapter;
  }

  async getForexScanner(pairs?: string[]) {
    const results: any[] = [];
    const configuredPairs = pairs?.length
      ? pairs
      : getSystemConfig().autoLiveForexPairs;
    const selected = configuredPairs.length
      ? configuredPairs.map(symbol => getForexPairConfig(symbol))
      : this.forexProvider.getAvailablePairs();

    for (const pair of selected) {
      try {
        await this.forexProvider.refreshPair(pair.symbol);
        const signal = await this.forexSignalEngine.generateSignal(pair.symbol);
        const quote = this.forexProvider.getQuote(pair.symbol);
        results.push({
          symbol: pair.symbol,
          description: pair.description,
          bid: quote.bid,
          ask: quote.ask,
          spreadPips: quote.spreadPips,
          changePips: quote.changePips24h,
          changePercent: quote.changePercent24h,
          digits: pair.digits,
          signal: mapForexSignal(signal),
          dataStatus: 'LIVE',
          dataSource: quote.provider
        });
      } catch (error: any) {
        results.push({
          symbol: pair.symbol,
          description: pair.description,
          signal: null,
          dataStatus: 'UNKNOWN',
          error: error?.message || String(error)
        });
      }
    }
    return results;
  }

  async getIndianMarketScanner() {
    const adapter = this.getFivePaisaAdapter();
    return adapter.fetchIndianUnderlyingsFrom5Paisa();
  }

  async getOptionsScanner(symbol: string = 'NIFTY'): Promise<{
    underlying: string;
    spot: number;
    bias: 'Bullish' | 'Bearish' | 'Range-bound';
    pcr: number;
    opportunities: OptionsOpportunityCandidate[];
    isBlank?: boolean;
    error?: string;
  }> {
    const clean = symbol.toUpperCase().replace(/\s+/g, '');
    const adapter = this.getFivePaisaAdapter();
    const [chain, underlyings] = await Promise.all([
      adapter.fetchOptionChainFrom5Paisa(clean),
      adapter.fetchIndianUnderlyingsFrom5Paisa()
    ]);
    const underlyingData = underlyings.find(u => u.symbol === clean);

    if (!underlyingData || !chain || chain.rows.length === 0 || chain.spotPrice <= 0) {
      return {
        underlying: clean,
        spot: 0,
        bias: 'Range-bound',
        pcr: 0,
        opportunities: [],
        isBlank: true,
        error: '5paisa LIVE option data is unavailable for this instrument.'
      };
    }

    const spot = chain.spotPrice;
    const atm = chain.atmStrike;
    const atmRow = chain.rows.find(r => r.strike === atm);
    const otmCallRow = chain.rows.find(r => r.distanceFromAtm === 1);
    const otmPutRow = chain.rows.find(r => r.distanceFromAtm === -1);

    const isBullish = underlyingData.vwapStatus === 'ABOVE_VWAP';
    const isBearish = underlyingData.vwapStatus === 'BELOW_VWAP';
    const bias = isBullish ? 'Bullish' : isBearish ? 'Bearish' : 'Range-bound';
    const liveScore = Number(underlyingData.signal?.score || 0);
    const liveProbability = underlyingData.signal?.mlProbability ?? null;
    const expiryMs = chain.expiry ? Date.parse(chain.expiry) : NaN;
    const daysLeft = Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : null;

    const opportunities: OptionsOpportunityCandidate[] = [];

    if (atmRow && otmCallRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'BULL_CALL_SPREAD',
        underlying: clean,
        spotPrice: spot,
        strike1: atm,
        premium1: atmRow.call.ltp,
        strike2: otmCallRow.strike,
        premium2: otmCallRow.call.ltp
      });
      opportunities.push({
        id: `opt_bcs_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'BULL_CALL_SPREAD',
        title: `${clean} ${atm} CE / ${otmCallRow.strike} CE Bull Call Spread`,
        bias: 'BULLISH',
        score: isBullish ? liveScore : Math.min(liveScore, 60),
        mlProbability: liveProbability,
        entryPremium: Math.max(0, atmRow.call.ltp - otmCallRow.call.ltp),
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: isBullish ? 'BULL_CALL_SPREAD' : 'NO_TRADE',
        reasons: isBullish
          ? [
              `Underlying live VWAP distance: ${underlyingData.vwapDistance}`,
              `Live put OI support: ${chain.putSupportStrike}`,
              'Defined-risk spread from live option quotes'
            ]
          : ['Live underlying bias is not bullish.'],
        invalidation: [
          `Spot breaks below live VWAP ${underlyingData.vwap.toFixed(1)}`,
          `Call OI resistance at live strike ${atm}`
        ],
        expiry: chain.expiry
      });
    }

    if (atmRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'LONG_CALL',
        underlying: clean,
        spotPrice: spot,
        strike1: atm,
        premium1: atmRow.call.ltp
      });
      const hasHighIV = atmRow.call.iv > 20;
      const expiryAvailable = daysLeft !== null;
      const favorable = isBullish && !hasHighIV && (!expiryAvailable || daysLeft > 2);
      opportunities.push({
        id: `opt_lc_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'LONG_CALL',
        title: `${clean} ${atm} CE Naked Long Call`,
        bias: 'BULLISH',
        score: favorable ? liveScore : Math.min(liveScore, 55),
        mlProbability: liveProbability,
        entryPremium: atmRow.call.ltp,
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: favorable ? 'LONG_CALL' : 'WAIT',
        reasons: favorable
          ? [`Live underlying is above VWAP; expiry remaining: ${daysLeft ?? 'unknown'} days`]
          : ['Live options inputs do not satisfy the long-call filters.'],
        invalidation: [
          `Spot falls below live VWAP ${underlyingData.vwap.toFixed(1)}`,
          'Live IV expands or market structure invalidates the setup'
        ],
        expiry: chain.expiry
      });
    }

    if (atmRow && otmPutRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'BEAR_PUT_SPREAD',
        underlying: clean,
        spotPrice: spot,
        strike1: otmPutRow.strike,
        premium1: otmPutRow.put.ltp,
        strike2: atm,
        premium2: atmRow.put.ltp
      });
      opportunities.push({
        id: `opt_bps_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'BEAR_PUT_SPREAD',
        title: `${clean} ${atm} PE / ${otmPutRow.strike} PE Bear Put Spread`,
        bias: 'BEARISH',
        score: isBearish ? liveScore : Math.min(liveScore, 55),
        mlProbability: liveProbability,
        entryPremium: Math.max(0, atmRow.put.ltp - otmPutRow.put.ltp),
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: isBearish ? 'BEAR_PUT_SPREAD' : 'NO_TRADE',
        reasons: isBearish
          ? [
              'Underlying live price is below VWAP',
              `Live call OI resistance: ${chain.callResistanceStrike}`
            ]
          : ['Live underlying bias is not bearish.'],
        invalidation: ['Spot crosses above live VWAP equilibrium'],
        expiry: chain.expiry
      });
    }

    if (otmPutRow) {
      const payoff = calculateStrategyPayoff({
        strategyType: 'LONG_PUT',
        underlying: clean,
        spotPrice: spot,
        strike1: otmPutRow.strike,
        premium1: otmPutRow.put.ltp
      });
      opportunities.push({
        id: `opt_lp_otm_${clean}`,
        underlying: clean,
        spot,
        strategyType: 'LONG_PUT',
        title: `${clean} ${otmPutRow.strike} PE Deep OTM Put`,
        bias: 'BEARISH',
        score: 0,
        mlProbability: liveProbability,
        entryPremium: otmPutRow.put.ltp,
        maxLoss: payoff.maxLoss,
        maxProfit: payoff.maxProfit,
        breakeven: payoff.breakeven,
        riskReward: payoff.riskRewardRatio,
        status: 'NO_TRADE',
        reasons: ['Live option-chain structure does not justify the deep-OTM long put.'],
        invalidation: ['Do not enter without a new live qualifying setup.'],
        expiry: chain.expiry
      });
    }

    return { underlying: clean, spot, bias, pcr: chain.pcr, opportunities };
  }

  async getAllSignals(): Promise<TradingSignal[]> {
    const [forex, india] = await Promise.all([
      this.getForexScanner(getSystemConfig().autoLiveForexPairs),
      this.getIndianMarketScanner()
    ]);
    return [
      ...forex.map(item => item.signal).filter(Boolean),
      ...india.map(item => item.signal).filter(Boolean)
    ];
  }
}
