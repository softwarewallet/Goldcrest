import { logBrokerAction } from '../auditLog';
import { brokerRegistry } from '../registry';

class KillSwitchService {
  private isEmergencyHalted: boolean = false;
  private haltReason: string = '';
  private haltedAt: number = 0;

  isHalted(): boolean {
    return this.isEmergencyHalted;
  }

  getHaltDetails() {
    return {
      isHalted: this.isEmergencyHalted,
      reason: this.haltReason,
      haltedAt: this.haltedAt
    };
  }

  /**
   * Activates Emergency Stop:
   * - Prevents new automatic orders
   * - Cancels pending strategy orders where supported
   * - Continues monitoring positions
   * - Keeps existing positions open unless explicit emergency close is called
   */
  async triggerEmergencyHalt(reason: string = 'User initiated Emergency Stop'): Promise<{ cancelledCount: number }> {
    this.isEmergencyHalted = true;
    this.haltReason = reason;
    this.haltedAt = Date.now();

    logBrokerAction({
      source: 'KILL_SWITCH',
      broker: brokerRegistry.getSelectedBroker(),
      environment: brokerRegistry.getEnvironment(),
      account: 'ALL_ACCOUNTS',
      action: 'EMERGENCY_STOP_TRIGGERED',
      result: 'SUCCESS',
      error: reason
    });

    let cancelledCount = 0;
    try {
      const adapter = brokerRegistry.getAdapter();
      const openOrders = await adapter.getOpenOrders();
      for (const ord of openOrders) {
        if (ord.status === 'PENDING' || ord.status === 'ACCEPTED') {
          await adapter.cancelOrder(ord.id);
          cancelledCount++;
        }
      }
    } catch (err) {
      console.error('Error cancelling orders during emergency stop:', err);
    }

    return { cancelledCount };
  }

  resumeTrading(): void {
    this.isEmergencyHalted = false;
    this.haltReason = '';
    this.haltedAt = 0;

    logBrokerAction({
      source: 'KILL_SWITCH',
      broker: brokerRegistry.getSelectedBroker(),
      environment: brokerRegistry.getEnvironment(),
      account: 'ALL_ACCOUNTS',
      action: 'TRADING_RESUMED',
      result: 'SUCCESS'
    });
  }
}

export const killSwitch = new KillSwitchService();
