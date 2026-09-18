import { CTraderBrokerAdapter, CTraderConfig } from './CTraderBrokerAdapter';
import { NormalizedOrder, OrderRequest, TradingEnvironment } from '../../types';
import { BrokerError } from '../../errors';

export class CTraderLiveAdapter extends CTraderBrokerAdapter {
  readonly environment: TradingEnvironment = 'LIVE';
  readonly isLive: boolean = true;

  constructor(customConfig?: Partial<CTraderConfig>) {
    const config: CTraderConfig = {
      clientId: customConfig?.clientId ?? process.env.CTRADER_LIVE_CLIENT_ID,
      clientSecret: customConfig?.clientSecret ?? process.env.CTRADER_LIVE_CLIENT_SECRET,
      accessToken: customConfig?.accessToken ?? process.env.CTRADER_LIVE_ACCESS_TOKEN,
      accountId: customConfig?.accountId ?? process.env.CTRADER_LIVE_ACCOUNT_ID,
      environment: 'LIVE',
      apiHost: customConfig?.apiHost || 'https://live.ctraderapi.com'
    };
    super(config);
  }

  updateCredentials(credentials: Partial<CTraderConfig>): void {
    const cleanUpdates = Object.fromEntries(
      Object.entries(credentials).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    );
    this.config = {
      ...this.config,
      ...cleanUpdates,
      environment: 'LIVE'
    };
    this.status = 'DISCONNECTED';
  }

  clearCredentials(): void {
    this.config = {
      clientId: undefined,
      clientSecret: undefined,
      accessToken: undefined,
      accountId: undefined,
      environment: 'LIVE',
      apiHost: 'https://live.ctraderapi.com'
    };
    this.status = 'DISCONNECTED';
  }

  getConfigStatus() {
    return {
      configured: Boolean(
        this.config.clientId &&
        this.config.clientSecret &&
        this.config.accessToken &&
        this.config.accountId
      ),
      maskedAccountId: this.config.accountId ? '****' + this.config.accountId.slice(-4) : undefined,
      maskedClientId: this.config.clientId ? '****' + this.config.clientId.slice(-4) : undefined,
      maskedClientSecret: this.config.clientSecret ? '•••••••• (Saved)' : undefined,
      maskedAccessToken: this.config.accessToken ? '•••••••• (Saved)' : undefined
    };
  }

  // Strictly override placeOrder to ensure live guard
  override async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    throw new BrokerError(
      'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
      'Autonomous live-money order submission is permanently disabled by system safety invariant LIVE_AUTO_EXECUTION_ALLOWED === false.',
      'CTRADER',
      'LIVE'
    );
  }
}
