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
      appName: customConfig?.appName || process.env.FIVEPAISA_LIVE_APP_NAME || process.env.FIVE_PAISA_LIVE_APP_NAME,
      appSource: customConfig?.appSource || process.env.FIVEPAISA_LIVE_APP_SOURCE || process.env.FIVE_PAISA_LIVE_APP_SOURCE || '1',
      userId: customConfig?.userId || process.env.FIVEPAISA_LIVE_USER_ID || process.env.FIVE_PAISA_LIVE_USER_ID,
      password: customConfig?.password || process.env.FIVEPAISA_LIVE_PASSWORD || process.env.FIVE_PAISA_LIVE_PASSWORD,
      userKey: customConfig?.userKey || process.env.FIVEPAISA_LIVE_USER_KEY || process.env.FIVE_PAISA_LIVE_USER_KEY,
      encryptionKey: customConfig?.encryptionKey || process.env.FIVEPAISA_LIVE_ENCRYPTION_KEY || process.env.FIVE_PAISA_LIVE_ENCRYPTION_KEY,
      clientCode: customConfig?.clientCode || process.env.FIVEPAISA_LIVE_CLIENT_CODE || process.env.FIVE_PAISA_LIVE_CLIENT_CODE,
      accessToken: customConfig?.accessToken || process.env.FIVEPAISA_LIVE_ACCESS_TOKEN || process.env.FIVE_PAISA_LIVE_ACCESS_TOKEN,
      totpSecret: customConfig?.totpSecret || process.env.FIVEPAISA_LIVE_TOTP_SECRET || process.env.FIVE_PAISA_LIVE_TOTP_SECRET,
      pin: customConfig?.pin || process.env.FIVEPAISA_LIVE_PIN || process.env.FIVE_PAISA_LIVE_PIN,
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
    const hasAccessToken = Boolean(this.config.accessToken && this.config.accessToken.trim() !== '');
    const hasTotpSecret = Boolean(this.config.totpSecret && this.config.totpSecret.trim() !== '');
    return {
      configured,
      hasAccessToken,
      hasTotpSecret,
      maskedClientId: maskIdentifier(this.config.clientCode || this.config.userId),
      maskedUserId: maskIdentifier(this.config.userId),
      maskedAppName: this.config.appName ? 'Saved: ' + this.config.appName : undefined,
      maskedAppSource: this.config.appSource ? 'Saved: ' + this.config.appSource : undefined,
      maskedPassword: this.config.password ? '•••••••• (Saved)' : undefined,
      maskedUserKey: this.config.userKey ? '•••••••• (Saved)' : undefined,
      maskedEncryptionKey: this.config.encryptionKey ? '•••••••• (Saved)' : undefined,
      maskedClientCode: this.config.clientCode ? maskIdentifier(this.config.clientCode) : undefined,
      maskedAccessToken: this.config.accessToken ? '•••••••• (Active Token)' : undefined,
      maskedTotpSecret: this.config.totpSecret ? '•••••••• (TOTP Configured)' : undefined,
      maskedPin: this.config.pin ? '•••• (PIN Configured)' : undefined
    };
  }

  override async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    throw new BrokerError(
      'AUTONOMOUS_LIVE_EXECUTION_DISABLED',
      'Autonomous live-money order submission is permanently disabled by system safety invariant LIVE_AUTO_EXECUTION_ALLOWED === false.',
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
