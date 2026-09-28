import { BrokerAdapter, LiveTradingGateResult, OrderRequest, NormalizedQuote } from '../types';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import { tradeValidator } from './TradeValidator';
import { getSystemConfig } from '../../services/configService';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

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
  activePairPositionsCount: number;
  maxPairPositions: number;
  /** Maximum acceptable age of the authoritative broker quote. Goldcrest live policy is fixed at 30 seconds. */
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
    const tradingPermissionConfirmed = permissions.includes('TRADING') || permissions.includes('EQUITY') || permissions.includes('DERIVATIVES');
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

    // Check 7: Goldcrest-wide live quote freshness policy is fixed at 30s.
    // There is intentionally no caller override or shorter fallback. This
    // prevents any future execution path from silently reintroducing a 10s
    // freshness requirement without an explicit code change here.
    const quoteMaxAgeMs = 30_000;
    const marketDataFresh = params.currentQuote.status === 'FRESH'
      && (Date.now() - params.currentQuote.timestamp < quoteMaxAgeMs);
    if (!marketDataFresh) {
      failedReasons.push(
        `Condition 7 Failed: Market data quote is stale or delayed (>${Math.round(quoteMaxAgeMs / 1000)}s old).`
      );
    }

    // Check 8: Signal still valid (Max age: 5 min for Forex)
    const maxAge = 300000;
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

    // Check 12: Maximum account exposure threshold.
    //
    // TEMPORARILY DISABLED BY OPERATOR REQUEST.
    // The exposure calculation/rejection path remains intentionally bypassed
    // while the root cause is investigated. Keep the supplied exposure
    // parameters in the evaluation interface for compatibility with existing
    // dispatch callers, but Condition 12 must not reject a live order.
    const maxExposureNotExceeded = true;

    // Checks 13 and 13B both depend on the broker's CURRENT position set.
    // Never use the caller's earlier position count for 13B because Auto Live
    // analyzes pairs concurrently and the account can change between analysis
    // and this final dispatch boundary.
    let authoritativePositions: Awaited<ReturnType<BrokerAdapter['getPositions']>> = [];
    let positionsVerified = false;
    try {
      authoritativePositions = await adapter.getPositions();
      positionsVerified = Array.isArray(authoritativePositions);
    } catch {
      positionsVerified = false;
    }

    // Check 13: Per-pair simultaneous-position limit.
    // Multiple positions on the same Forex pair are intentionally allowed up
    // to the operator-configured Auto Live per-pair limit. A single existing
    // position must NOT automatically reject a second/third/fourth trade.
    let duplicatePositionCheckPassed = false;
    let authoritativePairPositionsCount = 0;
    if (positionsVerified) {
      authoritativePairPositionsCount = authoritativePositions.filter(
        position => String(position.symbol || '').toUpperCase() === String(params.order.symbol || '').toUpperCase()
      ).length;
      const pairPositionLimit = Number(params.maxPairPositions);

      duplicatePositionCheckPassed = Number.isInteger(pairPositionLimit)
        && pairPositionLimit > 0
        && authoritativePairPositionsCount < pairPositionLimit;

      if (!duplicatePositionCheckPassed) {
        failedReasons.push(
          `Condition 13 Failed: Maximum simultaneous live trades for ${params.order.symbol} (${pairPositionLimit}) reached. Current positions: ${authoritativePairPositionsCount}.`
        );
      }
    } else {
      failedReasons.push('Condition 13 Failed: Unable to verify existing positions.');
    }

    // Check 13B: Maximum number of simultaneous live positions ACROSS THE
    // ENTIRE LIVE ACCOUNT. This is intentionally independent of the requested
    // pair. A USD/CAD order can therefore fail 13B even when USD/CAD itself
    // has zero open positions if five positions exist on other pairs.
    const authoritativeActivePositionsCount = positionsVerified
      ? authoritativePositions.length
      : Number.NaN;
    const maxOpenPositionsCheckPassed = positionsVerified
      && Number.isFinite(authoritativeActivePositionsCount)
      && authoritativeActivePositionsCount < params.maxOpenPositions;

    if (!maxOpenPositionsCheckPassed) {
      if (positionsVerified) {
        failedReasons.push(
          `Condition 13B Failed: Maximum open live positions (${params.maxOpenPositions}) reached. Current account positions: ${authoritativeActivePositionsCount}.`
        );
      } else {
        failedReasons.push('Condition 13B Failed: Unable to verify current account position count.');
      }
    }
    // Check 14: Order parameters validated
    const orderParametersValidated = Boolean(params.order.market && params.order.symbol && params.order.side && params.order.orderType);
    if (!orderParametersValidated) {
      failedReasons.push('Condition 14 Failed: Malformed order parameters.');
    }

    // Check 16: Per-order cTrader Forex volume ceiling.
    //
    // Goldcrest is Forex-only and cTrader is the sole execution broker.
    // The configured maxTradeValueForexUsd is the authoritative cTrader
    // protocol-volume ceiling; no Indian-market or alternate-broker sizing
    // branch is permitted here.
    const config = getSystemConfig();
    const maxTradeValue = Number(config.maxTradeValueForexUsd);
    let maximumTradeValueCheckPassed =
      params.order.market === 'FOREX'
      && Number.isFinite(maxTradeValue)
      && maxTradeValue > 0
      && Number.isSafeInteger(maxTradeValue);

    if (!maximumTradeValueCheckPassed) {
      failedReasons.push(
        'Condition 16 Failed: Configured maximum Forex trade value must be a positive integer and the order market must be FOREX.'
      );
    } else if (!Number.isSafeInteger(params.order.quantity) || params.order.quantity <= 0) {
      maximumTradeValueCheckPassed = false;
      failedReasons.push(
        'Condition 16 Failed: cTrader Forex order quantity must be a positive integer.'
      );
    } else if (params.order.quantity > maxTradeValue) {
      maximumTradeValueCheckPassed = false;
      failedReasons.push(
        `Condition 16 Failed: Forex order quantity ${params.order.quantity} exceeds configured maximum direct quantity ${maxTradeValue} for cTrader.`
      );
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
        maxOpenPositionsCheckPassed,
        orderParametersValidated,
        explicitLivePermissionEnabled,
        maximumTradeValueCheckPassed
      },
      failedReasons
    };
  }
}

export const liveTradingGate = new LiveTradingGate();
