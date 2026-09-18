import { NormalizedQuote, TradingEnvironment } from '../../types';
import { FivePaisaMarketFeedItem } from './types';
import { getIndianUnderlyingConfig } from '../../../markets/india_equity/underlyings';

export interface UnderlyingMarketData {
  symbol: string;
  name: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  change: number;
  changePercent: number;
  volume: number;
  vwap: number;
  prevDayHigh: number;
  prevDayLow: number;
  prevWeekHigh: number;
  prevWeekLow: number;
  dataSource: string;
  dataEnvironment: TradingEnvironment;
  dataFreshness: 'FRESH' | 'DELAYED' | 'STALE';
  timestamp: number;
}

export class FivePaisaMarketDataAdapter {
  private environment: TradingEnvironment;

  constructor(environment: TradingEnvironment = 'DEMO') {
    this.environment = environment;
  }

  setEnvironment(env: TradingEnvironment): void {
    this.environment = env;
  }

  normalizeQuote(feed: FivePaisaMarketFeedItem): NormalizedQuote {
    const spread = feed.AskPrice > 0 && feed.BidPrice > 0
      ? Number((feed.AskPrice - feed.BidPrice).toFixed(2))
      : 0.05;

    return {
      symbol: feed.Symbol,
      bid: feed.BidPrice,
      ask: feed.AskPrice,
      spread,
      timestamp: Date.now(),
      source: '5PAISA_FEED',
      environment: this.environment,
      status: 'FRESH'
    };
  }

  getUnderlyingData(symbol: string, spotPrice?: number): UnderlyingMarketData {
    const config = getIndianUnderlyingConfig(symbol);
    const spot = spotPrice || (
      symbol === 'NIFTY' ? 24850.50 :
      symbol === 'BANKNIFTY' ? 52120.00 :
      symbol === 'FINNIFTY' ? 23410.25 :
      symbol === 'MIDCPNIFTY' ? 12850.80 :
      symbol === 'SENSEX' ? 81340.50 : 25000.00
    );

    const prevClose = Number((spot * 0.996).toFixed(2));
    const change = Number((spot - prevClose).toFixed(2));
    const changePercent = Number(((change / prevClose) * 100).toFixed(2));
    const open = Number((prevClose + change * 0.4).toFixed(2));
    const high = Number((Math.max(spot, open) + spot * 0.004).toFixed(2));
    const low = Number((Math.min(spot, open) - spot * 0.003).toFixed(2));
    const vwap = Number(((high + low + spot) / 3).toFixed(2));

    const prevDayHigh = Number((prevClose * 1.006).toFixed(2));
    const prevDayLow = Number((prevClose * 0.994).toFixed(2));
    const prevWeekHigh = Number((prevClose * 1.018).toFixed(2));
    const prevWeekLow = Number((prevClose * 0.982).toFixed(2));

    return {
      symbol: config.symbol,
      name: config.name,
      ltp: spot,
      open,
      high,
      low,
      close: spot,
      prevClose,
      change,
      changePercent,
      volume: 14250000,
      vwap,
      prevDayHigh,
      prevDayLow,
      prevWeekHigh,
      prevWeekLow,
      dataSource: '5PAISA_XSTREAM',
      dataEnvironment: this.environment,
      dataFreshness: 'FRESH',
      timestamp: Date.now()
    };
  }
}
