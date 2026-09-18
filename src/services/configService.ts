export interface SystemConfig {
  tradingMode: 'LIVE_ONLY';
  liveTradingEnabled: boolean;
  dataStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  modelStatus: string;
  researchStatus: 'CLOSED';
  selectedCtraderAccountId?: string;
  selectedCtraderAccountCurrency?: string;
  selectedCtraderAccountLabel?: string;
  defaultRiskPct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  eventProximityThresholdMinutes: number;
  strikeDepth: number;
  financialDisclaimer: string;
}

let activeConfig: SystemConfig = {
  tradingMode: 'LIVE_ONLY',
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
  dataStatus: 'UNAVAILABLE',
  modelStatus: 'ML BASELINE / UNCALIBRATED (PHASE 1)',
  researchStatus: 'CLOSED',
  defaultRiskPct: 1.0,
  maxDailyLossPct: 3.0,
  maxOpenPositions: 5,
  eventProximityThresholdMinutes: 20,
  strikeDepth: 7,
  financialDisclaimer:
    'Trading in Forex and derivatives involves substantial risk of loss. Model outputs, signals, probabilities and technical analysis are estimates for informational and analytical purposes only and are not financial advice, guarantees, or assurances of future performance.'
};

export function getSystemConfig(): SystemConfig {
  return { ...activeConfig };
}

export function updateSystemConfig(updates: Partial<SystemConfig>): SystemConfig {
  // LIVE_ONLY is the only supported user-facing trading mode.
  if (updates.tradingMode !== undefined && updates.tradingMode !== 'LIVE_ONLY') {
    throw new Error('Trading mode rejected: Goldcrest supports LIVE_ONLY mode only.');
  }

  activeConfig = {
    ...activeConfig,
    ...updates,
    tradingMode: 'LIVE_ONLY'
  };
  return { ...activeConfig };
}
