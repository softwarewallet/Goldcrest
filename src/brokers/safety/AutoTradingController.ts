import { executeQuery } from '../../database/db';
import { getSystemConfig } from '../../services/configService';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';

export type AutoTradingState = 'DISARMED' | 'ARMED' | 'BLOCKED';

export interface AutoTradingReadiness {
  state: AutoTradingState;
  ready: boolean;
  strategyReady: boolean;
  executionAvailable: false;
  reasons: string[];
  checks: Record<string, boolean>;
  metrics: { dailyRealizedPnl: number; dailyLossLimit: number; openPositions: number; maxOpenPositions: number; consecutiveLosses: number };
  config: { minSignalScore: number; minRiskReward: number; maxConsecutiveLosses: number; cooldownMs: number };
  timestamp: number;
}

/**
 * Auto-trading control plane. It deliberately does not enable autonomous
 * live-money execution; it provides explicit ARM/DISARM and pre-trade readiness.
 */
class AutoTradingController {
  private state: AutoTradingState = 'DISARMED';
  private readonly config = { minSignalScore: 70, minRiskReward: 1.5, maxConsecutiveLosses: 3, cooldownMs: 60_000 };

  getState(): AutoTradingState { return this.state; }

  disarm(): void { this.state = 'DISARMED'; }

  async evaluateReadiness(): Promise<AutoTradingReadiness> {
    const system = getSystemConfig();
    const reasons: string[] = [];
    const checks: Record<string, boolean> = {};
    checks.liveOnlyMode = system.tradingMode === 'LIVE_ONLY';
    checks.liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
    checks.killSwitchClear = !killSwitch.isHalted();

    const brokers = await Promise.all(brokerRegistry.getActiveLiveAdapters().map(async adapter => {
      try {
        const status = await adapter.getTradingStatus();
        return status === 'CONNECTED';
      } catch { return false; }
    }));
    checks.brokerConnected = brokers.some(Boolean);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = await executeQuery<any>(
      'SELECT COALESCE(SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END), 0) AS pnl FROM trades WHERE status = ? AND exit_time >= ?',
      ['CLOSED', startOfDay.getTime()]
    );
    const dailyRealizedPnl = Number(rows[0]?.pnl || 0);
    const dailyLossLimit = Math.abs(system.maxDailyLossPct);

    const lossRows = await executeQuery<any>(
      'SELECT pnl FROM trades WHERE status = ? AND pnl IS NOT NULL ORDER BY exit_time DESC LIMIT 50',
      ['CLOSED']
    );
    let consecutiveLosses = 0;
    for (const row of lossRows) {
      const pnl = Number(row.pnl);
      if (pnl < 0) consecutiveLosses += 1;
      else if (pnl > 0) break;
    }

    let openPositions = 0;
    for (const adapter of brokerRegistry.getActiveLiveAdapters()) {
      try { openPositions += (await adapter.getPositions()).length; }
      catch { checks.brokerPositionsReadable = false; }
    }
    if (checks.brokerPositionsReadable === undefined) checks.brokerPositionsReadable = true;

    const maxOpenPositions = system.maxOpenPositions;
    const dailyLossBreached = dailyRealizedPnl < 0 && Math.abs(dailyRealizedPnl) >= dailyLossLimit;
    checks.dailyLossLimitClear = !dailyLossBreached;
    checks.positionLimitClear = openPositions < maxOpenPositions;
    checks.consecutiveLossLimitClear = consecutiveLosses < this.config.maxConsecutiveLosses;

    // Current repository configuration explicitly reports the ML baseline as uncalibrated.
    const strategyCalibrated = !/UNCALIBRATED/i.test(system.modelStatus) && !/BASELINE/i.test(system.modelStatus);
    checks.strategyCalibrated = strategyCalibrated;

    if (!checks.liveOnlyMode) reasons.push('Trading mode is not LIVE_ONLY.');
    if (!checks.liveTradingEnabled) reasons.push('LIVE_TRADING_ENABLED is not true.');
    if (!checks.killSwitchClear) reasons.push('Emergency kill switch is active.');
    if (!checks.brokerConnected) reasons.push('No live broker is currently connected.');
    if (!checks.brokerPositionsReadable) reasons.push('Authoritative broker positions could not be read.');
    if (!checks.dailyLossLimitClear) reasons.push('Daily realized-loss limit has been breached.');
    if (!checks.positionLimitClear) reasons.push('Maximum open-position limit has been reached.');
    if (!checks.consecutiveLossLimitClear) reasons.push('Maximum consecutive-loss limit has been reached.');
    if (!checks.strategyCalibrated) reasons.push('Strategy/model is not calibrated for autonomous trading.');

    const strategyReady = strategyCalibrated && checks.brokerConnected && checks.brokerPositionsReadable && checks.liveOnlyMode;
    const ready = reasons.length === 0;
    if (this.state === 'ARMED' && !ready) this.state = 'BLOCKED';

    return {
      state: this.state, ready, strategyReady, executionAvailable: false, reasons, checks,
      metrics: { dailyRealizedPnl, dailyLossLimit, openPositions, maxOpenPositions, consecutiveLosses },
      config: { ...this.config }, timestamp: Date.now()
    };
  }

  async arm(): Promise<AutoTradingReadiness> {
    const readiness = await this.evaluateReadiness();
    if (!readiness.ready) { this.state = 'BLOCKED'; return { ...readiness, state: this.state }; }
    this.state = 'ARMED';
    return { ...readiness, state: this.state };
  }

  async authorizeSignal(signal: { signalTimestamp: number; score: number; riskReward: number; spread: number; spreadRatio?: number }): Promise<{ allowed: boolean; reasons: string[] }> {
    const readiness = await this.evaluateReadiness();
    const reasons = [...readiness.reasons];
    const ageMs = Date.now() - signal.signalTimestamp;
    if (this.state !== 'ARMED') reasons.push('Auto-trading control plane is not ARMED.');
    if (ageMs < 0 || ageMs > 300_000) reasons.push('Signal is stale or timestamp is invalid.');
    if (!Number.isFinite(signal.score) || signal.score < this.config.minSignalScore) reasons.push('Signal score is below ' + this.config.minSignalScore + '.');
    if (!Number.isFinite(signal.riskReward) || signal.riskReward < this.config.minRiskReward) reasons.push('Risk/reward is below ' + this.config.minRiskReward + '.');
    if (!Number.isFinite(signal.spread) || signal.spread < 0) reasons.push('Spread is invalid.');
    if (signal.spreadRatio !== undefined && (!Number.isFinite(signal.spreadRatio) || signal.spreadRatio > 0.0025)) reasons.push('Spread ratio exceeds the auto-trading safety threshold.');
    return { allowed: reasons.length === 0, reasons };
  }
}

export const autoTradingController = new AutoTradingController();