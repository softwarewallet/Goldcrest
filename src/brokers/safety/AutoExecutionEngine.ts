import {
  BrokerAdapter,
  NormalizedOrder,
  OrderRequest,
  TradingEnvironment
} from '../types';
import { BrokerError } from '../errors';
import { brokerRegistry } from '../registry';
import { killSwitch } from './KillSwitch';
import { tradeValidator, SignalValidationInput } from './TradeValidator';
import { liveTradingGate, LiveGateEvaluationParams } from './LiveTradingGate';
import { autoTradeReadinessService } from './AutoTradeReadiness';
import { logBrokerAction } from '../auditLog';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight } from '../../services/executionIntentService';
import { getSystemConfig, updateSystemConfig } from '../../services/configService';
import { liveRuntimeLog } from '../../services/liveRuntimeLog';

/**
 * Autonomous live execution is an explicit, server-side opt-in.
 * It remains disabled unless both auto-trading flags are enabled and the
 * configured strategy is calibrated/qualified.
 */
export let LIVE_AUTO_EXECUTION_ALLOWED: boolean = false;
let localExplicitAutoArm = false;

function isLocalDevelopment(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  // Goldcrest defaults to loopback when HOST is not explicitly configured.
  // Only an explicit non-loopback HOST disables local development controls.
  const host = String(process.env.HOST || '').trim().toLowerCase();
  return !host || ['127.0.0.1', 'localhost', '::1'].includes(host);
}

export function disarmLocalAutonomousExecution(): void {
  localExplicitAutoArm = false;
  if (isLocalDevelopment()) {
    process.env.LIVE_TRADING_ENABLED = 'false';
    process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'false';
    process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'false';
    process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'false';
    process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
    updateSystemConfig({ liveTradingEnabled: false });
  }
  syncAutonomousPermission();
}

function syncAutonomousPermission(): boolean {
  const config = getSystemConfig();
  const requestedByEnvironment = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true'
    && process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION === 'true';
  const requested = requestedByEnvironment || (isLocalDevelopment() && localExplicitAutoArm);
  const approvedStrategyId = String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim();
  const approvedByEnvironment = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true'
    && approvedStrategyId === 'fx_structure_v2a';
  const approved = approvedByEnvironment || (isLocalDevelopment() && localExplicitAutoArm);
  let ctraderConfigured = false;
  try {
    const status = brokerRegistry.getCredentialStatuses().find(
      item => item.broker === 'CTRADER' && item.environment === 'LIVE'
    );
    ctraderConfigured = Boolean(status?.configured);
  } catch {
    ctraderConfigured = false;
  }
  const allowed = requested
    && config.liveTradingEnabled
    && approved
    && ctraderConfigured
    && !killSwitch.isHalted();
  LIVE_AUTO_EXECUTION_ALLOWED = allowed;
  return allowed;
}

export function refreshAutonomousExecutionPermission(): boolean {
  return syncAutonomousPermission();
}

export interface ExecutionPermissionConfig {
  liveConnectionEnabled: boolean;
  liveTradingEnabled: boolean;
  autoExecutionEnabled: boolean;
  autonomousLiveExecutionAllowed: boolean;
}

class AutoExecutionEngine {
  private permissions: ExecutionPermissionConfig = {
    liveConnectionEnabled: true,
    liveTradingEnabled: true,
    autoExecutionEnabled: false,
    autonomousLiveExecutionAllowed: false
  };

  getControls(): ExecutionPermissionConfig {
    syncAutonomousPermission();
    return {
      ...this.permissions,
      autoExecutionEnabled: this.permissions.autoExecutionEnabled,
      autonomousLiveExecutionAllowed: this.permissions.autonomousLiveExecutionAllowed
    };
  }

  /**
   * Updates operational controls.
   */
  updateControls(updates: Partial<ExecutionPermissionConfig>): ExecutionPermissionConfig {
    this.permissions = {
      ...this.permissions,
      ...updates
    };
    if (updates.autonomousLiveExecutionAllowed !== undefined || updates.autoExecutionEnabled !== undefined) {
      syncAutonomousPermission();
      this.permissions.autoExecutionEnabled = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true';
      this.permissions.autonomousLiveExecutionAllowed = LIVE_AUTO_EXECUTION_ALLOWED;
    }
    return this.getControls();
  }

  enableAutomaticExecution(): { success: boolean; code: string; message: string } {
    const localDevelopment = isLocalDevelopment();
    if (localDevelopment) {
      localExplicitAutoArm = true;
      process.env.LIVE_TRADING_ENABLED = 'true';
      process.env.GOLDCREST_AUTO_TRADING_ENABLED = 'true';
      process.env.GOLDCREST_AUTONOMOUS_LIVE_EXECUTION = 'true';
      process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED = 'true';
      process.env.GOLDCREST_PRODUCTION_STRATEGY_ID = 'fx_structure_v2a';
      // configService snapshots LIVE_TRADING_ENABLED at module load, so an
      // explicit local arm must update the authoritative runtime config too.
      updateSystemConfig({ liveTradingEnabled: true });
    }

    const allowed = syncAutonomousPermission();

    this.permissions.autoExecutionEnabled = process.env.GOLDCREST_AUTO_TRADING_ENABLED === 'true';
    this.permissions.autonomousLiveExecutionAllowed = allowed;

    if (!allowed) {
      const blockers: string[] = [];
      const config = getSystemConfig();
      const ctraderConfigured = (() => {
        try {
          return Boolean(
            brokerRegistry.getCredentialStatuses().find(
              item => item.broker === 'CTRADER' && item.environment === 'LIVE'
            )?.configured
          );
        } catch {
          return false;
        }
      })();

      if (!this.permissions.autoExecutionEnabled) blockers.push('AUTO_TRADING_FLAGS');
      if (!config.liveTradingEnabled) blockers.push('LIVE_TRADING_ENABLED');
      const approvedStrategyId = String(process.env.GOLDCREST_PRODUCTION_STRATEGY_ID || 'fx_structure_v2a').trim();
      const strategyApproved = process.env.GOLDCREST_PRODUCTION_STRATEGY_APPROVED === 'true'
        && approvedStrategyId === 'fx_structure_v2a';
      if (!strategyApproved) blockers.push('PRODUCTION_STRATEGY_APPROVAL');
      if (!ctraderConfigured) blockers.push('CTRADER_LIVE_CREDENTIALS');
      if (killSwitch.isHalted()) blockers.push('KILL_SWITCH');

      const message = blockers.length
        ? `Autonomous live execution is blocked by: ${blockers.join(', ')}.`
        : 'Autonomous live execution is not currently permitted by the server safety gate.';

      liveRuntimeLog('WARN', 'AUTO_TRADING_ARM_BLOCKED', {
        code: 'AUTONOMOUS_LIVE_EXECUTION_NOT_READY',
        localDevelopment,
        blockers
      });

      return {
        success: false,
        code: 'AUTONOMOUS_LIVE_EXECUTION_NOT_READY',
        message
      };
    }

    return {
      success: true,
      code: 'AUTONOMOUS_LIVE_EXECUTION_ARMED',
      message: 'Autonomous live execution is armed behind the server-side readiness and broker safety gates.'
    };
  }

  /**
   * Signal-driven execution pipeline:
   * SignalEngine -> TradeValidator -> LiveTradingGate -> AutoTradeReadiness
   * -> immutable autonomous-live permission boundary -> idempotent execution.
   */
  async processSignal(
    signalInput: SignalValidationInput,
    order: OrderRequest,
    gateParams: Omit<LiveGateEvaluationParams, 'order'>
  ): Promise<{ executed: boolean; order?: NormalizedOrder; reason?: string; code?: string }> {
    const env = brokerRegistry.getEnvironment();
    const adapter = brokerRegistry.getAdapterForMarket(order.market);
    const broker = adapter.broker;

    // Stage 1: Kill Switch Check
    if (killSwitch.isHalted()) {
      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: 'Emergency Kill Switch is ACTIVE'
      });
      return { executed: false, reason: 'Emergency Kill Switch is ACTIVE', code: 'EMERGENCY_STOP_ACTIVE' };
    }

    // Stage 2: Trade Validator
    const instrument = await adapter.getInstrument(order.symbol);
    const valResult = tradeValidator.validateSignalAndOrder(signalInput, order, instrument);
    if (!valResult.valid) {
      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: valResult.rejectionReason,
        riskValidation: {
          passed: false,
          checks: valResult.checks,
          reason: valResult.rejectionReason
        }
      });
      return { executed: false, reason: valResult.rejectionReason, code: 'RISK_REJECTED' };
    }

    // Stage 3: Full live safety gate. This must execute immediately before dispatch.
    const gateResult = await liveTradingGate.evaluate(adapter, {
      ...gateParams,
      order
    });
    if (!gateResult.passed) {
      logBrokerAction({
        source: 'SAFETY_GATE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: gateResult.failedReasons.join(', '),
        riskValidation: { passed: false, checks: gateResult.checks, reason: gateResult.failedReasons.join(', ') }
      });
      return {
        executed: false,
        code: 'SAFETY_GATE_REJECTED',
        reason: gateResult.failedReasons.join(', ')
      };
    }

    // Stage 3B: Independent readiness gate. This re-checks live broker state,
    // daily loss, trade frequency, consecutive losses, spread, strategy
    // calibration and signal identity immediately before any autonomous path.
    const readiness = await autoTradeReadinessService.evaluate(
      adapter,
      order,
      signalInput.signalTimestamp
    );
    if (!readiness.ready) {
      logBrokerAction({
        source: 'AUTO_TRADE_READINESS',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        signalId: order.signalId,
        strategyId: order.strategyId,
        result: 'BLOCKED',
        error: readiness.failedReasons.join(', '),
        riskValidation: {
          passed: false,
          checks: readiness.checks,
          reason: readiness.failedReasons.join(', ')
        }
      });
      return {
        executed: false,
        code: 'AUTO_TRADE_NOT_READY',
        reason: readiness.failedReasons.join(', ')
      };
    }

    // Stage 4: Autonomous live execution permission boundary.
    // Permission is evaluated at the moment of dispatch and can never bypass
    // the readiness checks above.
    syncAutonomousPermission();
    if (!LIVE_AUTO_EXECUTION_ALLOWED) {
      logBrokerAction({
        source: 'SAFETY_GATE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'BLOCKED',
        error: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Signal validated for operator review only.'
      });
      return {
        executed: false,
        code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
        reason: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Autonomous live-money order execution is disabled by the current server control.'
      };
    }

    // Submit live order via an idempotent durable execution intent.
    try {
      const idempotencyKey = String(order.signalId || '').trim();
      if (!idempotencyKey) {
        return {
          executed: false,
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          reason: 'Autonomous signal execution requires a stable signalId for duplicate-order protection.'
        };
      }

      const intent = await claimExecutionIntent(idempotencyKey, {
        broker,
        market: order.market,
        symbol: order.symbol,
        side: order.side,
        payload: order
      });

      if (!intent.claimed) {
        return {
          executed: intent.existing?.state === 'COMPLETED',
          order: intent.existing?.result as NormalizedOrder | undefined,
          code: 'EXECUTION_INTENT_ALREADY_EXISTS',
          reason: 'This autonomous signal has already been submitted or is pending reconciliation.'
        };
      }

      const autonomousPlacer = (adapter as BrokerAdapter & {
        placeAutonomousOrder?: (request: OrderRequest) => Promise<NormalizedOrder>;
      }).placeAutonomousOrder;

      if (typeof autonomousPlacer !== 'function') {
        await failExecutionIntent(idempotencyKey, {
          status: 'REJECTED',
          rejectionReason: 'Broker adapter does not expose the guarded autonomous-order capability.'
        } as NormalizedOrder);
        return {
          executed: false,
          code: 'AUTONOMOUS_ORDER_PATH_UNAVAILABLE',
          reason: 'Broker adapter does not expose the guarded autonomous-order capability.'
        };
      }

      const placedOrder = await autonomousPlacer.call(adapter, order);

      if (placedOrder.status === 'FILLED') {
        await completeExecutionIntent(idempotencyKey, placedOrder);
      } else if (placedOrder.status === 'CANCELLED' || placedOrder.status === 'REJECTED' || placedOrder.status === 'EXPIRED') {
        await failExecutionIntent(idempotencyKey, placedOrder);
      } else {
        await markExecutionIntentInFlight(idempotencyKey, placedOrder);
      }

      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'SUCCESS',
        quantity: order.quantity
      });
      return {
        executed: placedOrder.status === 'FILLED',
        order: placedOrder
      };
    } catch (err: any) {
      logBrokerAction({
        source: 'EXECUTION_ENGINE',
        broker,
        environment: env,
        account: 'ACTIVE',
        action: 'EXECUTE_SIGNAL',
        symbol: order.symbol,
        result: 'FAILURE',
        error: err.message
      });
      return {
        executed: false,
        code: 'BROKER_SUBMISSION_FAILED',
        reason: `Broker Order Submission Failed: ${err.message}`
      };
    }
  }
}

export const autoExecutionEngine = new AutoExecutionEngine();
