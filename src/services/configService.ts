export interface SystemConfig {
  tradingMode: 'LIVE_ONLY'; // PAPER and DEMO removed as selectable user modes
  liveTradingEnabled: boolean; // This remains the global safety/disarm mechanism
  dataStatus: 'DEMO' | 'LIVE' | 'DELAYED';
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
  dataStatus: 'DEMO',
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
  // Safety rule: Never enable LIVE trading unless explicitly configured in environment
  if (updates.tradingMode === 'LIVE' && !activeConfig.liveTradingEnabled) {
    throw new Error('Live trading gate rejected: LIVE_TRADING_ENABLED environment variable is not true.');
  }

  activeConfig = {
    ...activeConfig,
    ...updates
  };
  return { ...activeConfig };
}
