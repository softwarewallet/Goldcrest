import { FivePaisaBrokerAdapter } from './FivePaisaBrokerAdapter';
import { TradingEnvironment } from '../../types';
import { maskIdentifier } from '../../auditLog';
import { FivePaisaConfig } from './types';

export class FivePaisaDemoAdapter extends FivePaisaBrokerAdapter {
  readonly environment: TradingEnvironment = 'DEMO';
  readonly isLive: boolean = false;

  constructor(customConfig?: Partial<FivePaisaConfig>) {
    const config: FivePaisaConfig = {
      appName: customConfig?.appName || process.env.FIVE_PAISA_DEMO_APP_NAME || '5paisaTradingBotDemo',
      appSource: customConfig?.appSource || process.env.FIVE_PAISA_DEMO_APP_SOURCE || '1',
      userId: customConfig?.userId || process.env.FIVE_PAISA_DEMO_USER_ID || '5P_DEMO_UAT',
      password: customConfig?.password || process.env.FIVE_PAISA_DEMO_PASSWORD || 'UatDemoPass@123',
      userKey: customConfig?.userKey || process.env.FIVE_PAISA_DEMO_USER_KEY || '5P_UAT_KEY_848201',
      encryptionKey: customConfig?.encryptionKey || process.env.FIVE_PAISA_DEMO_ENCRYPTION_KEY || '5P_UAT_ENC_KEY_9921',
      clientCode: customConfig?.clientCode || process.env.FIVE_PAISA_DEMO_CLIENT_CODE || '5P_DEMO_CLI',
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
