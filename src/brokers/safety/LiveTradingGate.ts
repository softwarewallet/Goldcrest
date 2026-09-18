import { BrokerAdapter, LiveTradingGateResult, OrderRequest, NormalizedQuote } from '../types';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import { tradeValidator } from './TradeValidator';

export interface LiveGateEvaluationParams {
  order: OrderRequest;
  signalAgeMs: number;
  currentQuote: NormalizedQuote;
  isMarketOpen: boolean;
  dailyRealizedLoss: number;
  dailyLossLimit: number;
  totalAccountExposure: number;
  maxAllowedExposure: number;
  activePositionsCount: number;
  maxOpenPositions: number;
}

export class LiveTradingGate {
  /**
   * Evaluates all 15 safety criteria before ANY LIVE order can be dispatched.
   */
  async evaluate(adapter: BrokerAdapter, params: LiveGateEvaluationParams): Promise<LiveTradingGateResult> {
    const failedReasons: string[] = [];

    // Check 1: LIVE environment selected
    const liveEnvironmentSelected = adapter.environment === 'LIVE' && brokerRegistry.getEnvironment() === 'LIVE';
    if (!liveEnvironmentSelected) {
      failedReasons.push('Condition 1 Failed: Active environment is not LIVE.');
    }

    // Check 2: Live broker connected
    const status = await adapter.getTradingStatus();
    const liveBrokerConnected = status === 'CONNECTED';
    if (!liveBrokerConnected) {
      failedReasons.push(`Condition 2 Failed: Broker status is ${status}, must be CONNECTED.`);
    }

    // Check 3: Account successfully validated
    let accountValidated = false;
    let permissions: string[] = [];
    try {
      const account = await adapter.getAccount();
      accountValidated = Boolean(account && account.accountId && account.balance > 0);
      permissions = account.permissions || [];
    } catch {
      accountValidated = false;
    }
    if (!accountValidated) {
      failedReasons.push('Condition 3 Failed: Live account could not be validated or has non-positive balance.');
    }

    // Check 4: Trading permission confirmed
    const tradingPermissionConfirmed = permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES') || permissions.includes('NSE_FNO');
    if (!tradingPermissionConfirmed) {
      failedReasons.push('Condition 4 Failed: Account lacks confirmed broker trading permissions.');
    }

    // Check 5: Instrument validated
    const instrument = await adapter.getInstrument(params.order.symbol);
    const instrumentValidated = instrument !== null;
    if (!instrumentValidated) {
      failedReasons.push(`Condition 5 Failed: Instrument ${params.order.symbol} is not valid on this broker.`);
    }

    // Check 6: Market open
    const marketOpen = params.isMarketOpen && !killSwitch.isHalted();
    if (!marketOpen) {
      failedReasons.push('Condition 6 Failed: Market is currently closed or emergency halted.');
    }

    // Check 7: Market data fresh
    const marketDataFresh = params.currentQuote.status === 'FRESH' && (Date.now() - params.currentQuote.timestamp < 10000);
    if (!marketDataFresh) {
      failedReasons.push('Condition 7 Failed: Market data quote is stale or delayed (>10s old).');
    }

    // Check 8: Signal still valid (Max age: 5 min for Forex, 2 min for options)
    const maxAge = params.order.market === 'FOREX' ? 300000 : 120000;
    const signalStillValid = params.signalAgeMs >= 0 && params.signalAgeMs <= maxAge;
    if (!signalStillValid) {
      failedReasons.push(`Condition 8 Failed: Signal age (${Math.round(params.signalAgeMs / 1000)}s) exceeds max threshold (${maxAge / 1000}s).`);
    }

    // Check 9: Risk check passed (Stop loss exists & is valid)
    const riskCheckPassed = Boolean(params.order.stopLoss && params.order.stopLoss > 0);
    if (!riskCheckPassed) {
      failedReasons.push('Condition 9 Failed: Live order must strictly include a defined positive Stop Loss.');
    }

    // Check 10: Position-size check passed
    const positionSizeCheckPassed = params.order.quantity > 0 && (!instrument || params.order.quantity <= instrument.maxQuantity);
    if (!positionSizeCheckPassed) {
      failedReasons.push('Condition 10 Failed: Order quantity exceeds allowable broker limits.');
    }

    // Check 11: Daily loss limit not exceeded
    const dailyLossLimitNotExceeded = Math.abs(params.dailyRealizedLoss) < params.dailyLossLimit;
    if (!dailyLossLimitNotExceeded) {
      failedReasons.push('Condition 11 Failed: Daily loss limit breached.');
    }

    // Check 12: Maximum exposure not exceeded
    const maxExposureNotExceeded = params.totalAccountExposure < params.maxAllowedExposure;
    if (!maxExposureNotExceeded) {
      failedReasons.push('Condition 12 Failed: Maximum account exposure threshold exceeded.');
    }

    // Check 13: Duplicate-position check passed
    let duplicatePositionCheckPassed = true;
    try {
      const positions = await adapter.getPositions();
      const duplicate = positions.find(p => p.symbol === params.order.symbol && p.side === params.order.side);
      if (duplicate) {
        duplicatePositionCheckPassed = false;
        failedReasons.push(`Condition 13 Failed: Active live position already exists for ${params.order.symbol} (${params.order.side}).`);
      }
    } catch {
      duplicatePositionCheckPassed = false;
      failedReasons.push('Condition 13 Failed: Unable to verify existing positions.');
    }

    // Check 14: Order parameters validated
    const orderParametersValidated = Boolean(params.order.market && params.order.symbol && params.order.side && params.order.orderType);
    if (!orderParametersValidated) {
      failedReasons.push('Condition 14 Failed: Malformed order parameters.');
    }

    // Check 15: Explicit live-trading permission enabled in server env
    const explicitLivePermissionEnabled = process.env.LIVE_TRADING_ENABLED === 'true';
    if (!explicitLivePermissionEnabled) {
      failedReasons.push('Condition 15 Failed: LIVE_TRADING_ENABLED is not set to true in environment configuration.');
    }

    const passed = failedReasons.length === 0;

    return {
      passed,
      checks: {
        liveEnvironmentSelected,
        liveBrokerConnected,
        accountValidated,
        tradingPermissionConfirmed,
        instrumentValidated,
        marketOpen,
        marketDataFresh,
        signalStillValid,
        riskCheckPassed,
        positionSizeCheckPassed,
        dailyLossLimitNotExceeded,
        maxExposureNotExceeded,
        duplicatePositionCheckPassed,
        orderParametersValidated,
        explicitLivePermissionEnabled
      },
      failedReasons
    };
  }
}

export const liveTradingGate = new LiveTradingGate();
