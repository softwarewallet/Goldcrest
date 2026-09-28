export type MarketType = 'FOREX';

export type DataSourceStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNKNOWN';

export type TradingMode = 'LIVE';

export type SignalDirection = 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';

export type SignalCategory =
  | 'STRONG_BUY'
  | 'BUY'
  | 'WATCH_BUY'
  | 'NEUTRAL'
  | 'WATCH_SELL'
  | 'SELL'
  | 'STRONG_SELL'
  | 'WAIT'
  | 'NO_TRADE';

export type SignalStatus =
  | 'WAITING'
  | 'ENTRY_TRIGGERED'
  | 'ACTIVE'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'EXIT'
  | 'STOPPED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'INVALIDATED';


export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
  vwap?: number;
}

export interface MarketSessionInfo {
  sessionName: string;
  isOpen: boolean;
  timeRemainingMs?: number;
  nextSessionName?: string;
  isOverlapping?: boolean;
  statusText: string;
  currentIstTime?: string;
}

export interface ForexSessionState {
  sydney: boolean;
  tokyo: boolean;
  london: boolean;
  newYork: boolean;
  isLondonNyOverlap: boolean;
  activeSessions: string[];
}

export interface IndianSessionState {
  currentPhase: 'PRE_MARKET' | 'MARKET_OPEN' | 'REGULAR' | 'NEAR_CLOSE' | 'EXPIRY_SESSION' | 'CLOSED';
  isOpen: boolean;
  istTime: string;
  minutesToClose: number;
  isExpiryDay: boolean;
}

export interface TechnicalFeatures {
  ema9: number;
  ema21: number;
  ema50: number;
  ema100: number;
  ema200: number;
  sma50: number;
  sma200: number;
  rsi: number;
  macd: { macd: number; signal: number; hist: number };
  adx: { adx: number; plusDI: number; minusDI: number };
  atr: number;
  bollinger: { upper: number; middle: number; lower: number; percentB: number };
  vwap?: number;
}

export interface MarketStructure {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL_RANGE';
  structureType: 'HIGHER_HIGH' | 'HIGHER_LOW' | 'LOWER_HIGH' | 'LOWER_LOW' | 'CONSOLIDATION' | 'BREAKOUT' | 'BREAKDOWN';
  support: number;
  resistance: number;
  swingHigh: number;
  swingLow: number;
  liquidityZone?: { min: number; max: number; note: string };
}

export interface SignalScoreBreakdown {
  trend: number; // 0-15
  multiTimeframe: number; // 0-15
  momentum: number; // 0-10
  marketStructure: number; // 0-10
  supportResistance: number; // 0-10
  volumeOI: number; // 0-10
  mlProbability: number; // 0-15
  riskReward: number; // 0-10
  volatility: number; // 0-5
  totalScore: number; // 0-100
}

export interface TradingSignal {
  id: string;
  timestamp: number;
  market: MarketType;
  instrument: string;
  direction: SignalDirection;
  category: SignalCategory;
  strategy: string;
  score: number;
  scoreBreakdown: SignalScoreBreakdown;
  mlProbability: number; // 0.0 to 1.0 (calibrated estimate, not certainty)
  entryZone: { min: number; max: number; preferred: number };
  stopLoss: number;
  target1: number;
  target2: number;
  target3?: number;
  riskReward: number;
  status: SignalStatus;
  invalidationConditions: string[];
  reasons: string[];
  noTradeReasons?: string[];
  modelVersion: string;
}

export interface EconomicEvent {
  id: string;
  timestamp: number;
  currency: string;
  title: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  minutesUntil: number;
  blocksNewEntry: boolean;
}
