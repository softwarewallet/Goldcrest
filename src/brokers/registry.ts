import {
  BrokerAdapter,
  BrokerType,
  TradingEnvironment,
  BrokerStatus,
  ConnectionTestResult,
  BrokerCredentialStatus
} from './types';
import { PaperBrokerAdapter } from './adapters/PaperBrokerAdapter';
import { CTraderDemoAdapter } from './adapters/cTrader/CTraderDemoAdapter';
import { CTraderLiveAdapter } from './adapters/cTrader/CTraderLiveAdapter';
import { FivePaisaDemoAdapter } from './adapters/fivepaisa/FivePaisaDemoAdapter';
import { FivePaisaLiveAdapter } from './adapters/fivepaisa/FivePaisaLiveAdapter';
import { BrokerError } from './errors';

export class BrokerRegistry {
  private activeEnvironment: TradingEnvironment = 'LIVE';
  private selectedBroker: BrokerType = 'CTRADER';

  private adapters: Map<string, BrokerAdapter> = new Map();
  private isInitialized: boolean = false;

  constructor() {
    // Lazy initialization breaks circular module dependency with adapters
  }

  private ensureInitialized(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    // 1. Paper Broker Adapter
    const paperAdapter = new PaperBrokerAdapter();
    this.adapters.set('PAPER_PAPER', paperAdapter);

    // 2. cTrader Adapters (Forex)
    const ctraderDemo = new CTraderDemoAdapter();
    const ctraderLive = new CTraderLiveAdapter();
    this.adapters.set('CTRADER_DEMO', ctraderDemo);
    this.adapters.set('CTRADER_LIVE', ctraderLive);

    // 3. 5paisa Adapters (Indian Equity / F&O / Options)
    const fivePaisaDemo = new FivePaisaDemoAdapter();
    const fivePaisaLive = new FivePaisaLiveAdapter();
    this.adapters.set('FIVE_PAISA_DEMO', fivePaisaDemo);
    this.adapters.set('FIVE_PAISA_LIVE', fivePaisaLive);
  }

  getEnvironment(): TradingEnvironment {
    return this.activeEnvironment;
  }

  setEnvironment(env: TradingEnvironment): void {
    this.activeEnvironment = env;
  }

  getSelectedBroker(): BrokerType {
    return this.selectedBroker;
  }

  setSelectedBroker(broker: BrokerType): void {
    this.selectedBroker = broker;
  }

  getAdapter(broker?: BrokerType, environment?: TradingEnvironment): BrokerAdapter {
    this.ensureInitialized();
    const targetBroker = broker || this.selectedBroker;
    const targetEnv = environment || this.activeEnvironment;

    if (targetBroker === 'PAPER' || targetEnv === 'PAPER') {
      const adapter = this.adapters.get('PAPER_PAPER');
      if (!adapter) throw new Error('Paper adapter not found');
      return adapter;
    }

    const key = `${targetBroker}_${targetEnv}`;
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new BrokerError(
        'UNKNOWN_ERROR',
        `No adapter registered for ${targetBroker} in ${targetEnv} environment`,
        targetBroker,
        targetEnv
      );
    }
    return adapter;
  }

  registerAdapter(broker: BrokerType, environment: TradingEnvironment, adapter: BrokerAdapter): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    this.adapters.set(key, adapter);
  }

  /**
   * Market Compatibility Check (Strict Routing Layer):
   * - cTrader -> FOREX only
   * - 5paisa -> INDIAN_EQUITY, INDIAN_FUTURES, INDIAN_OPTIONS only
   * - Paper -> All supported markets
   *
   * Forex + cTrader -> VALID
   * Indian Options + 5paisa -> VALID
   * Indian Futures + 5paisa -> VALID
   * Indian Equity + 5paisa -> VALID
   * Forex + 5paisa -> INVALID
   * Indian Options + cTrader -> INVALID
   */
  validateMarketCompatibility(market: string, broker: BrokerType): { compatible: boolean; reason?: string } {
    if (broker === 'PAPER') {
      return { compatible: true };
    }

    if (broker === 'CTRADER') {
      if (market === 'FOREX') {
        return { compatible: true };
      }
      return {
        compatible: false,
        reason: `cTrader broker only supports FOREX market. Cannot route ${market} to cTrader.`
      };
    }

    if (broker === 'FIVE_PAISA') {
      if (market === 'INDIAN_EQUITY' || market === 'INDIAN_OPTIONS' || market === 'INDIAN_FUTURES') {
        return { compatible: true };
      }
      return {
        compatible: false,
        reason: `5paisa broker only supports Indian markets (INDIAN_EQUITY, INDIAN_OPTIONS, INDIAN_FUTURES). Cannot route ${market} to 5paisa.`
      };
    }

    return { compatible: false, reason: `Unknown broker ${broker}` };
  }

  async testBrokerConnection(broker: BrokerType, environment: TradingEnvironment): Promise<ConnectionTestResult> {
    const adapter = this.getAdapter(broker, environment);
    return adapter.testConnection();
  }

  getCredentialStatuses(): BrokerCredentialStatus[] {
    this.ensureInitialized();
    const ctraderDemo = this.adapters.get('CTRADER_DEMO') as CTraderDemoAdapter;
    const ctraderLive = this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter;
    const fivePaisaDemo = this.adapters.get('FIVE_PAISA_DEMO') as FivePaisaDemoAdapter;
    const fivePaisaLive = this.adapters.get('FIVE_PAISA_LIVE') as FivePaisaLiveAdapter;

    const cDemoStatus = ctraderDemo.getConfigStatus();
    const cLiveStatus = ctraderLive.getConfigStatus();
    const fpDemoStatus = fivePaisaDemo.getConfigStatus();
    const fpLiveStatus = fivePaisaLive.getConfigStatus();

    return [
      {
        broker: 'PAPER',
        environment: 'PAPER',
        configured: true,
        maskedAccountId: 'PAPER-SIM-001',
        status: 'CONNECTED'
      },
      {
        broker: 'CTRADER',
        environment: 'DEMO',
        configured: cDemoStatus.configured,
        maskedAccountId: cDemoStatus.maskedAccountId,
        maskedClientId: cDemoStatus.maskedClientId,
        status: cDemoStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      },
      {
        broker: 'CTRADER',
        environment: 'LIVE',
        configured: cLiveStatus.configured,
        maskedAccountId: cLiveStatus.maskedAccountId,
        maskedClientId: cLiveStatus.maskedClientId,
        status: cLiveStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      },
      {
        broker: 'FIVE_PAISA',
        environment: 'DEMO',
        configured: fpDemoStatus.configured,
        maskedClientId: fpDemoStatus.maskedClientId,
        status: fpDemoStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      },
      {
        broker: 'FIVE_PAISA',
        environment: 'LIVE',
        configured: fpLiveStatus.configured,
        maskedClientId: fpLiveStatus.maskedClientId,
        status: fpLiveStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
      }
    ];
  }

  updateDemoCredentials(broker: BrokerType, creds: Record<string, any>): void {
    this.ensureInitialized();
    if (broker === 'CTRADER') {
      const adapter = this.adapters.get('CTRADER_DEMO') as CTraderDemoAdapter;
      adapter.updateCredentials(creds);
    } else if (broker === 'FIVE_PAISA') {
      const adapter = this.adapters.get('FIVE_PAISA_DEMO') as FivePaisaDemoAdapter;
      adapter.updateCredentials(creds);
    }
  }

  updateLiveCredentials(broker: BrokerType, creds: Record<string, any>): void {
    this.ensureInitialized();
    if (broker === 'CTRADER') {
      const adapter = this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter;
      adapter.updateCredentials(creds);
    } else if (broker === 'FIVE_PAISA') {
      const adapter = this.adapters.get('FIVE_PAISA_LIVE') as FivePaisaLiveAdapter;
      adapter.updateCredentials(creds);
    }
  }

  deleteCredentials(broker: BrokerType, environment: TradingEnvironment): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    const adapter = this.adapters.get(key) as any;
    if (adapter && typeof adapter.clearCredentials === 'function') {
      adapter.clearCredentials();
    }
  }
}

// Global broker registry singleton
export const brokerRegistry = new BrokerRegistry();

