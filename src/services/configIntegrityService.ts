import type { SystemConfig } from './configService';

export interface ConfigIntegrityResult {
  ok: boolean;
  checks: Record<string, 'PASS' | 'FAIL'>;
  failures: string[];
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function evaluateSystemConfigIntegrity(config: SystemConfig): ConfigIntegrityResult {
  const checks: Record<string, 'PASS' | 'FAIL'> = {};
  const failures: string[] = [];
  const check=(name:string, ok:boolean)=>{ checks[name]=ok?'PASS':'FAIL'; if(!ok) failures.push(name); };

  check('tradingMode', config.tradingMode === 'LIVE_ONLY');
  check('cTraderApiMode', config.cTraderApiMode === 'LIVE' || config.cTraderApiMode === 'DEMO');
  check('liveTradingEnabledType', typeof config.liveTradingEnabled === 'boolean');
  check('defaultRiskPct', positiveFinite(Number(config.defaultRiskPct)) && Number(config.defaultRiskPct) <= 100);
  check('maxDailyLossPct', positiveFinite(Number(config.maxDailyLossPct)) && Number(config.maxDailyLossPct) <= 100);
  check('maxOpenPositions', positiveInteger(Number(config.maxOpenPositions)));
  check('maxTradesPerDay', positiveInteger(Number(config.maxTradesPerDay)));
  check('maxConsecutiveLosses', positiveInteger(Number(config.maxConsecutiveLosses)));
  check('maxSpreadBps', nonNegativeFinite(Number(config.maxSpreadBps)));
  check('signalCooldownMs', positiveFinite(Number(config.signalCooldownMs)));
  check('eventProximityThresholdMinutes', nonNegativeFinite(Number(config.eventProximityThresholdMinutes)));
  check('strikeDepth', positiveInteger(Number(config.strikeDepth)));
  check('maxTradeValueForexUsd', positiveInteger(Number(config.maxTradeValueForexUsd)));
  check('maxTradeValueIndianInr', positiveInteger(Number(config.maxTradeValueIndianInr)));
  check('autoLiveMinSignalScore', nonNegativeFinite(Number(config.autoLiveMinSignalScore)) && Number(config.autoLiveMinSignalScore) <= 100);
  check('autoLiveMaxTradesPerPair', positiveInteger(Number(config.autoLiveMaxTradesPerPair)));
  check('forexStopLossPips', positiveFinite(Number(config.forexStopLossPips)));
  check('forexTakeProfitPips', positiveFinite(Number(config.forexTakeProfitPips)));
  check('autoLiveForexPairs', Array.isArray(config.autoLiveForexPairs) && config.autoLiveForexPairs.length > 0 && config.autoLiveForexPairs.every(pair => /^[A-Z]{3}\/[A-Z]{3}$/.test(String(pair))));
  check('autoLiveIndianUnderlyings', Array.isArray(config.autoLiveIndianUnderlyings) && config.autoLiveIndianUnderlyings.length > 0 && config.autoLiveIndianUnderlyings.every(symbol => /^[A-Z0-9._-]+$/.test(String(symbol))));
  check('financialDisclaimer', typeof config.financialDisclaimer === 'string' && config.financialDisclaimer.trim().length > 0);

  return { ok: failures.length===0, checks, failures };
}