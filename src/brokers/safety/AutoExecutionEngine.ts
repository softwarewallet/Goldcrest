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
import { logBrokerAction } from '../auditLog';
import { claimExecutionIntent, completeExecutionIntent, failExecutionIntent, markExecutionIntentInFlight } from '../../services/executionIntentService';

/**
 * ============================================================================
 * NON-NEGOTIABLE SAFETY INVARIANT (PHASE 12)
 * ============================================================================
 * Autonomous live-money execution is explicitly enabled only after the full
 * server-side safety gate passes. Broker adapters must submit to authoritative
 * LIVE APIs and return broker-generated identifiers/statuses.
 */
export let LIVE_AUTO_EXECUTION_ALLOWED: boolean = true;

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
    autoExecutionEnabled: true,
    autonomousLiveExecutionAllowed: true
  };

  getControls(): ExecutionPermissionConfig {
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
    if (updates.autonomousLiveExecutionAllowed !== undefined) {
      LIVE_AUTO_EXECUTION_ALLOWED = updates.autonomousLiveExecutionAllowed;
    }
    return this.getControls();
  }

  enableAutomaticExecution(): { success: boolean; code: string; message: string } {
    this.permissions.autoExecutionEnabled = true;
    this.permissions.autonomousLiveExecutionAllowed = true;
    LIVE_AUTO_EXECUTION_ALLOWED = true;
    return {
      success: true,
      code: 'AUTONOMOUS_LIVE_EXECUTION_ENABLED',
      message: 'Autonomous live execution enabled.'
    };
  }

  /**
   * 5-Stage Execution Pipeline:
   * SignalEngine -> TradeValidator -> RiskEngine -> ExecutionPermission -> ExecutionEngine -> BrokerAdapter
   * In LIVE mode, dispatch is allowed only after the server-side validation gates pass.
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

    // Stage 4: Autonomous live execution permission boundary
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

      const placedOrder = await adapter.placeOrder(order);

      if (placedOrder.status === 'FILLED') {
        await completeExecutionIntent(idempotencyKey, placedOrder);
      } else if (placedOrder.status === 'CANCELLED' || placedOrder.status === 'REJECTED' || placedOrder.status === 'EXPIRED') {
        await failExecutionIntent(idempotencyKey, placedOrder);
      } else {
        // Broker acknowledgement is not proof of final execution. Persist the
        // accepted/partial state and let authoritative reconciliation determine
        // the terminal outcome.
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
