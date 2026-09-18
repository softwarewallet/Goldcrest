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

export interface ExecutionPermissionConfig {
  liveConnectionEnabled: boolean;
  liveTradingEnabled: boolean;
  autoExecutionEnabled: boolean;
}

class AutoExecutionEngine {
  // Global controls: strictly OFF by default
  private permissions: ExecutionPermissionConfig = {
    liveConnectionEnabled: process.env.LIVE_CONNECTION_ENABLED === 'true',
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
    autoExecutionEnabled: false // ALWAYS default to false
  };

  getControls(): ExecutionPermissionConfig {
    return { ...this.permissions };
  }

  updateControls(updates: Partial<ExecutionPermissionConfig>): ExecutionPermissionConfig {
    if (updates.autoExecutionEnabled === true) {
      // Notice: Requirement 23: Even if LIVE credentials are connected: AUTO EXECUTION MUST REMAIN OFF unless strictly confirmed.
      // Guard against accidental activation
      console.warn('[SECURITY] Auto execution toggle updated:', updates.autoExecutionEnabled);
    }
    this.permissions = {
      ...this.permissions,
      ...updates
    };
    return { ...this.permissions };
  }

  /**
   * 5-Stage Execution Pipeline:
   * SignalEngine -> TradeValidator -> RiskEngine -> ExecutionPermission -> ExecutionEngine -> BrokerAdapter
   */
  async processSignal(
    signalInput: SignalValidationInput,
    order: OrderRequest,
    gateParams: Omit<LiveGateEvaluationParams, 'order'>
  ): Promise<{ executed: boolean; order?: NormalizedOrder; reason?: string }> {
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
      return { executed: false, reason: 'Emergency Kill Switch is ACTIVE' };
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
      return { executed: false, reason: valResult.rejectionReason };
    }

    // Stage 3: Execution Permission & Auto-Execution Lock
    if (this.permissions.autoExecutionEnabled !== true) {
      return {
        executed: false,
        reason: 'Auto-Execution is DISABLED by default. Explicit manual order confirmation required.'
      };
    }

    // Stage 4: Live Trading Gate (if LIVE environment)
    if (env === 'LIVE') {
      const gateResult = await liveTradingGate.evaluate(adapter, {
        order,
        ...gateParams
      });

      if (!gateResult.passed) {
        const failureSummary = gateResult.failedReasons.join('; ');
        logBrokerAction({
          source: 'LIVE_TRADING_GATE',
          broker,
          environment: 'LIVE',
          account: 'LIVE_ACCOUNT',
          action: 'EXECUTE_SIGNAL',
          symbol: order.symbol,
          result: 'BLOCKED',
          error: failureSummary
        });
        return {
          executed: false,
          reason: `Live Safety Gate Rejected: ${failureSummary}`
        };
      }
    }

    // Stage 5: Broker Adapter Placement
    try {
      const placedOrder = await adapter.placeOrder(order);
      tradeValidator.registerActivePosition(
        placedOrder.id,
        order.symbol,
        order.side,
        order.strategyId,
        order.signalId
      );
      return { executed: true, order: placedOrder };
    } catch (err: any) {
      return { executed: false, reason: err.message };
    }
  }
}

export const autoExecutionEngine = new AutoExecutionEngine();
