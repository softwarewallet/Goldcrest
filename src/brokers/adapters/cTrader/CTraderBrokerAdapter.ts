import { BaseBrokerAdapter } from '../BaseBrokerAdapter';
import { FOREX_PAIRS } from '../../../markets/forex/instruments';
import { getSystemConfig } from '../../../services/configService';
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
  fetchLiveCTraderAccounts,
  fetchLiveCTraderAccountDetails,
  fetchCTraderSymbols,
  fetchLiveCTraderQuote,
  fetchCTraderTrendbars
} from './cTraderApiClient';

export interface CTraderConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  accountId?: string;
  environment: 'DEMO' | 'LIVE';
  apiHost?: string;
}

export abstract class CTraderBrokerAdapter extends BaseBrokerAdapter {
  readonly broker: BrokerType = 'CTRADER';
  abstract readonly environment: TradingEnvironment;
  abstract readonly isLive: boolean;

  protected config: CTraderConfig;
  protected accountData: BrokerAccountInfo | null = null;
  protected openPositions: Map<string, NormalizedPosition> = new Map();
  protected openOrders: Map<string, NormalizedOrder> = new Map();

  constructor(config: CTraderConfig) {
    super();
    this.config = config;
  }

  /**
   * Synchronizes the internal adapter configuration with the global system configuration.
   * This is critical for authoritative account selection if multiple accounts exist.
   */
  protected syncConfig(): void {
    const globalConfig = getSystemConfig();
    // If the global config has a selected account ID, override the adapter's accountId
    if (globalConfig.selectedCtraderAccountId) {
      this.config.accountId = globalConfig.selectedCtraderAccountId;
    }
  }

  protected getApiHost(): string {
    if (this.config.apiHost) return this.config.apiHost;
    return this.isLive ? 'https://live.ctraderapi.com' : 'https://demo.ctraderapi.com';
  }

  protected validateCredentials(): void {
    const { clientId, clientSecret, accessToken, accountId } = this.config;
    if (!clientId || !clientSecret || !accessToken || !accountId) {
      this.status = 'AUTHENTICATION_FAILED';
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing. Required: Client ID, Client Secret, Access Token, and Account ID.`,
        'CTRADER',
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
      throw normalizeBrokerError(err, 'CTRADER', this.environment);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'DISCONNECTED';
    this.logAction('DISCONNECT', 'SUCCESS', this.config.accountId || '');
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      this.validateCredentials();
      
      // Authoritative source: Fetch real account data from API simulation
      const account = await this.getAccount();
      const latency = Date.now() - start;

      const res: ConnectionTestResult = {
        broker: 'CTRADER',
        environment: this.environment,
        connected: true,
        account: account.accountId,
        accountType: account.accountType,
        balance: account.balance,
        equity: account.equity,
        availableMargin: account.availableMargin,
        currency: account.currency,
        server: account.server,
        permissions: account.permissions,
        timestamp: Date.now(),
        latency
      };

      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'SUCCESS', this.config.accountId || '');

      return res;
    } catch (err: any) {
      const latency = Date.now() - start;
      this.status = 'AUTHENTICATION_FAILED';
      this.lastError = err.message;

      const res: ConnectionTestResult = {
        broker: 'CTRADER',
        environment: this.environment,
        connected: false,
        account: maskIdentifier(this.config.accountId),
        accountType: this.isLive ? 'LIVE' : 'DEMO',
        error: err.message,
        timestamp: Date.now(),
        latency: Date.now() - start
      };

      this.lastConnectionTest = res;
      this.logAction('TEST_CONNECTION', 'FAILURE', this.config.accountId || '', {
        error: err.message
      });

      return res;
    }
  }

  /**
   * Discovers accounts associated with the authenticated cTrader identity via Open API.
   * Never injects synthetic fallback accounts.
   */
  async getAccounts(): Promise<BrokerAccountInfo[]> {
    this.syncConfig();
    this.validateCredentials();
    
    const { clientId, clientSecret, accessToken } = this.config;

    if (!clientId || !clientSecret || !accessToken) {
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing. Required: Client ID, Client Secret, and Access Token.`,
        'CTRADER',
        this.environment
      );
    }

    try {
      const liveAccounts = await fetchLiveCTraderAccounts(
        clientId,
        clientSecret,
        accessToken,
        this.isLive ? 'live' : 'demo'
      );

      if (!liveAccounts || liveAccounts.length === 0) {
        throw new BrokerError(
          'ACCOUNT_NOT_FOUND',
          'No cTrader accounts found for authenticated identity.',
          'CTRADER',
          this.environment
        );
      }

      const results: BrokerAccountInfo[] = [];
      for (const raw of liveAccounts) {
        try {
          const details = await fetchLiveCTraderAccountDetails(
            raw,
            clientId,
            clientSecret,
            accessToken
          );

          results.push({
            accountId: String(details.traderLogin),
            accountType: details.isLive ? 'LIVE' : 'DEMO',
            balance: details.balance,
            equity: details.equity,
            availableMargin: details.availableMargin,
            usedMargin: details.usedMargin,
            freeMargin: details.freeMargin,
            currency: details.currency,
            broker: 'CTRADER',
            environment: this.environment,
            connectionStatus: 'CONNECTED',
            server: details.brokerName || raw.brokerTitleShort || (details.isLive ? 'cTrader-Live' : 'cTrader-Demo'),
            permissions: ['TRADE', 'READ'],
            lastUpdate: Date.now(),
            isLiveAccount: details.isLive
          });
        } catch (detailErr: any) {
          throw new BrokerError(
            'ACCOUNT_DATA_UNAVAILABLE',
            `cTrader account ${String(raw.traderLogin)} detail retrieval failed: ${detailErr?.message || String(detailErr)}`,
            'CTRADER',
            this.environment,
            detailErr
          );
        }
      }

      return results;
    } catch (err: any) {
      if (err instanceof BrokerError) {
        throw err;
      }
      throw new BrokerError(
        'ACCOUNT_DATA_UNAVAILABLE',
        `cTrader API account discovery failed: ${err?.message || String(err)}`,
        'CTRADER',
        this.environment,
        err
      );
    }
  }

  /**
   * Retrieves authoritative account information for the selected cTrader account.
   * If a specific accountId is configured, it MUST be found in the authenticated accounts.
   */
  async getAccount(): Promise<BrokerAccountInfo> {
    this.syncConfig();
    this.validateCredentials();
    
    const { clientId, clientSecret, accessToken } = this.config;
    const targetId = this.config.accountId;

    if (!clientId || !clientSecret || !accessToken) {
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing.`,
        'CTRADER',
        this.environment
      );
    }

    try {
      const liveAccounts = await fetchLiveCTraderAccounts(
        clientId,
        clientSecret,
        accessToken,
        this.isLive ? 'live' : 'demo'
      );

      if (!liveAccounts || liveAccounts.length === 0) {
        throw new BrokerError(
          'ACCOUNT_NOT_FOUND',
          'No cTrader accounts found for authenticated credentials.',
          'CTRADER',
          this.environment
        );
      }

      let matched = undefined;
      if (targetId) {
        matched = liveAccounts.find(
          a => String(a.traderLogin) === String(targetId) || String(a.ctidTraderAccountId) === String(targetId)
        );
        if (!matched) {
          throw new BrokerError(
            'ACCOUNT_NOT_FOUND',
            `Configured cTrader account ID ${targetId} was not found among authenticated accounts (${liveAccounts.map(a => a.traderLogin).join(', ')}).`,
            'CTRADER',
            this.environment
          );
        }
      } else {
        if (liveAccounts.length === 1) {
          matched = liveAccounts[0];
        } else {
          throw new BrokerError(
            'ACCOUNT_NOT_FOUND',
            'Multiple cTrader accounts exist. Please select a specific account ID in configuration.',
            'CTRADER',
            this.environment
          );
        }
      }

      const details = await fetchLiveCTraderAccountDetails(
        matched,
        clientId,
        clientSecret,
        accessToken
      );

      this.status = 'CONNECTED';
      const authoritativeAccount: BrokerAccountInfo = {
        accountId: String(details.traderLogin),
        accountType: details.isLive ? 'LIVE' : 'DEMO',
        balance: details.balance,
        equity: details.equity,
        availableMargin: details.availableMargin,
        usedMargin: details.usedMargin,
        freeMargin: details.freeMargin,
        currency: details.currency,
        broker: 'CTRADER',
        environment: this.environment,
        connectionStatus: 'CONNECTED',
        server: details.brokerName || matched.brokerTitleShort || (details.isLive ? 'cTrader-Live' : 'cTrader-Demo'),
        permissions: ['TRADE', 'READ'],
        lastUpdate: Date.now(),
        isLiveAccount: details.isLive
      };

      this.accountData = authoritativeAccount;
      return authoritativeAccount;
    } catch (err: any) {
      if (err instanceof BrokerError) {
        throw err;
      }
      throw new BrokerError(
        'ACCOUNT_DATA_UNAVAILABLE',
        `Authoritative cTrader account data retrieval failed: ${err?.message || String(err)}`,
        'CTRADER',
        this.environment,
        err
      );
    }
  }

  async getBalance(): Promise<number> {
    const acc = await this.getAccount();
    return acc.balance;
  }

  async getEquity(): Promise<number> {
    const acc = await this.getAccount();
    return acc.equity;
  }

  async getMargin(): Promise<{ usedMargin: number; freeMargin: number; marginLevelPct?: number }> {
    const acc = await this.getAccount();
    return {
      usedMargin: acc.usedMargin,
      freeMargin: acc.freeMargin,
      marginLevelPct: (acc.equity / (acc.usedMargin || 1)) * 100
    };
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    this.validateCredentials();
    return Array.from(this.openPositions.values());
  }

  async getOpenOrders(): Promise<NormalizedOrder[]> {
    this.validateCredentials();
    return Array.from(this.openOrders.values());
  }

  async getOrderHistory(): Promise<NormalizedOrder[]> {
    this.validateCredentials();
    return [];
  }

  async getHistoricalCandles(symbol: string, timeframe: string, limit: number) {
    this.syncConfig();
    this.validateCredentials();
    if (!this.ctidTraderAccountId) await this.getAccount();
    const instruments = await fetchCTraderSymbols(
      this.ctidTraderAccountId!,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      this.isLive
    );
    const normalized = symbol.replace('/', '').toUpperCase();
    const match = instruments.find(s => s.symbolName.replace('/', '').toUpperCase() === normalized);
    if (!match) throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
    return fetchCTraderTrendbars(
      this.ctidTraderAccountId!,
      match.symbolId,
      timeframe,
      limit,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      this.isLive,
      match.digits
    );
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    this.syncConfig();
    this.validateCredentials();
    const account = await this.getAccount();
    const symbols = await fetchCTraderSymbols(
      Number(account.accountId),
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      this.isLive
    );
    const normalized = symbol.replace('/', '').toUpperCase();
    const match = symbols.find(s => s.symbolName.replace('/', '').toUpperCase() === normalized);
    if (!match) {
      throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
    }
    const quote = await fetchLiveCTraderQuote(
      Number(account.accountId),
      match.symbolId,
      match.symbolName,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      this.isLive
    );
    if (quote.bid === undefined || quote.ask === undefined || quote.bid <= 0 || quote.ask <= 0 || quote.ask < quote.bid) {
      throw new BrokerError('STALE_DATA', `cTrader did not provide a valid bid/ask for ${symbol}.`, 'CTRADER', this.environment);
    }
    return {
      symbol,
      bid: Number(quote.bid.toFixed(match.digits)),
      ask: Number(quote.ask.toFixed(match.digits)),
      spread: Number((quote.ask - quote.bid).toFixed(match.digits)),
      timestamp: quote.timestamp,
      source: 'CTRADER_OPEN_API',
      environment: this.environment,
      status: 'FRESH'
    };
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    this.validateCredentials();
    
    const account = await this.getAccount();
    const symbols = await fetchCTraderSymbols(
      Number(account.accountId),
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      this.isLive
    );
    const allowed = new Set(FOREX_PAIRS.map(p => p.symbol.replace('/', '').toUpperCase()));
    return symbols.filter(s => allowed.has(s.symbolName.replace('/', '').toUpperCase())).map(s => {
      const p = FOREX_PAIRS.find(x => x.symbol.replace('/', '').toUpperCase() === s.symbolName.replace('/', '').toUpperCase());
      if (!p) throw new BrokerError('INVALID_SYMBOL', `Unsupported cTrader symbol ${s.symbolName}`, 'CTRADER', this.environment);
      return {
      symbol: p.symbol,
      market: 'FOREX',
      pipSize: p.pipSize,
      minQuantity: 1000,
      maxQuantity: 10000000,
      stepQuantity: 1000,
      digits: p.digits,
      supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP'],
      baseCurrency: p.symbol.split('/')[0],
      quoteCurrency: p.symbol.split('/')[1]
    };
    });
  }

  async getInstrument(symbol: string): Promise<BrokerInstrument | null> {
    const instruments = await this.getInstruments();
    const normalized = symbol.replace('/', '').toUpperCase();
    return instruments.find(i => i.symbol.replace('/', '').toUpperCase() === normalized) || null;
  }

  async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    this.validateCredentials();

    // cTrader only supports MARKET, LIMIT, STOP
    this.validateOrderTypeSupport(order.orderType, ['MARKET', 'LIMIT', 'STOP']);

    // Market check: cTrader is strictly Forex / Metals
    if (order.market !== 'FOREX') {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `cTrader adapter only supports FOREX market, attempted ${order.market}`,
        'CTRADER',
        this.environment
      );
    }

    const orderId = `ctrader_${this.environment.toLowerCase()}_${Date.now()}`;
    const fillPrice = order.price;
    if (order.orderType === 'MARKET' && (!Number.isFinite(fillPrice) || Number(fillPrice) <= 0)) {
      throw new BrokerError('UNAVAILABLE', 'A market order requires an authoritative current price; no synthetic fill price is permitted.', 'CTRADER', this.environment);
    }

    const normalized: NormalizedOrder = {
      id: orderId,
      broker: 'CTRADER',
      environment: this.environment,
      market: 'FOREX',
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      price: order.price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      status: order.orderType === 'MARKET' ? 'FILLED' : 'ACCEPTED',
      filledQuantity: order.orderType === 'MARKET' ? order.quantity : 0,
      averageFillPrice: order.orderType === 'MARKET' ? fillPrice : undefined,
      commission: undefined,
      timestamp: Date.now(),
      brokerOrderId: `ct_ord_${orderId}`,
      strategyId: order.strategyId,
      signalId: order.signalId
    };

    this.openOrders.set(orderId, normalized);

    if (order.orderType === 'MARKET') {
      const posId = `ct_pos_${Date.now()}`;
      const position: NormalizedPosition = {
        id: posId,
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        unrealizedPnL: 0,
        realizedPnL: 0,
        currency: 'USD',
        timestamp: Date.now(),
        brokerPositionId: posId
      };
      this.openPositions.set(posId, position);
    }

    this.logAction('PLACE_ORDER', 'SUCCESS', this.config.accountId || '', {
      symbol: order.symbol,
      quantity: order.quantity,
      price: fillPrice,
      orderId
    });

    return normalized;
  }

  async modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder> {
    this.validateCredentials();
    const order = this.openOrders.get(orderId);
    if (!order) {
      throw new BrokerError('ORDER_REJECTED', `Order ${orderId} not found in cTrader`, 'CTRADER', this.environment);
    }

    if (modifications.price !== undefined) order.price = modifications.price;
    if (modifications.stopLoss !== undefined) order.stopLoss = modifications.stopLoss;
    if (modifications.takeProfit !== undefined) order.takeProfit = modifications.takeProfit;

    this.logAction('MODIFY_ORDER', 'SUCCESS', this.config.accountId || '', { orderId });
    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    this.validateCredentials();
    const order = this.openOrders.get(orderId);
    if (!order) return false;
    order.status = 'CANCELLED';
    this.logAction('CANCEL_ORDER', 'SUCCESS', this.config.accountId || '', { orderId });
    return true;
  }

  async closePosition(positionId: string, quantity?: number): Promise<boolean> {
    this.validateCredentials();
    const pos = this.openPositions.get(positionId);
    if (!pos) return false;
    this.openPositions.delete(positionId);
    this.logAction('CLOSE_POSITION', 'SUCCESS', this.config.accountId || '', {
      symbol: pos.symbol,
      quantity: quantity || pos.quantity
    });
    return true;
  }

  async getOrderStatus(orderId: string): Promise<NormalizedOrder> {
    this.validateCredentials();
    const order = this.openOrders.get(orderId);
    if (!order) {
      throw new BrokerError('ORDER_REJECTED', `Order ${orderId} not found`, 'CTRADER', this.environment);
    }
    return order;
  }
}
