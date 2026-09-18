import { FivePaisaBrokerAdapter } from './FivePaisaBrokerAdapter';
import { TradingEnvironment } from '../../types';
import { maskIdentifier } from '../../auditLog';
import { FivePaisaConfig } from './types';

export class FivePaisaDemoAdapter extends FivePaisaBrokerAdapter {
  readonly environment: TradingEnvironment = 'DEMO';
  readonly isLive: boolean = false;

  constructor(customConfig?: Partial<FivePaisaConfig>) {
    const config: FivePaisaConfig = {
      appName: customConfig?.appName || process.env.FIVEPAISA_DEMO_APP_NAME || process.env.FIVE_PAISA_DEMO_APP_NAME || '5paisaTradingBotDemo',
      appSource: customConfig?.appSource || process.env.FIVEPAISA_DEMO_APP_SOURCE || process.env.FIVE_PAISA_DEMO_APP_SOURCE || '1',
      userId: customConfig?.userId || process.env.FIVEPAISA_DEMO_USER_ID || process.env.FIVE_PAISA_DEMO_USER_ID || '5P_DEMO_UAT',
      password: customConfig?.password || process.env.FIVEPAISA_DEMO_PASSWORD || process.env.FIVE_PAISA_DEMO_PASSWORD || 'UatDemoPass@123',
      userKey: customConfig?.userKey || process.env.FIVEPAISA_DEMO_USER_KEY || process.env.FIVE_PAISA_DEMO_USER_KEY || '5P_UAT_KEY_848201',
      encryptionKey: customConfig?.encryptionKey || process.env.FIVEPAISA_DEMO_ENCRYPTION_KEY || process.env.FIVE_PAISA_DEMO_ENCRYPTION_KEY || '5P_UAT_ENC_KEY_9921',
      clientCode: customConfig?.clientCode || process.env.FIVEPAISA_DEMO_CLIENT_CODE || process.env.FIVE_PAISA_DEMO_CLIENT_CODE || '5P_DEMO_CLI',
      accessToken: customConfig?.accessToken || process.env.FIVEPAISA_DEMO_ACCESS_TOKEN || process.env.FIVE_PAISA_DEMO_ACCESS_TOKEN,
      totpSecret: customConfig?.totpSecret || process.env.FIVEPAISA_DEMO_TOTP_SECRET || process.env.FIVE_PAISA_DEMO_TOTP_SECRET,
      pin: customConfig?.pin || process.env.FIVEPAISA_DEMO_PIN || process.env.FIVE_PAISA_DEMO_PIN,
      environment: 'DEMO',
      apiHost: customConfig?.apiHost || 'https://dev-openapi.5paisa.com'
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

  updateCredentials(creds: Partial<FivePaisaConfig>): void {
    const cleanUpdates = Object.fromEntries(
      Object.entries(creds).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
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
      appName: undefined,
      appSource: '1',
      userId: undefined,
      password: undefined,
      userKey: undefined,
      encryptionKey: undefined,
      clientCode: undefined,
      environment: 'DEMO',
      apiHost: 'https://dev-openapi.5paisa.com'
    };
    this.status = 'DISCONNECTED';
  }
}
