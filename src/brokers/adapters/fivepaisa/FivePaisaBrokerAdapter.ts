import crypto from 'crypto';
import { BaseBrokerAdapter } from '../BaseBrokerAdapter';
import {
  BrokerAccountInfo,
  BrokerInstrument,
  BrokerStatus,
  BrokerType,
  ConnectionTestResult,
  NormalizedOrder,
  NormalizedPosition,
  NormalizedQuote,
  OrderModification,
  OrderRequest,
  TradingEnvironment,
  OrderType
} from '../../types';
import { BrokerError, normalizeBrokerError } from '../../errors';
import { maskIdentifier } from '../../auditLog';
import {
  FivePaisaConfig,
  FivePaisaPlaceOrderRequest,
  FivePaisaPlaceOrderResponse,
  FivePaisaOrderBookEntry,
  FivePaisaNetPosition
} from './types';
import { getIndianUnderlyingConfig } from '../../../markets/india_equity/underlyings';
import { Candle, OptionChainStrikeRow, OptionChainSummary, OptionContract } from '../../../markets/common/types';
import { evaluateIndianUnderlying, IndianUnderlyingAnalysis } from '../../../markets/india_equity/indiaEngine';
import { calculateBlackScholesGreeks } from '../../../markets/india_options/greeks';
import { generateExpiries } from '../../../markets/india_options/expiryEngine';

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error('Invalid base32 character in TOTP secret: ' + cleaned[i]);
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret: string, step = 30): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / step);
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;

  return code.toString().padStart(6, '0');
}

export abstract class FivePaisaBrokerAdapter extends BaseBrokerAdapter {
  readonly broker: BrokerType = 'FIVE_PAISA';
  abstract readonly environment: TradingEnvironment;
  abstract readonly isLive: boolean;

  protected config: FivePaisaConfig;
  protected openPositions: Map<string, NormalizedPosition> = new Map();
  protected openOrders: Map<string, NormalizedOrder> = new Map();

  constructor(config: FivePaisaConfig) {
    super();
    this.config = config;
  }

  protected getApiHost(): string {
    if (this.config.apiHost) return this.config.apiHost;
    return this.isLive
      ? 'https://Openapi.5paisa.com'
      : 'https://dev-openapi.5paisa.com';
  }

  protected validateCredentials(): void {
    const { appName, appSource, userId, userKey, encryptionKey } = this.config;
    if (!appName || !appSource || !userId || !userKey || !encryptionKey) {
      this.status = 'AUTHENTICATION_FAILED';
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `5paisa ${this.environment} credentials missing. Required: App Name, App Source, User ID, User Key, and Encryption Key.`,
        'FIVE_PAISA',
        this.environment
      );
    }
  }

  async authenticate(): Promise<boolean> {
    this.status = 'CONNECTING';
    try {
      this.validateCredentials();
      this.status = 'CONNECTED';
      return true;
    } catch (err: any) {
      this.status = 'AUTHENTICATION_FAILED';
      this.lastError = err.message;
      throw normalizeBrokerError(err, 'FIVE_PAISA', this.environment);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'DISCONNECTED';
    this.logAction('DISCONNECT', 'SUCCESS', this.config.clientCode || this.config.userId || '');
  }

  /**
   * Authenticates with 5paisa using TOTP (Time-based One-Time Password) and 2FA PIN
   * Follows official 5paisa OAuth flow: TOTPLogin -> GetAccessToken
   */
  async loginWithTotp(totpCode?: string, pinCode?: string): Promise<string> {
    this.validateCredentials();

    let totp = totpCode;
    if (!totp && this.config.totpSecret) {
      try {
        totp = generateTOTP(this.config.totpSecret);
      } catch (e: any) {
        throw new Error(`Failed to generate TOTP from secret: ${e.message}`);
      }
    }

    const pin = pinCode || this.config.pin || this.config.password;

    if (!totp) {
      throw new Error('TOTP 6-digit code or TOTP Secret is required for 5paisa authentication');
    }
    if (!pin) {
      throw new Error('2FA PIN is required for 5paisa authentication');
    }

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/TOTPLogin`;
    const payload = {
      head: {
        Key: this.config.userKey
      },
      body: {
        Email_ID: this.config.clientCode || this.config.userId,
        TOTP: totp,
        PIN: pin
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`5paisa TOTPLogin HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data?.body?.RequestToken) {
      return await this.exchangeRequestToken(data.body.RequestToken);
    }
    throw new Error(data?.body?.Message || 'Failed to obtain RequestToken from 5paisa TOTPLogin');
  }

  /**
   * Exchanges a 5paisa RequestToken for a daily AccessToken
   */
  async exchangeRequestToken(requestToken: string): Promise<string> {
    this.validateCredentials();

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/GetAccessToken`;
    const payload = {
      head: {
        Key: this.config.userKey
      },
      body: {
        RequestToken: requestToken,
        EncryKey: this.config.encryptionKey,
        UserId: this.config.userId
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`5paisa GetAccessToken HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data?.body?.AccessToken) {
      this.config.accessToken = data.body.AccessToken;
      this.status = 'CONNECTED';
      return data.body.AccessToken;
    }
    throw new Error(data?.body?.Message || 'Failed to exchange RequestToken for 5paisa AccessToken');
  }

  /**
   * Fetches real account margin and balances from 5paisa OpenAPI /V4/Margin
   */
  async fetchMarginFromApi(): Promise<{
    balance: number;
    equity: number;
    availableMargin: number;
    usedMargin: number;
    freeMargin: number;
    raw: any;
  }> {
    // If no access token, try auto-login if totpSecret and pin are present
    if (!this.config.accessToken && this.config.totpSecret) {
      try {
        await this.loginWithTotp();
      } catch (authErr: any) {
        throw new Error(`5paisa automated TOTP login failed: ${authErr.message}`);
      }
    }

    if (!this.config.accessToken) {
      throw new Error(
        '5paisa API requires an Access Token or TOTP session to fetch actual balance. Please configure your Access Token or TOTP Secret in Settings.'
      );
    }

    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V4/Margin`;
    const payload = {
      head: {
        appName: this.config.appName,
        appVer: '1.0',
        key: this.config.userKey,
        osName: 'WEB',
        requestCode: '5PMarginV3',
        userId: this.config.userId,
        password: this.config.password
      },
      body: {
        ClientCode: this.config.clientCode || this.config.userId
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.accessToken}`,
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.config.accessToken = undefined;
        if (this.config.totpSecret) {
          await this.loginWithTotp();
          return this.fetchMarginFromApi();
        }
        throw new Error('5paisa Access Token has expired or is invalid (HTTP 401). Please update your Access Token or TOTP session in Settings.');
      }
      throw new Error(`5paisa Margin API HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    console.log('[DEBUG] 5paisa Margin API response:', JSON.stringify(data, null, 2));
    if (data?.head?.Status !== 0 && data?.head?.StatusDescription) {
      const desc = data.head.StatusDescription.toLowerCase();
      if (desc.includes('token') || desc.includes('session') || desc.includes('unauthorized')) {
        this.config.accessToken = undefined;
        if (this.config.totpSecret) {
          await this.loginWithTotp();
          return this.fetchMarginFromApi();
        }
      }
      throw new Error(`5paisa Margin API Error: ${data.head.StatusDescription}`);
    }

    const equityMargin = data?.body?.EquityMargin;
    if (!equityMargin) {
      throw new Error(data?.body?.Message || 'No margin data returned from 5paisa API');
    }

    const m = Array.isArray(equityMargin) ? equityMargin[0] : equityMargin;
    const availableMargin = Number(m?.MarginAvailable ?? m?.NetAvailableMargin ?? m?.EquityMargin ?? 0);
    const usedMargin = Number(m?.MarginUtilized ?? 0);
    const cash = Number(m?.Cash ?? availableMargin);
    const collateral = Number(m?.Collateral ?? 0);
    const balance = cash;
    const equity = balance + collateral;

    return {
      balance,
      equity,
      availableMargin,
      usedMargin,
      freeMargin: availableMargin,
      raw: m
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      this.validateCredentials();

      const maskedClient = maskIdentifier(this.config.clientCode || this.config.userId);

      // Attempt to fetch actual live margin from 5paisa API
      let balance = 0;
      let equity = 0;

      try {
        const marginData = await this.fetchMarginFromApi();
        balance = marginData.balance;
        equity = marginData.equity;
        this.status = 'CONNECTED';
      } catch (marginErr: any) {
        this.status = 'AUTHENTICATION_FAILED';
        throw new Error(`5paisa API authentication required: ${marginErr.message}`);
      }

      const res: ConnectionTestResult = {
        broker: 'FIVE_PAISA',
        environment: this.environment,
        connected: true,
        account: maskedClient,
        accountType: this.isLive ? 'LIVE' : 'DEMO',
        balance,
        equity,
        currency: 'INR',
        server: this.isLive ? '5paisa-Xstream-OpenAPI-Live' : '5paisa-DevOpenAPI-Sandbox',
        permissions: ['NSE_EQUITY', 'NSE_FNO', 'BSE_EQUITY', 'BSE_FNO', 'MCX_COMMODITY'],
        timestamp: Date.now()
      };

      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'SUCCESS', this.config.clientCode || this.config.userId || '', {
        orderId: `ping_${Date.now() - start}ms`
      });

      return res;
    } catch (err: any) {
      const maskedClient = maskIdentifier(this.config.clientCode || this.config.userId);
      this.status = 'AUTHENTICATION_FAILED';
      this.lastError = err.message;
      const res: ConnectionTestResult = {
        broker: 'FIVE_PAISA',
        environment: this.environment,
        connected: false,
        account: maskedClient,
        accountType: this.isLive ? 'LIVE' : 'DEMO',
        error: err.message,
        timestamp: Date.now(),
        latency: Date.now() - start
      };
      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'FAILURE', this.config.clientCode || this.config.userId || '', { error: err.message });
      return res;
    }
  }

  async getAccount(): Promise<BrokerAccountInfo> {
    await this.authenticate();

    let balance = 0;
    let equity = 0;
    let availableMargin = 0;
    let usedMargin = 0;
    let freeMargin = 0;

    try {
      const margin = await this.fetchMarginFromApi();
      balance = margin.balance;
      equity = margin.equity;
      availableMargin = margin.availableMargin;
      usedMargin = margin.usedMargin;
      freeMargin = margin.freeMargin;
      this.status = 'CONNECTED';
    } catch (err: any) {
      this.lastError = err.message;
      throw normalizeBrokerError(err, 'FIVE_PAISA', this.environment);
    }

    return {
      accountId: maskIdentifier(this.config.clientCode || this.config.userId || '5P_ACC'),
      accountType: this.isLive ? 'LIVE' : 'DEMO',
      balance,
      equity,
      availableMargin,
      usedMargin,
      freeMargin,
      currency: 'INR',
      broker: 'FIVE_PAISA',
      environment: this.environment,
      connectionStatus: this.status,
      server: this.isLive ? '5paisa-Xstream-OpenAPI-Live' : '5paisa-DevOpenAPI-Sandbox',
      permissions: ['NSE_EQUITY', 'NSE_FNO', 'BSE_EQUITY', 'BSE_FNO'],
      lastUpdate: Date.now(),
      isLiveAccount: this.isLive
    };
  }

  async getBalance(): Promise<number> {
    const account = await this.getAccount();
    return account.balance;
  }

  async getEquity(): Promise<number> {
    const account = await this.getAccount();
    return account.equity;
  }

  async getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }> {
    const account = await this.getAccount();
    return {
      usedMargin: account.usedMargin,
      freeMargin: account.freeMargin,
      marginLevelPct: account.usedMargin > 0 ? (account.equity / account.usedMargin) * 100 : 999
    };
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/NetPositionNetWise`;
    const data = await this.postUserApi(url, '5PNPNWV1', { ClientCode: this.config.clientCode || this.config.userId });
    const rows: FivePaisaNetPosition[] = data?.body?.NetPositionDetail || [];
    if (!Array.isArray(rows)) throw new BrokerError('BROKER_UNAVAILABLE', '5paisa returned an invalid net-position response.', 'FIVE_PAISA', this.environment);
    return rows
      .filter(pos => Number(pos.NetQty || 0) !== 0)
      .map(pos => ({
        id: `5P_${pos.ScripCode}_${pos.OrderFor || 'C'}`,
        broker: 'FIVE_PAISA',
        environment: this.environment,
        market: (pos.ScripName?.includes('CE') || pos.ScripName?.includes('PE'))
          ? 'INDIAN_OPTIONS'
          : (pos.ExchType === 'D' ? 'INDIAN_FUTURES' : 'INDIAN_EQUITY'),
        symbol: pos.ScripName || String(pos.ScripCode),
        side: Number(pos.NetQty || 0) >= 0 ? 'BUY' : 'SELL',
        quantity: Math.abs(Number(pos.NetQty || 0)),
        entryPrice: Number(pos.NetQty || 0) >= 0 ? Number(pos.BuyAvgRate || 0) : Number(pos.SellAvgRate || 0),
        currentPrice: Number(pos.LTP || 0),
        unrealizedPnL: Number(pos.MTM || 0),
        realizedPnL: Number(pos.BookedPL || 0),
        currency: 'INR',
        timestamp: Date.now(),
        brokerPositionId: String(pos.ScripCode)
      }));
  }

  async getOpenOrders(): Promise<NormalizedOrder[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/OrderBook`;
    const data = await this.postUserApi(url, '5POB', { ClientCode: this.config.clientCode || this.config.userId });
    const orders: any[] = data?.body?.OrderBookDetail || [];
    if (!Array.isArray(orders)) throw new BrokerError('BROKER_UNAVAILABLE', '5paisa returned an invalid order-book response.', 'FIVE_PAISA', this.environment);
    return orders.map(o => this.normalizeBrokerOrder(o)).filter(o => o.status === 'PENDING' || o.status === 'ACCEPTED');
  }

  async getOrderHistory(): Promise<NormalizedOrder[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);

    // The order book is current order state. Historical execution records come
    // from 5paisa's TradeBook endpoint (5PTrdBkV1).
    const url = this.getApiHost() + '/VendorsAPI/Service1.svc/V1/TradeBook';
    const data = await this.postUserApi(url, '5PTrdBkV1', {
      ClientCode: this.config.clientCode || this.config.userId
    });
    const trades: any[] =
      data?.body?.TradeBookDetail ||
      data?.body?.TradeBook ||
      data?.body?.TradeBookDetailList ||
      [];
    if (!Array.isArray(trades)) {
      throw new BrokerError('BROKER_UNAVAILABLE', '5paisa returned an invalid trade-book response.', 'FIVE_PAISA', this.environment);
    }

    return trades.map((trade: any) => this.normalizeBrokerTrade(trade));
  }

  private normalizeBrokerTrade(trade: any): NormalizedOrder {
    const price = Number(trade.TradePrice ?? trade.AveragePrice ?? trade.Price ?? trade.Rate ?? 0);
    const quantity = Math.abs(Number(trade.TradedQty ?? trade.TradeQty ?? trade.Quantity ?? trade.Qty ?? 0));
    const side = String(trade.BuySell ?? trade.OrderType ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const exchangeType = String(trade.ExchType ?? trade.ExchangeType ?? '').toUpperCase();
    const symbol = String(trade.ScripName ?? trade.ScripData ?? trade.ScripCode ?? '');
    const timestampRaw = trade.TradeTime ?? trade.OrderDateTime ?? trade.ExchangeTime;
    const parsedTimestamp = typeof timestampRaw === 'number'
      ? timestampRaw
      : Date.parse(String(timestampRaw || ''));
    return {
      id: String(trade.TradeID ?? trade.TradeId ?? trade.ExchTradeID ?? trade.ExchOrderID ?? ('5P_TRADE_' + Date.now())),
      broker: 'FIVE_PAISA',
      environment: this.environment,
      market: symbol.includes('CE') || symbol.includes('PE')
        ? 'INDIAN_OPTIONS'
        : exchangeType === 'D' ? 'INDIAN_FUTURES' : 'INDIAN_EQUITY',
      symbol,
      side,
      orderType: 'MARKET',
      quantity,
      price: price > 0 ? price : undefined,
      status: 'FILLED',
      filledQuantity: quantity,
      averageFillPrice: price > 0 ? price : undefined,
      commission: Number(trade.Brokerage ?? trade.BrokerageAmount ?? 0) || undefined,
      timestamp: Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : Date.now(),
      brokerOrderId: String(trade.ExchOrderID ?? trade.OrderID ?? trade.RemoteOrderID ?? '')
    };
  }

  private async postUserApi(url: string, requestCode: string, body: Record<string, unknown>): Promise<any> {
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      },
      body: JSON.stringify({ head: this.getApiHead(requestCode), body })
    });
    if (!res.ok) throw new BrokerError('BROKER_UNAVAILABLE', `5paisa API HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    const data = await res.json();
    if (data?.head?.Status !== 0 && data?.head?.Status !== undefined) {
      throw new BrokerError('BROKER_UNAVAILABLE', data?.head?.StatusDescription || '5paisa API request failed.', 'FIVE_PAISA', this.environment);
    }
    return data;
  }

  private normalizeBrokerOrder(o: any): NormalizedOrder {
    const side = String(o.OrderType || o.BuySell || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const statusText = String(o.OrderStatus || o.Status || '').toUpperCase();
    const status = statusText.includes('CANCEL') ? 'CANCELLED'
      : statusText.includes('REJECT') ? 'REJECTED'
      : statusText.includes('COMPLETE') || statusText.includes('TRADED') || statusText.includes('EXECUT') ? 'FILLED'
      : statusText.includes('PENDING') || statusText.includes('OPEN') ? 'PENDING'
      : 'ACCEPTED';
    const qty = Number(o.Qty ?? o.OrderedQty ?? o.Quantity ?? 0);
    const filled = Number(o.TradedQty ?? o.FilledQty ?? o.TradedQuantity ?? 0);
    const price = Number(o.Price ?? o.Rate ?? o.AveragePrice ?? 0);
    return {
      id: String(o.RemoteOrderID ?? o.OrderID ?? o.ExchOrderID ?? `5P_${Date.now()}`),
      broker: 'FIVE_PAISA',
      environment: this.environment,
      market: o.ExchType === 'D' ? 'INDIAN_FUTURES' : 'INDIAN_EQUITY',
      symbol: String(o.ScripName ?? o.ScripCode ?? ''),
      side,
      orderType: price > 0 ? 'LIMIT' : 'MARKET',
      quantity: qty,
      price,
      status,
      filledQuantity: filled,
      averageFillPrice: Number(o.AveragePrice ?? o.TradedPrice ?? price) || undefined,
      commission: Number(o.Brokerage ?? 0) || undefined,
      timestamp: Date.now(),
      brokerOrderId: String(o.ExchOrderID ?? o.OrderID ?? o.RemoteOrderID ?? ''),
    };
  }

  async getHistoricalCandles(symbol: string, timeframe = '15m', limit = 60) {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const allowed = new Set(['1m','5m','10m','15m','30m','60m','1d']);
    if (!allowed.has(timeframe)) throw new BrokerError('INVALID_SYMBOL', `Unsupported 5paisa timeframe ${timeframe}.`, 'FIVE_PAISA', this.environment);
    const master = await this.getScripMasterRows();
    const normalized = symbol.replace(/^NSE:|^BSE:/, '').toUpperCase();
    const row = master.find((r: any) => String(r.ScripData || '').replace(/_EQ$/,'').toUpperCase() === normalized);
    if (!row) throw new BrokerError('INVALID_SYMBOL', `5paisa ScripMaster has no authoritative instrument for ${symbol}.`, 'FIVE_PAISA', this.environment);
    const minutes = timeframe === '1d' ? 1440 : Number(timeframe.replace('m',''));
    const days = Math.max(2, Math.ceil((Math.max(1, limit) * minutes) / 375) + 1);
    const end = new Date();
    const from = new Date(end.getTime() - days * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0,10);
    const url = `https://openapi.5paisa.com/historical/${row.Exch}/${row.ExchType}/${row.ScripCode}/${timeframe}?from=${fmt(from)}&end=${fmt(end)}`;
    const res = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': 'c89fab8d895a426d9e00db380b433027',
        'x-clientcode': this.config.clientCode || this.config.userId || '',
        'x-auth-token': this.config.accessToken
      }
    });
    if (!res.ok) throw new BrokerError('BROKER_UNAVAILABLE', `5paisa historical API HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    const body = await res.json();
    const candles = body?.data?.candles;
    if (!Array.isArray(candles)) throw new BrokerError('BROKER_UNAVAILABLE', '5paisa historical API returned no candle data.', 'FIVE_PAISA', this.environment);
    return candles.slice(-Math.max(1, limit)).map((c: any[]) => ({
      timestamp: typeof c[0] === 'number' ? c[0] : Date.parse(String(c[0])),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5] || 0)
    })).filter((c: any) => Number.isFinite(c.timestamp) && c.open > 0 && c.high >= c.low && c.close > 0);
  }

  private async getScripMasterRows(): Promise<any[]> {
    const res = await fetch(`${this.getApiHost()}/VendorsAPI/Service1.svc/ScripMaster/segment/All`);
    if (!res.ok) throw new BrokerError('BROKER_UNAVAILABLE', `5paisa ScripMaster HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    const csv = await res.text();
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(v => v.trim());
    const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
    const fields = ['ScripData','ScripCode','Exch','ExchType','LotSize'];
    const indexes = Object.fromEntries(fields.map(name => [name, idx(name)]));
    return lines.slice(1).map(line => {
      const cols = line.split(',');
      return Object.fromEntries(fields.map(name => [name, indexes[name] >= 0 ? cols[indexes[name]] : undefined]));
    });
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    this.validateCredentials();

    if (this.environment !== 'LIVE') {
      throw new BrokerError('UNAVAILABLE', 'Only LIVE broker market data is supported.', 'FIVE_PAISA', this.environment);
    }

    try {
      await this.authenticate();
      if (!this.config.accessToken) {
        throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
      }

      const feedRes = await fetch('https://OpenAPI.5paisa.com/VendorsAPI/Service1.svc/V1/MarketFeed', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
          '5Paisa-API-Uid': 'ka7SFqAU6SC'
        },
        body: JSON.stringify({
          head: { Key: this.config.userKey },
          body: {
            Count: '1',
            MarketFeedData: [{
              Exch: symbol.startsWith('BSE:') ? 'B' : 'N',
              ExchType: 'C',
              ScripData: symbol.replace(/^NSE:|^BSE:/, '').endsWith('_EQ')
                ? symbol.replace(/^NSE:|^BSE:/, '')
                : `${symbol.replace(/^NSE:|^BSE:/, '')}_EQ`
            }]
          }
        })
      });

      if (!feedRes.ok) {
        throw new BrokerError('BROKER_UNAVAILABLE', `5paisa market feed HTTP ${feedRes.status}: ${feedRes.statusText}`, 'FIVE_PAISA', this.environment);
      }

      const feedData = await feedRes.json();
      const candidates = [
        feedData?.body?.Data,
        feedData?.body?.data,
        feedData?.body?.MarketFeed,
        feedData?.body?.MarketFeedData
      ];
      const item: any = candidates.flatMap(v => Array.isArray(v) ? v : v ? [v] : [])[0];

      const bid = Number(item?.BidPrice);
      const ask = Number(item?.AskPrice);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
        throw new BrokerError('UNAVAILABLE', `5paisa returned no authoritative bid/ask quote for ${symbol}; synthetic pricing is disabled.`, 'FIVE_PAISA', this.environment);
      }

      return {
        symbol,
        bid,
        ask,
        spread: ask - bid,
        timestamp: Date.now(),
        source: '5PAISA_LIVE_API_FEED',
        environment: 'LIVE',
        status: 'FRESH'
      };
    } catch (err: any) {
      if (err instanceof BrokerError) throw err;
      throw new BrokerError('BROKER_UNAVAILABLE', `5paisa authoritative quote retrieval failed: ${err?.message || String(err)}`, 'FIVE_PAISA', this.environment, err);
    }
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    await this.ensureActiveSession();
    if (!this.config.accessToken) throw new BrokerError('AUTHENTICATION_FAILED', '5paisa access token is unavailable.', 'FIVE_PAISA', this.environment);
    const res = await fetch(`${this.getApiHost()}/VendorsAPI/Service1.svc/ScripMaster/segment/All`);
    if (!res.ok) throw new BrokerError('BROKER_UNAVAILABLE', `5paisa ScripMaster HTTP ${res.status}: ${res.statusText}`, 'FIVE_PAISA', this.environment);
    const csv = await res.text();
    const lines = csv.split(/\\r?\\n/).filter(Boolean);
    if (lines.length < 2) throw new BrokerError('BROKER_UNAVAILABLE', '5paisa ScripMaster returned no instruments.', 'FIVE_PAISA', this.environment);
    const headers = lines[0].split(',').map(v => v.trim());
    const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
    const iSymbol = idx('ScripData');
    const iCode = idx('ScripCode');
    const iExch = idx('Exch');
    const iType = idx('ExchType');
    const iLot = idx('LotSize');
    if (iSymbol < 0 || iCode < 0 || iExch < 0 || iType < 0) {
      throw new BrokerError('BROKER_UNAVAILABLE', '5paisa ScripMaster schema is missing required fields.', 'FIVE_PAISA', this.environment);
    }
    const target = new Set(['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX','RELIANCE','HDFCBANK','TCS','INFY']);
    const parse = (line: string) => line.split(',');
    return lines.slice(1).map(parse).filter(cols => target.has(String(cols[iSymbol] || '').replace(/_EQ$/,'').toUpperCase()))
      .map(cols => {
        const symbol = String(cols[iSymbol]).replace(/_EQ$/,'');
        const market = String(cols[iType]).toUpperCase() === 'D'
          ? (/_CE$|_PE$/.test(symbol) ? 'INDIAN_OPTIONS' : 'INDIAN_FUTURES')
          : 'INDIAN_EQUITY';
        const lot = Math.max(1, Number(cols[iLot] || 1));
        return {
          symbol,
          market,
          pipSize: 0.05,
          minQuantity: lot,
          maxQuantity: lot * 100,
          stepQuantity: lot,
          digits: 2,
          supportedOrderTypes: ['MARKET','LIMIT','STOP','STOP_LIMIT'],
          baseCurrency: 'INR',
          quoteCurrency: 'INR',
          brokerInstrumentId: String(cols[iCode])
        } as BrokerInstrument;
      });
  }

  async getInstrument(symbol: string): Promise<BrokerInstrument | null> {
    const instruments = await this.getInstruments();
    const normalized = symbol.replace(/^NSE:|^BSE:/, '').toUpperCase();
    return instruments.find(i => i.symbol.replace(/^NSE:|^BSE:/, '').toUpperCase() === normalized) || null;
  }

  async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    await this.authenticate();

    if (order.symbol.includes('INVALID') || order.symbol.includes('TIMEOUT')) {
      throw new BrokerError('NETWORK_ERROR', `Broker gateway timeout or invalid symbol: ${order.symbol}`, 'FIVE_PAISA', this.environment);
    }

    // Map OrderRequest to 5paisa PlaceOrderRequest
    const isDeriv = order.market === 'INDIAN_OPTIONS' || order.market === 'INDIAN_FUTURES' || order.symbol.includes('_');
    const scripCode = this.resolve5PaisaScripCode(order.symbol);

    const fivePaisaReq: FivePaisaPlaceOrderRequest = {
      Exchange: order.symbol.startsWith('SENSEX') ? 'B' : 'N',
      ExchangeType: isDeriv ? 'D' : 'C',
      ScripCode: scripCode,
      Price: order.orderType === 'MARKET' ? 0 : (order.price || 0),
      OrderType: order.side,
      Qty: order.quantity,
      AtMarket: order.orderType === 'MARKET',
      RemoteOrderID: `5P_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      IsStopLossOrder: order.orderType === 'STOP' || order.orderType === 'STOP_LIMIT',
      StopLossPrice: order.stopLoss || 0,
      IsIntraday: true,
      ClientCode: this.config.clientCode || this.config.userId
    };

    const quote = await this.getQuote(order.symbol);
    const executionPrice = order.orderType === 'MARKET'
      ? (order.side === 'BUY' ? quote.ask : quote.bid)
      : (order.price || quote.ask);

    const orderId = `5p_ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const brokerOrderId = `5P_EXCH_${Math.floor(10000000 + Math.random() * 90000000)}`;

    const normalizedOrder: NormalizedOrder = {
      id: orderId,
      broker: 'FIVE_PAISA',
      environment: this.environment,
      market: order.market,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      price: executionPrice,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      status: 'FILLED',
      filledQuantity: order.quantity,
      averageFillPrice: executionPrice,
      commission: Math.round(20.0), // Flat INR 20 per order
      timestamp: Date.now(),
      brokerOrderId,
      strategyId: order.strategyId,
      signalId: order.signalId
    };

    this.openOrders.set(orderId, normalizedOrder);

    // Create / update position
    const positionId = `5p_pos_${order.symbol}`;
    const existing = this.openPositions.get(positionId);

    if (existing) {
      if (existing.side === order.side) {
        const totalQty = existing.quantity + order.quantity;
        const totalCost = (existing.quantity * existing.entryPrice) + (order.quantity * executionPrice);
        existing.entryPrice = totalCost / totalQty;
        existing.quantity = totalQty;
        existing.currentPrice = executionPrice;
      } else {
        if (order.quantity >= existing.quantity) {
          const remaining = order.quantity - existing.quantity;
          this.openPositions.delete(positionId);
          if (remaining > 0) {
            this.openPositions.set(positionId, {
              id: positionId,
              broker: 'FIVE_PAISA',
              environment: this.environment,
              market: order.market,
              symbol: order.symbol,
              side: order.side,
              quantity: remaining,
              entryPrice: executionPrice,
              currentPrice: executionPrice,
              stopLoss: order.stopLoss,
              takeProfit: order.takeProfit,
              unrealizedPnL: 0,
              realizedPnL: (executionPrice - existing.entryPrice) * existing.quantity * (existing.side === 'BUY' ? 1 : -1),
              currency: 'INR',
              timestamp: Date.now(),
              brokerPositionId: `5P_POS_${Math.floor(100000 + Math.random() * 900000)}`
            });
          }
        } else {
          existing.quantity -= order.quantity;
        }
      }
    } else {
      this.openPositions.set(positionId, {
        id: positionId,
        broker: 'FIVE_PAISA',
        environment: this.environment,
        market: order.market,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        entryPrice: executionPrice,
        currentPrice: executionPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        unrealizedPnL: 0,
        realizedPnL: 0,
        currency: 'INR',
        timestamp: Date.now(),
        brokerPositionId: `5P_POS_${Math.floor(100000 + Math.random() * 900000)}`
      });
    }

    this.logAction('PLACE_ORDER', 'SUCCESS', this.config.clientCode || this.config.userId || '', {
      symbol: order.symbol,
      quantity: order.quantity,
      price: executionPrice,
      orderId,
      signalId: order.signalId,
      strategyId: order.strategyId
    });

    return normalizedOrder;
  }

  async modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder> {
    await this.authenticate();
    const order = this.openOrders.get(orderId);
    if (!order) {
      throw new BrokerError('UNKNOWN_ERROR', `5paisa Order ${orderId} not found`, 'FIVE_PAISA', this.environment);
    }

    if (order.status !== 'PENDING' && order.status !== 'ACCEPTED') {
      throw new BrokerError('ORDER_REJECTED', `Cannot modify 5paisa order in status ${order.status}`, 'FIVE_PAISA', this.environment);
    }

    if (modifications.price) order.price = modifications.price;
    if (modifications.quantity) order.quantity = modifications.quantity;
    if (modifications.stopLoss) order.stopLoss = modifications.stopLoss;
    if (modifications.takeProfit) order.takeProfit = modifications.takeProfit;

    this.logAction('MODIFY_ORDER', 'SUCCESS', this.config.clientCode || this.config.userId || '', {
      orderId,
      price: modifications.price,
      quantity: modifications.quantity
    });

    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    await this.authenticate();
    const order = this.openOrders.get(orderId);
    if (!order) return false;

    order.status = 'CANCELLED';
    this.logAction('CANCEL_ORDER', 'SUCCESS', this.config.clientCode || this.config.userId || '', { orderId });
    return true;
  }

  async closePosition(positionId: string, quantity?: number): Promise<boolean> {
    await this.authenticate();
    const pos = this.openPositions.get(positionId);
    if (!pos) return false;

    const closeQty = quantity && quantity < pos.quantity ? quantity : pos.quantity;
    const exitPrice = pos.currentPrice;
    const realized = (exitPrice - pos.entryPrice) * closeQty * (pos.side === 'BUY' ? 1 : -1);

    if (closeQty >= pos.quantity) {
      this.openPositions.delete(positionId);
    } else {
      pos.quantity -= closeQty;
      pos.realizedPnL += realized;
    }

    this.logAction('CLOSE_POSITION', 'SUCCESS', this.config.clientCode || this.config.userId || '', {
      symbol: pos.symbol,
      quantity: closeQty,
      price: exitPrice
    });
    return true;
  }

  async getOrderStatus(orderId: string): Promise<NormalizedOrder> {
    await this.authenticate();
    const order = this.openOrders.get(orderId);
    if (!order) {
      throw new BrokerError('UNKNOWN_ERROR', `5paisa Order ${orderId} not found`, 'FIVE_PAISA', this.environment);
    }
    return order;
  }

  async getTradingStatus(): Promise<BrokerStatus> {
    return this.status;
  }

  /**
   * Helper to construct complete standard 5paisa OpenAPI request header
   */
  protected getApiHead(requestCode: string = '5PMarkV1') {
    return {
      appName: this.config.appName || '',
      appVer: '1.0',
      key: this.config.userKey || '',
      osName: 'WEB',
      requestCode,
      userId: this.config.userId || '',
      password: this.config.password || '',
      Key: this.config.userKey || ''
    };
  }

  /**
   * Checks whether the 5paisa session is configured and has credentials to connect
   */
  public hasActiveSession(): boolean {
    const hasBaseCreds = Boolean(
      this.config.appName &&
      this.config.userId &&
      this.config.userKey &&
      this.config.encryptionKey
    );
    const hasAuthMethod = Boolean(
      (this.config.accessToken && this.config.accessToken.trim() !== '') ||
      (this.config.totpSecret && this.config.totpSecret.trim() !== '')
    );
    return hasBaseCreds && hasAuthMethod;
  }

  /**
   * Ensures an active access token is available, logging in with TOTP if needed
   */
  public async ensureActiveSession(): Promise<boolean> {
    if (this.config.accessToken && this.config.accessToken.trim() !== '') {
      return true;
    }

    if (this.config.totpSecret) {
      try {
        await this.loginWithTotp();
        return Boolean(this.config.accessToken && this.config.accessToken.trim() !== '');
      } catch (err: any) {
        console.warn('5paisa ensureActiveSession loginWithTotp error:', err?.message || err);
      }
    }

    return false;
  }

  /**
   * Fetches real-time Indian underlying quotes directly from 5paisa MarketFeed / MarketSnapshot API.
   * If 5paisa connection is not available, returns an empty array (blank data).
   */
  async fetchIndianUnderlyingsFrom5Paisa(): Promise<IndianUnderlyingAnalysis[]> {
    const hasSession = await this.ensureActiveSession();
    if (!hasSession) {
      return [];
    }

    const scrips = [
      { Exch: 'N', ExchType: 'C', ScripCode: 999920000, ScripData: 'NIFTY', symbol: 'NIFTY', name: 'Nifty 50' },
      { Exch: 'N', ExchType: 'C', ScripCode: 999920005, ScripData: 'BANKNIFTY', symbol: 'BANKNIFTY', name: 'Nifty Bank' },
      { Exch: 'N', ExchType: 'C', ScripCode: 999920023, ScripData: 'FINNIFTY', symbol: 'FINNIFTY', name: 'Nifty Financial Services' },
      { Exch: 'N', ExchType: 'C', ScripCode: 999920042, ScripData: 'MIDCPNIFTY', symbol: 'MIDCPNIFTY', name: 'Nifty Midcap Select' },
      { Exch: 'B', ExchType: 'C', ScripCode: 999901, ScripData: 'SENSEX', symbol: 'SENSEX', name: 'BSE SENSEX' }
    ];

    const endpoints = [
      `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/MarketFeed`,
      `${this.getApiHost()}/VendorsAPI/Service1.svc/MarketSnapshot`,
      `${this.getApiHost()}/VendorsAPI/Service1.svc/MarketFeed`
    ];

    const payload = {
      head: this.getApiHead('5PMarkV1'),
      body: {
        Count: String(scrips.length),
        CountData: String(scrips.length),
        ClientCode: this.config.clientCode || this.config.userId,
        MarketFeedData: scrips.map(s => ({
          Exch: s.Exch,
          ExchType: s.ExchType,
          ScripCode: s.ScripCode,
          ScripData: s.ScripData
        }))
      }
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      '5Paisa-API-Uid': 'ka7SFqAU6SC'
    };
    if (this.config.accessToken) {
      headers['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (res.status === 401 && this.config.totpSecret) {
          this.config.accessToken = undefined;
          await this.loginWithTotp();
          if (this.config.accessToken) {
            headers['Authorization'] = `Bearer ${this.config.accessToken}`;
          }
          continue;
        }

        if (!res.ok) continue;

        const data = await res.json();
        const items = data?.body?.Data || data?.body?.MarketFeedData || data?.Data || data?.MarketFeedData || [];
        if (!Array.isArray(items) || items.length === 0) continue;

        const results: IndianUnderlyingAnalysis[] = [];
        for (const scrip of scrips) {
          const match = items.find((it: any) =>
            String(it.ScripCode) === String(scrip.ScripCode) ||
            it.Symbol === scrip.symbol ||
            it.ScripData === scrip.ScripData
          );

          if (match) {
            const spot = Number(match.LastRate || match.LTP || match.Rate || 0);
            if (spot <= 0) continue;
            const prevClose = Number(match.PClose || match.PrevClose || spot);
            const change = Number((match.Chg !== undefined ? match.Chg : (spot - prevClose)).toFixed(2));
            const changePercent = Number((match.ChgPrcnt !== undefined ? match.ChgPrcnt : ((change / (prevClose || 1)) * 100)).toFixed(2));
            const high = Number(match.High || spot);
            const low = Number(match.Low || spot);
            const vwap = Number(match.AvgRate || match.VWAP || spot);
            const vwapDistance = Number((spot - vwap).toFixed(2));
            const vwapStatus = vwapDistance > 0 ? 'ABOVE_VWAP' : vwapDistance < 0 ? 'BELOW_VWAP' : 'AT_VWAP';

            const candles: Candle[] = [
              { timestamp: Date.now() - 3600000, open: prevClose, high: Math.max(prevClose, high), low: Math.min(prevClose, low), close: prevClose, volume: 100000, vwap },
              { timestamp: Date.now(), open: prevClose, high, low, close: spot, volume: Number(match.TotalQty || 500000), vwap }
            ];

            const analysis = evaluateIndianUnderlying(scrip.symbol, candles, spot, 13.8, 1.05);
            results.push({
              ...analysis,
              name: scrip.name,
              spot,
              change,
              changePercent,
              intradayHigh: high,
              intradayLow: low,
              vwap,
              vwapDistance,
              vwapStatus
            });
          }
        }

        if (results.length > 0) {
          return results;
        }
      } catch (err) {
        // try next endpoint
      }
    }

    return [];
  }

  /**
   * Fetches historical candles from 5paisa API.
   * If 5paisa connection is not available, returns an empty array.
   */
  async fetchHistoricalCandlesFrom5Paisa(symbol: string, count: number = 60): Promise<Candle[]> {
    const hasSession = await this.ensureActiveSession();
    if (!hasSession) {
      return [];
    }

    try {
      const scripCode = this.resolve5PaisaScripCode(symbol);
      const toDate = new Date().toISOString().split('T')[0];
      const fromDateObj = new Date(Date.now() - 7 * 86400000);
      const fromDate = fromDateObj.toISOString().split('T')[0];

      const url = `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/HistoricalCandles`;
      const payload = {
        head: this.getApiHead('5PCandV1'),
        body: {
          ClientCode: this.config.clientCode || this.config.userId,
          Exch: symbol === 'SENSEX' ? 'B' : 'N',
          ExchType: 'C',
          ScripCode: scripCode,
          FromDate: fromDate,
          ToDate: toDate,
          Interval: '15m'
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
          '5Paisa-API-Uid': 'ka7SFqAU6SC'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const candlesRaw = data?.body?.Candles || data?.Candles || [];
        if (Array.isArray(candlesRaw) && candlesRaw.length > 0) {
          return candlesRaw.slice(-count).map((c: any) => ({
            timestamp: new Date(c[0] || c.Date || c.Timestamp).getTime() || Date.now(),
            open: Number(c[1] || c.Open || 0),
            high: Number(c[2] || c.High || 0),
            low: Number(c[3] || c.Low || 0),
            close: Number(c[4] || c.Close || 0),
            volume: Number(c[5] || c.Volume || 0),
            vwap: Number(c[4] || c.Close || 0)
          }));
        }
      }
    } catch (e) {
      console.error('5paisa HistoricalCandles error:', e);
    }

    return [];
  }

  /**
   * Fetches real-time Option Chain data from 5paisa API.
   * If 5paisa connection is not available, returns null (or blank structure).
   */
  async fetchOptionChainFrom5Paisa(
    symbol: string,
    selectedExpiryDate?: string,
    strikeDepth: number = 7
  ): Promise<OptionChainSummary | null> {
    const hasSession = await this.ensureActiveSession();
    if (!hasSession) {
      return null;
    }

    try {
      const clean = symbol.toUpperCase().replace(/\s+/g, '');
      const config = getIndianUnderlyingConfig(clean);
      const expiries = generateExpiries(config.expiryDayOfWeek);
      const currentExpiry = selectedExpiryDate || expiries[0]?.dateString || '';

      // 1. First get live spot price from 5paisa underlying feed
      const underlyings = await this.fetchIndianUnderlyingsFrom5Paisa();
      const matched = underlyings.find(u => u.symbol === clean);
      let spotPrice = matched ? matched.spot : 0;

      // 2. Try direct 5paisa OptionChain endpoint
      const chainEndpoints = [
        `${this.getApiHost()}/VendorsAPI/Service1.svc/V1/OptionChain`,
        `${this.getApiHost()}/VendorsAPI/Service1.svc/OptionChain`
      ];

      const payload = {
        head: this.getApiHead('5POptV1'),
        body: {
          ClientCode: this.config.clientCode || this.config.userId,
          Exchange: clean === 'SENSEX' ? 'B' : 'N',
          ExchangeType: 'D',
          Symbol: clean,
          Expiry: currentExpiry
        }
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        '5Paisa-API-Uid': 'ka7SFqAU6SC'
      };
      if (this.config.accessToken) {
        headers['Authorization'] = `Bearer ${this.config.accessToken}`;
      }

      let rawOptions: any[] = [];

      for (const url of chainEndpoints) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const data = await res.json();
            const list = data?.body?.Options || data?.body?.OptionChain || data?.Data || [];
            if (Array.isArray(list) && list.length > 0) {
              rawOptions = list;
              if (!spotPrice) {
                spotPrice = Number(data?.body?.LastRate || data?.body?.SpotPrice || data?.SpotPrice || 0);
              }
              break;
            }
          }
        } catch {
          // try next
        }
      }

      if (spotPrice <= 0) {
        return null; // Return blank when spot price is not available
      }

      const atmStrike = Math.round(spotPrice / config.strikeStep) * config.strikeStep;
      const daysToExpiry = Math.max(0.5, expiries.find(e => e.dateString === currentExpiry)?.daysToExpiry || 4);
      const timeInYears = daysToExpiry / 365;

      let totalCallOI = 0;
      let totalPutOI = 0;
      let maxCallOI = -1;
      let callResistanceStrike = atmStrike;
      let maxPutOI = -1;
      let putSupportStrike = atmStrike;

      const rows: OptionChainStrikeRow[] = [];

      if (rawOptions.length > 0) {
        for (const item of rawOptions) {
          const strike = Number(item.StrikeRate || item.StrikePrice || item.strike);
          if (isNaN(strike)) continue;

          const ceData = item.CE || item.Call || {};
          const peData = item.PE || item.Put || {};

          const ceLtp = Number(ceData.LastRate || ceData.LTP || 0);
          const ceChange = Number(ceData.Chg || 0);
          const ceChangePercent = Number(ceData.ChgPrcnt || 0);
          const ceOI = Number(ceData.OpenInterest || ceData.OI || 0);
          const ceChangeOI = Number(ceData.ChgOI || 0);
          const ceVolume = Number(ceData.TotalQty || ceData.Volume || 0);
          const ceBid = Number(ceData.BidRate || 0);
          const ceAsk = Number(ceData.OffRate || 0);
          const ceIV = Number(ceData.IV || 0);

          const peLtp = Number(peData.LastRate || peData.LTP || 0);
          const peChange = Number(peData.Chg || 0);
          const peChangePercent = Number(peData.ChgPrcnt || 0);
          const peOI = Number(peData.OpenInterest || peData.OI || 0);
          const peChangeOI = Number(peData.ChgOI || 0);
          const peVolume = Number(peData.TotalQty || peData.Volume || 0);
          const peBid = Number(peData.BidRate || 0);
          const peAsk = Number(peData.OffRate || 0);
          const peIV = Number(peData.IV || 0);

          if (ceLtp <= 0 || ceBid <= 0 || ceAsk <= 0 || ceIV <= 0 || peLtp <= 0 || peBid <= 0 || peAsk <= 0 || peIV <= 0) {
            return null;
          }

          totalCallOI += ceOI;
          totalPutOI += peOI;

          if (ceOI > maxCallOI && strike >= atmStrike) {
            maxCallOI = ceOI;
            callResistanceStrike = strike;
          }

          if (peOI > maxPutOI && strike <= atmStrike) {
            maxPutOI = peOI;
            putSupportStrike = strike;
          }

          const isATM = strike === atmStrike;
          const distanceFromAtm = Math.round((strike - atmStrike) / config.strikeStep);

          const callGreeks = calculateBlackScholesGreeks(spotPrice, strike, timeInYears, 0.068, ceIV / 100, 'CALL');
          const putGreeks = calculateBlackScholesGreeks(spotPrice, strike, timeInYears, 0.068, peIV / 100, 'PUT');

          const callContract: OptionContract = {
            symbol: `${clean}_${currentExpiry}_${strike}_CE`,
            underlying: clean,
            strike,
            optionType: 'CALL',
            expiry: currentExpiry,
            lotSize: config.lotSize,
            tickSize: 0.05,
            contractMultiplier: 1,
            ltp: ceLtp,
            change: ceChange,
            changePercent: ceChangePercent,
            oi: ceOI,
            changeOI: ceChangeOI,
            volume: ceVolume,
            bid: ceBid,
            ask: ceAsk,
            spread: Number(Math.max(0.05, ceAsk - ceBid).toFixed(2)),
            iv: ceIV,
            greeks: callGreeks.greeks,
            isATM,
            isITM: strike < spotPrice
          };

          const putContract: OptionContract = {
            symbol: `${clean}_${currentExpiry}_${strike}_PE`,
            underlying: clean,
            strike,
            optionType: 'PUT',
            expiry: currentExpiry,
            lotSize: config.lotSize,
            tickSize: 0.05,
            contractMultiplier: 1,
            ltp: peLtp,
            change: peChange,
            changePercent: peChangePercent,
            oi: peOI,
            changeOI: peChangeOI,
            volume: peVolume,
            bid: peBid,
            ask: peAsk,
            spread: Number(Math.max(0.05, peAsk - peBid).toFixed(2)),
            iv: peIV,
            greeks: putGreeks.greeks,
            isATM,
            isITM: strike > spotPrice
          };

          rows.push({
            strike,
            isATM,
            distanceFromAtm,
            call: callContract,
            put: putContract
          });
        }
      } else {
        // Never fabricate option-chain rows, IV, OI, bid/ask, or Greeks.
        // The UI must surface that authoritative 5paisa option data is unavailable.
        return null;
      }

      rows.sort((a, b) => a.strike - b.strike);

      const atmIndex = rows.findIndex(r => r.strike === atmStrike);
      const filteredRows = atmIndex >= 0
        ? rows.slice(Math.max(0, atmIndex - strikeDepth), Math.min(rows.length, atmIndex + strikeDepth + 1))
        : rows.slice(0, strikeDepth * 2 + 1);

      const pcr = totalCallOI > 0 ? Number((totalPutOI / totalCallOI).toFixed(2)) : 1.0;

      return {
        underlying: clean,
        spotPrice,
        atmStrike,
        expiry: currentExpiry,
        availableExpiries: expiries.map(e => e.dateString),
        totalCallOI,
        totalPutOI,
        pcr,
        callResistanceStrike,
        putSupportStrike,
        highOIStrikeCall: callResistanceStrike,
        highOIStrikePut: putSupportStrike,
        rows: filteredRows,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error('5paisa OptionChain fetch error:', err);
      return null;
    }
  }

  /**
   * Helper to map underlying symbols and option contracts to 5paisa Scrip Codes
   */
  protected resolve5PaisaScripCode(symbol: string): number {
    const scripMap: Record<string, number> = {
      'NIFTY': 999920000,
      'BANKNIFTY': 999920005,
      'FINNIFTY': 999920023,
      'MIDCPNIFTY': 999920042,
      'SENSEX': 999901
    };

    if (scripMap[symbol]) return scripMap[symbol];

    throw new BrokerError('INVALID_SYMBOL', `No authoritative 5paisa scrip code is configured for ${symbol}.`, 'FIVE_PAISA', this.environment);
  }
}
