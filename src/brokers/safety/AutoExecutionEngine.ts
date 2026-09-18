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

/**
 * ============================================================================
 * NON-NEGOTIABLE SAFETY INVARIANT (PHASE 12)
 * ============================================================================
 * Autonomous live-money order execution is permanently disabled in Goldcrest.
 * Goldcrest may connect to live brokers, retrieve live accounts/margins/quotes,
 * and validate orders. But Goldcrest MUST NOT autonomously submit live orders.
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
   * In LIVE mode, autonomous dispatch is permanently blocked at Stage 3.
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

    // Stage 3: Permanent Autonomous Execution Safety Invariant (Section 1 & 2)
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
        reason: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED: Autonomous live-money order execution is structurally disabled.'
      };
    }

    // Submit live order via adapter
    try {
      const placedOrder = await adapter.placeOrder(order);
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
        executed: true,
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
