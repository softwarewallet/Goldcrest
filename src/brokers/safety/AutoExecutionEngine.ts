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
export const LIVE_AUTO_EXECUTION_ALLOWED: boolean = false;

export interface ExecutionPermissionConfig {
  liveConnectionEnabled: boolean;
  liveTradingEnabled: boolean;
  autoExecutionEnabled: false; // Structurally locked to false
  autonomousLiveExecutionAllowed: false;
}

class AutoExecutionEngine {
  // Global controls: autoExecution is permanently locked to false
  private permissions: ExecutionPermissionConfig = {
    liveConnectionEnabled: true,
    liveTradingEnabled: false, // Connection capability only, NOT autonomous execution
    autoExecutionEnabled: false,
    autonomousLiveExecutionAllowed: false
  };

  getControls(): ExecutionPermissionConfig {
    return {
      ...this.permissions,
      autoExecutionEnabled: false,
      autonomousLiveExecutionAllowed: false
    };
  }

  /**
   * Updates operational controls. Note that autonomous live execution
   * CANNOT be enabled via any API, body flag, or state change.
   */
  updateControls(updates: Partial<ExecutionPermissionConfig>): ExecutionPermissionConfig {
    if ((updates as any).autoExecutionEnabled === true || (updates as any).autonomousLiveExecutionAllowed === true) {
      console.warn('[SECURITY] Attempt to enable autonomous live execution rejected. Invariant LIVE_AUTO_EXECUTION_ALLOWED === false.');
    }
    this.permissions = {
      ...this.permissions,
      liveConnectionEnabled: updates.liveConnectionEnabled !== undefined ? updates.liveConnectionEnabled : this.permissions.liveConnectionEnabled,
      liveTradingEnabled: updates.liveTradingEnabled !== undefined ? updates.liveTradingEnabled : this.permissions.liveTradingEnabled,
      autoExecutionEnabled: false, // Structurally immutable
      autonomousLiveExecutionAllowed: false // Structurally immutable
    };
    return this.getControls();
  }

  /**
   * Explicit attempt to enable automatic execution fails closed.
   */
  enableAutomaticExecution(): { success: boolean; code: string; message: string } {
    return {
      success: false,
      code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
      message: 'Autonomous live execution is permanently disabled by safety invariant LIVE_AUTO_EXECUTION_ALLOWED === false.'
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
    const broker = brokerRegistry.getSelectedBroker();
    const adapter = brokerRegistry.getAdapter(broker, env);

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

    // Fallback closed
    return {
      executed: false,
      code: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
      reason: 'AUTONOMOUS_LIVE_EXECUTION_DISABLED'
    };
  }
}

export const autoExecutionEngine = new AutoExecutionEngine();
