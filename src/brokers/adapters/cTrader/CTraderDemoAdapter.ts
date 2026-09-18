import { CTraderBrokerAdapter, CTraderConfig } from './CTraderBrokerAdapter';
import { TradingEnvironment } from '../../types';

export class CTraderDemoAdapter extends CTraderBrokerAdapter {
  readonly environment: TradingEnvironment = 'DEMO';
  readonly isLive: boolean = false;

  constructor(customConfig?: Partial<CTraderConfig>) {
    const config: CTraderConfig = {
      clientId: customConfig?.clientId ?? process.env.CTRADER_DEMO_CLIENT_ID,
      clientSecret: customConfig?.clientSecret ?? process.env.CTRADER_DEMO_CLIENT_SECRET,
      accessToken: customConfig?.accessToken ?? process.env.CTRADER_DEMO_ACCESS_TOKEN,
      accountId: customConfig?.accountId ?? process.env.CTRADER_DEMO_ACCOUNT_ID,
      environment: 'DEMO',
      apiHost: customConfig?.apiHost || 'https://demo.ctraderapi.com'
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
      environment: 'DEMO'
    };
    this.status = 'DISCONNECTED';
  }

  clearCredentials(): void {
    this.config = {
      clientId: undefined,
      clientSecret: undefined,
      accessToken: undefined,
      accountId: undefined,
      environment: 'DEMO',
      apiHost: 'https://demo.ctraderapi.com'
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
}
