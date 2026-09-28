import {
  BrokerAdapter,
  BrokerType,
  TradingEnvironment,
  ConnectionTestResult,
  BrokerCredentialStatus
} from './types';
import { CTraderLiveAdapter } from './adapters/cTrader/CTraderLiveAdapter';
import { BrokerError } from './errors';

export class BrokerRegistry {
  private activeEnvironment: TradingEnvironment = 'LIVE';
  // Broker selection is retained only for backwards compatibility. Market routing
  // is authoritative and automatically selects the compatible live broker.
  private selectedBroker: BrokerType = 'CTRADER';

  private adapters: Map<string, BrokerAdapter> = new Map();
  private isInitialized: boolean = false;

  constructor() {}

  private ensureInitialized(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    // LIVE_ONLY: only authoritative live broker adapters are registered.
    const ctraderLive = new CTraderLiveAdapter();
    this.adapters.set('CTRADER_LIVE', ctraderLive);
  }

  getEnvironment(): TradingEnvironment {
    return this.activeEnvironment;
  }

  setEnvironment(env: TradingEnvironment): void {
    if (env !== 'LIVE') {
      throw new Error('Goldcrest operates in LIVE_ONLY mode.');
    }
    this.activeEnvironment = 'LIVE';
  }

  getSelectedBroker(): BrokerType {
    return this.selectedBroker;
  }

  setSelectedBroker(broker: BrokerType): void {
    if (broker !== 'CTRADER') {
      throw new Error('Goldcrest Forex-only routing uses cTrader.');
    }
    this.selectedBroker = 'CTRADER';
  }

  getAdapter(broker?: BrokerType, environment?: TradingEnvironment): BrokerAdapter {
    this.ensureInitialized();
    const targetBroker = broker || this.selectedBroker;
    const targetEnv: TradingEnvironment = 'LIVE';

    if (environment !== undefined && environment !== 'LIVE') {
      throw new Error('Goldcrest operates in LIVE_ONLY mode.');
    }

    const key = `${targetBroker}_${targetEnv}`;
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new BrokerError(
        'UNKNOWN_ERROR',
        `No live adapter registered for ${targetBroker}`,
        targetBroker,
        'LIVE'
      );
    }
    return adapter;
  }

  /** Resolve the sole authoritative Forex broker route. */
  getAdapterForMarket(market: string): BrokerAdapter {
    this.ensureInitialized();
    if (market === 'FOREX') return this.getAdapter('CTRADER', 'LIVE');
    throw new BrokerError(
      'INVALID_SYMBOL',
      `Goldcrest supports FOREX only; market ${market} is not supported.`,
      'CTRADER',
      'LIVE'
    );
  }

  getActiveLiveAdapters(): BrokerAdapter[] {
    this.ensureInitialized();
    return [this.getAdapter('CTRADER', 'LIVE')];
  }

  registerAdapter(broker: BrokerType, environment: TradingEnvironment, adapter: BrokerAdapter): void {
    this.ensureInitialized();
    const key = `${broker}_${environment}`;
    this.adapters.set(key, adapter);
  }

  validateMarketCompatibility(market: string, broker: BrokerType): { compatible: boolean; reason?: string } {
    if (broker === 'CTRADER' && market === 'FOREX') return { compatible: true };
    return {
      compatible: false,
      reason: broker === 'CTRADER'
        ? `cTrader supports FOREX only; market ${market} is not supported.`
        : 'Only cTrader is supported by this Forex-only application.'
    };
  }

  async testBrokerConnection(broker: BrokerType, environment: TradingEnvironment): Promise<ConnectionTestResult> {
    const adapter = this.getAdapter(broker, environment);
    return adapter.testConnection();
  }

  getCredentialStatuses(): BrokerCredentialStatus[] {
    this.ensureInitialized();
    const ctraderLive = this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter;
    const cLiveStatus = ctraderLive.getConfigStatus();

    return [{
      broker: 'CTRADER',
      environment: 'LIVE',
      configured: cLiveStatus.configured,
      maskedAccountId: cLiveStatus.maskedAccountId,
      maskedClientId: cLiveStatus.maskedClientId,
      status: cLiveStatus.configured ? 'CONNECTED' : 'DISCONNECTED'
    }];
  }


  updateLiveCredentials(broker: BrokerType, creds: Record<string, any>): void {
    this.ensureInitialized();
    if (broker !== 'CTRADER') throw new Error('Only cTrader is supported by this Forex-only application.');
    (this.adapters.get('CTRADER_LIVE') as CTraderLiveAdapter).updateCredentials(creds);
  }

}

export const brokerRegistry = new BrokerRegistry();
