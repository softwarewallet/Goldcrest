import { FivePaisaBrokerAdapter } from './FivePaisaBrokerAdapter';
import { NormalizedOrder, OrderRequest, TradingEnvironment } from '../../types';
import { maskIdentifier } from '../../auditLog';
import { BrokerError } from '../../errors';
import { FivePaisaConfig } from './types';

export class FivePaisaLiveAdapter extends FivePaisaBrokerAdapter {
  readonly environment: TradingEnvironment = 'LIVE';
  readonly isLive: boolean = true;

  constructor(customConfig?: Partial<FivePaisaConfig>) {
    const config: FivePaisaConfig = {
      appName: customConfig?.appName || process.env.FIVE_PAISA_LIVE_APP_NAME,
      appSource: customConfig?.appSource || process.env.FIVE_PAISA_LIVE_APP_SOURCE || '1',
      userId: customConfig?.userId || process.env.FIVE_PAISA_LIVE_USER_ID,
      password: customConfig?.password || process.env.FIVE_PAISA_LIVE_PASSWORD,
      userKey: customConfig?.userKey || process.env.FIVE_PAISA_LIVE_USER_KEY,
      encryptionKey: customConfig?.encryptionKey || process.env.FIVE_PAISA_LIVE_ENCRYPTION_KEY,
      clientCode: customConfig?.clientCode || process.env.FIVE_PAISA_LIVE_CLIENT_CODE,
      environment: 'LIVE',
      apiHost: customConfig?.apiHost || 'https://Openapi.5paisa.com'
    };
    super(config);
  }

  getConfigStatus() {
    const configured = Boolean(
      this.config.appName &&
      this.config.userId &&
      this.config.userKey &&
      this.config.encryptionKey
    );
    return {
      configured,
      maskedClientId: maskIdentifier(this.config.clientCode || this.config.userId),
      maskedUserId: maskIdentifier(this.config.userId),
      maskedAppName: this.config.appName ? 'Saved: ' + this.config.appName : undefined,
      maskedAppSource: this.config.appSource ? 'Saved: ' + this.config.appSource : undefined,
      maskedPassword: this.config.password ? '•••••••• (Saved)' : undefined,
      maskedUserKey: this.config.userKey ? '•••••••• (Saved)' : undefined,
      maskedEncryptionKey: this.config.encryptionKey ? '•••••••• (Saved)' : undefined,
      maskedClientCode: this.config.clientCode ? maskIdentifier(this.config.clientCode) : undefined
    };
  }

  override async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    throw new BrokerError(
      'ORDER_REJECTED',
      'Direct LIVE order execution is NOT ALLOWED: Real-money automated trading is permanently locked in research/demo mode.',
      'FIVE_PAISA',
      'LIVE'
    );
  }

  updateCredentials(creds: Partial<FivePaisaConfig>): void {
    const cleanUpdates = Object.fromEntries(
      Object.entries(creds).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
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
      appName: undefined,
      appSource: '1',
      userId: undefined,
      password: undefined,
      userKey: undefined,
      encryptionKey: undefined,
      clientCode: undefined,
      environment: 'LIVE',
      apiHost: 'https://Openapi.5paisa.com'
    };
    this.status = 'DISCONNECTED';
  }
}
