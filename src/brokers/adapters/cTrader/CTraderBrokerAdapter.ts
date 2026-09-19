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
  submitLiveCTraderOrder,
  fetchCTraderTrendbars,
  fetchCTraderReconcileState,
  fetchCTraderDeals,
  amendLiveCTraderOrder,
  cancelLiveCTraderOrder,
  closeLiveCTraderPosition,
  CTraderRawAccount
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
    if (!clientId || !clientSecret || !accessToken) {
      this.status = 'AUTHENTICATION_FAILED';
      throw new BrokerError(
        'AUTHENTICATION_FAILED',
        `cTrader ${this.environment} credentials missing. Required: Client ID, Client Secret, and Access Token.`,
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
            permissions: ['TRADE', 'READ', 'TRADING'],
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
        permissions: ['TRADE', 'READ', 'TRADING'],
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

  protected async resolveRawAccount(): Promise<CTraderRawAccount> {
    this.syncConfig();
    this.validateCredentials();
    const { clientId, clientSecret, accessToken, accountId } = this.config;
    const liveAccounts = await fetchLiveCTraderAccounts(
      clientId!,
      clientSecret!,
      accessToken!,
      this.isLive ? 'live' : 'demo'
    );
    if (!liveAccounts || liveAccounts.length === 0) {
      throw new BrokerError('ACCOUNT_NOT_FOUND', 'No cTrader accounts found.', 'CTRADER', this.environment);
    }
    let matched = undefined;
    if (accountId) {
      matched = liveAccounts.find(
        a => String(a.traderLogin) === String(accountId) || String(a.ctidTraderAccountId) === String(accountId)
      );
      if (!matched) {
        throw new BrokerError(
          'ACCOUNT_NOT_FOUND',
          `Configured cTrader LIVE account ID ${accountId} was not found among authenticated accounts.`,
          'CTRADER',
          this.environment
        );
      }
    } else if (liveAccounts.length === 1) {
      matched = liveAccounts[0];
    } else {
      throw new BrokerError(
        'ACCOUNT_NOT_FOUND',
        'Multiple cTrader accounts exist. A specific LIVE account ID is required.',
        'CTRADER',
        this.environment
      );
    }
    return matched;
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    const raw = await this.resolveRawAccount();
    const state = await fetchCTraderReconcileState(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const byId = new Map(symbols.map(s => [s.symbolId, s]));
    return state.positions.map((p: any) => {
      const trade = p.tradeData || {};
      const symbolInfo = byId.get(Number(trade.symbolId));
      if (!symbolInfo) return null;
      const side = String(trade.tradeSide || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
      const quantity = Math.abs(Number(trade.volume || trade.volumeInUnits || 0));
      const entryPrice = Number(trade.openPrice || p.price || 0);
      if (quantity <= 0 || entryPrice <= 0) return null;
      return {
        id: String(p.positionId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: symbolInfo.symbolName,
        side,
        quantity,
        entryPrice,
        currentPrice: entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        unrealizedPnL: Number(p.unrealizedPnL || 0),
        realizedPnL: Number(p.realizedPnL || 0),
        currency: this.accountData?.currency || 'USD',
        timestamp: Date.now(),
        brokerPositionId: String(p.positionId)
      } as NormalizedPosition;
    }).filter(Boolean) as NormalizedPosition[];
  }

  async getOpenOrders(): Promise<NormalizedOrder[]> {
    const raw = await this.resolveRawAccount();
    const state = await fetchCTraderReconcileState(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const byId = new Map(symbols.map(s => [s.symbolId, s]));
    return state.orders.map((o: any) => {
      const trade = o.tradeData || {};
      const symbolInfo = byId.get(Number(trade.symbolId));
      if (!symbolInfo) return null;
      const orderTypeRaw = String(o.orderType || 'MARKET').toUpperCase();
      const orderType = orderTypeRaw.includes('STOP_LIMIT') ? 'STOP_LIMIT' : orderTypeRaw.includes('STOP') ? 'STOP' : orderTypeRaw.includes('LIMIT') ? 'LIMIT' : 'MARKET';
      const side = String(trade.tradeSide || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
      const quantity = Math.abs(Number(trade.volume || trade.volumeInUnits || 0)) / 100;
      const filledQuantity = Math.min(
        quantity,
        Math.abs(Number(o.filledVolume || o.executedVolume || trade.filledVolume || 0)) / 100
      );
      if (quantity <= 0) return null;
      const statusRaw = String(o.orderStatus || 'PENDING').toUpperCase();
      const status = statusRaw.includes('FILLED') ? 'FILLED'
        : statusRaw.includes('CANCEL') ? 'CANCELLED'
        : statusRaw.includes('REJECT') ? 'REJECTED'
        : statusRaw.includes('EXPIRE') ? 'EXPIRED'
        : filledQuantity > 0 && filledQuantity < quantity ? 'PARTIALLY_FILLED'
        : statusRaw.includes('ACCEPT') ? 'ACCEPTED'
        : 'PENDING';
      return {
        id: String(o.orderId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: symbolInfo.symbolName,
        side,
        orderType,
        quantity,
        price: Number(o.limitPrice || o.stopPrice || o.executionPrice || 0) || undefined,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        status,
        filledQuantity,
        averageFillPrice: Number(o.executionPrice || 0) || undefined,
        timestamp: Number(o.utcTimestamp || 0) * 1000 || Date.now(),
        brokerOrderId: String(o.orderId)
      } as NormalizedOrder;
    }).filter(Boolean) as NormalizedOrder[];
  }

  async getDailyRealizedPnL(): Promise<number> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const deals = await fetchCTraderDeals(
      raw.ctidTraderAccountId,
      startOfDay.getTime(),
      Date.now(),
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    return deals.reduce((sum: number, deal: any) => {
      const detail = deal.closePositionDetail || deal.closePositionDetails;
      if (!detail) return sum;

      // cTrader Open API exposes monetary values in integer units. The
      // close-position detail's moneyDigits specifies the decimal exponent
      // required to convert them into deposit-currency amounts.
      const moneyDigits = Number(detail.moneyDigits ?? deal.moneyDigits ?? 0);
      const divisor = Number.isInteger(moneyDigits) && moneyDigits > 0 ? 10 ** moneyDigits : 1;
      const gross = Number(detail.grossProfit ?? detail.profit ?? 0) / divisor;
      const commission = Number(detail.commission ?? 0) / divisor;
      const swap = Number(detail.swap ?? 0) / divisor;

      return sum
        + (Number.isFinite(gross) ? gross : 0)
        + (Number.isFinite(commission) ? commission : 0)
        + (Number.isFinite(swap) ? swap : 0);
    }, 0);
  }

  async getOrderHistory(): Promise<NormalizedOrder[]> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const deals = await fetchCTraderDeals(raw.ctidTraderAccountId, from, Date.now(), this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    return deals.map((deal: any) => {
      const status = Number(deal.dealStatus) === 2 ? 'FILLED' : 'REJECTED';
      const side = Number(deal.tradeSide) === 2 ? 'SELL' : 'BUY';
      const volume = Math.abs(Number(deal.filledVolume ?? deal.volume ?? 0)) / 100;
      const executionPrice = Number(deal.executionPrice || 0);
      return {
        id: String(deal.dealId),
        broker: 'CTRADER',
        environment: this.environment,
        market: 'FOREX',
        symbol: String(deal.symbolId),
        side,
        orderType: 'MARKET',
        quantity: volume,
        price: executionPrice > 0 ? executionPrice : undefined,
        status,
        filledQuantity: status === 'FILLED' ? volume : 0,
        averageFillPrice: executionPrice > 0 ? executionPrice : undefined,
        commission: Number(deal.commission || 0) || undefined,
        timestamp: Number(deal.executionTimestamp || deal.utcLastUpdateTimestamp || Date.now()),
        brokerOrderId: String(deal.orderId),
      } as NormalizedOrder;
    });
  }

  async getHistoricalCandles(symbol: string, timeframe: string, limit: number) {
    try {
      const raw = await this.resolveRawAccount();
      const instruments = await fetchCTraderSymbols(
        raw.ctidTraderAccountId,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
      const normalized = symbol.replace('/', '').toUpperCase();
      const match = instruments.find(s => s.symbolName.replace('/', '').toUpperCase() === normalized);
      if (!match) throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
      return await fetchCTraderTrendbars(
        raw.ctidTraderAccountId,
        match.symbolId,
        timeframe,
        limit,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive,
        match.digits
      );
    } catch (err: any) {
      throw normalizeBrokerError(err, 'CTRADER', this.environment);
    }
  }

  async getQuote(symbol: string): Promise<NormalizedQuote> {
    try {
      const raw = await this.resolveRawAccount();
      const symbols = await fetchCTraderSymbols(
        raw.ctidTraderAccountId,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
      const normalized = symbol.replace('/', '').toUpperCase();
      const match = symbols.find(s => s.symbolName.replace('/', '').toUpperCase() === normalized);
      if (!match) {
        throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
      }
      const quote = await fetchLiveCTraderQuote(
        raw.ctidTraderAccountId,
        match.symbolId,
        match.symbolName,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive,
        match.digits
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
    } catch (err: any) {
      throw normalizeBrokerError(err, 'CTRADER', this.environment);
    }
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    const raw = await this.resolveRawAccount();
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
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
    this.syncConfig();
    this.validateCredentials();

    if (!this.isLive) {
      throw new BrokerError('ENVIRONMENT_MISMATCH', 'Autonomous execution is available only for cTrader LIVE.', 'CTRADER', this.environment);
    }
    this.validateOrderTypeSupport(order.orderType, ['MARKET', 'LIMIT', 'STOP']);

    if (order.market !== 'FOREX') {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `cTrader adapter only supports FOREX market, attempted ${order.market}`,
        'CTRADER',
        this.environment
      );
    }

    const raw = await this.resolveRawAccount();
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const normalizedSymbol = order.symbol.replace('/', '').toUpperCase();
    const symbol = symbols.find(s => s.symbolName.replace('/', '').toUpperCase() === normalizedSymbol);
    if (!symbol) {
      throw new BrokerError('INVALID_SYMBOL', `cTrader symbol ${order.symbol} was not found in the authenticated account symbol list.`, 'CTRADER', this.environment);
    }

    const clientOrderId = (order.signalId || order.strategyId || `gc-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50) || `gc-${Date.now()}`;
    const submitted = await submitLiveCTraderOrder(
      raw.ctidTraderAccountId,
      symbol.symbolId,
      order.orderType as 'MARKET' | 'LIMIT' | 'STOP',
      order.side,
      order.quantity,
      order.price,
      order.stopLoss,
      order.takeProfit,
      clientOrderId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );

    if (submitted.status === 'REJECTED') {
      throw new BrokerError('ORDER_REJECTED', 'cTrader rejected the live order.', 'CTRADER', this.environment);
    }

    const brokerOrderId = String(submitted.orderId);
    const normalized: NormalizedOrder = {
      id: `ctrader-${brokerOrderId}`,
      broker: 'CTRADER',
      environment: this.environment,
      market: 'FOREX',
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      price: submitted.executionPrice ?? order.price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      status: submitted.status,
      filledQuantity: submitted.executedVolume ?? 0,
      averageFillPrice: submitted.executionPrice,
      commission: undefined,
      timestamp: Date.now(),
      brokerOrderId,
      strategyId: order.strategyId,
      signalId: order.signalId
    };

    this.logAction('PLACE_ORDER', 'SUCCESS', this.config.accountId || '', {
      symbol: order.symbol,
      quantity: order.quantity
    });

    return normalized;
  }

  async modifyOrder(orderId: string, modifications: OrderModification): Promise<NormalizedOrder> {
    this.syncConfig();
    this.validateCredentials();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', 'cTrader lifecycle actions require LIVE.', 'CTRADER', this.environment);
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(orderId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader broker order ID.', 'CTRADER', this.environment);

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const brokerOrder = state.orders.find((o: any) => Number(o.orderId) === brokerId);
    if (!brokerOrder) throw new BrokerError('ORDER_REJECTED', 'cTrader pending order was not found in authoritative broker state.', 'CTRADER', this.environment);

    const brokerOrderType = String(brokerOrder.orderType || '').toUpperCase();
    const result = await amendLiveCTraderOrder(raw.ctidTraderAccountId, brokerId, {
      volume: modifications.quantity,
      limitPrice: brokerOrderType.includes('LIMIT') ? modifications.price : undefined,
      stopPrice: brokerOrderType.includes('STOP') ? modifications.price : undefined,
      stopLoss: modifications.stopLoss,
      takeProfit: modifications.takeProfit
    }, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);

    if (![2,3,4].includes(result.executionType)) {
      throw new BrokerError('ORDER_REJECTED', 'cTrader did not confirm the order amendment.', 'CTRADER', this.environment);
    }

    const refreshed = await this.getOpenOrders();
    const updated = refreshed.find(o => Number(o.brokerOrderId) === brokerId);
    if (updated) return updated;
    throw new BrokerError('ORDER_REJECTED', 'cTrader accepted the amendment but authoritative order state did not contain the order.', 'CTRADER', this.environment);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    this.syncConfig();
    this.validateCredentials();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', 'cTrader lifecycle actions require LIVE.', 'CTRADER', this.environment);
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(orderId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader broker order ID.', 'CTRADER', this.environment);

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    if (!state.orders.some((o: any) => Number(o.orderId) === brokerId)) return false;

    const result = await cancelLiveCTraderOrder(raw.ctidTraderAccountId, brokerId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    if (result.executionType !== 5) throw new BrokerError('ORDER_REJECTED', 'cTrader did not confirm order cancellation.', 'CTRADER', this.environment);
    return true;
  }

  async closePosition(positionId: string, quantity?: number): Promise<boolean> {
    this.syncConfig();
    this.validateCredentials();
    if (!this.isLive) throw new BrokerError('ENVIRONMENT_MISMATCH', 'cTrader lifecycle actions require LIVE.', 'CTRADER', this.environment);
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(positionId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader position ID.', 'CTRADER', this.environment);

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const position = state.positions.find((p: any) => Number(p.positionId) === brokerId);
    if (!position) return false;
    const rawVolume = Number(position.tradeData?.volume ?? position.volume ?? 0);
    const available = rawVolume / 100;
    const closeQty = quantity === undefined ? available : Math.min(Number(quantity), available);
    if (!Number.isFinite(closeQty) || closeQty <= 0) throw new BrokerError('INVALID_QUANTITY', 'Invalid cTrader close quantity.', 'CTRADER', this.environment);

    const result = await closeLiveCTraderPosition(raw.ctidTraderAccountId, brokerId, closeQty, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    if (![2,3,11].includes(result.executionType)) throw new BrokerError('ORDER_REJECTED', 'cTrader did not confirm the position close request.', 'CTRADER', this.environment);
    return true;
  }


  async getOrderStatus(orderId: string): Promise<NormalizedOrder> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const brokerId = Number(String(orderId).replace(/^ctrader-/, ''));
    if (!Number.isSafeInteger(brokerId) || brokerId <= 0) {
      throw new BrokerError('ORDER_REJECTED', 'Invalid cTrader broker order ID.', 'CTRADER', this.environment);
    }

    const state = await fetchCTraderReconcileState(raw.ctidTraderAccountId, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const liveOrder = state.orders.find((o: any) => Number(o.orderId) === brokerId);
    if (liveOrder) {
      const orders = await this.getOpenOrders();
      const normalized = orders.find(o => Number(o.brokerOrderId) === brokerId);
      if (normalized) return normalized;
    }

    const deals = await fetchCTraderDeals(raw.ctidTraderAccountId, Date.now() - 7 * 24 * 60 * 60 * 1000, Date.now(), this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
    const matchingDeals = deals
      .filter((d: any) => Number(d.orderId) === brokerId)
      .sort((a: any, b: any) => Number(a.executionTimestamp || a.createTimestamp || 0) - Number(b.executionTimestamp || b.createTimestamp || 0));

    if (matchingDeals.length === 0) {
      throw new BrokerError('ORDER_REJECTED', `cTrader order ${brokerId} was not found in authoritative broker state.`, 'CTRADER', this.environment);
    }

    // One cTrader order can produce multiple execution deals when liquidity
    // fills it in pieces. Aggregate the authoritative deals rather than using
    // only the latest deal, otherwise a later partial fill can overwrite the
    // cumulative fill with a smaller quantity.
    const requestedVolume = matchingDeals.reduce(
      (sum: number, deal: any) => sum + Math.max(0, Number(deal.volume || 0)),
      0
    ) / 100;
    const filledVolume = matchingDeals.reduce(
      (sum: number, deal: any) => sum + Math.max(0, Number(deal.filledVolume || 0)),
      0
    ) / 100;
    const weightedPriceNumerator = matchingDeals.reduce(
      (sum: number, deal: any) => {
        const filled = Math.max(0, Number(deal.filledVolume || 0)) / 100;
        const executionPrice = Number(deal.executionPrice || 0);
        return sum + (filled > 0 && executionPrice > 0 ? filled * executionPrice : 0);
      },
      0
    );
    const averageFillPrice = filledVolume > 0 && weightedPriceNumerator > 0
      ? weightedPriceNumerator / filledVolume
      : undefined;
    const latestDeal = matchingDeals[matchingDeals.length - 1];
    const hasFilledDeal = matchingDeals.some((d: any) => Number(d.dealStatus) === 2 || Number(d.filledVolume || 0) > 0);
    const hasRejectedDeal = matchingDeals.some((d: any) => [4, 5, 6, 7].includes(Number(d.dealStatus)));
    const status = requestedVolume > 0 && filledVolume >= requestedVolume
      ? 'FILLED'
      : filledVolume > 0
        ? 'PARTIALLY_FILLED'
        : hasRejectedDeal
          ? 'REJECTED'
          : hasFilledDeal
            ? 'PARTIALLY_FILLED'
            : 'ACCEPTED';

    return {
      id: String(brokerId),
      broker: 'CTRADER',
      environment: this.environment,
      market: 'FOREX',
      symbol: String(latestDeal.symbolId),
      side: Number(latestDeal.tradeSide) === 2 ? 'SELL' : 'BUY',
      orderType: 'MARKET',
      quantity: requestedVolume > 0 ? requestedVolume : filledVolume,
      price: Number(latestDeal.executionPrice || 0) > 0 ? Number(latestDeal.executionPrice) : undefined,
      status,
      filledQuantity: filledVolume,
      averageFillPrice,
      commission: matchingDeals.reduce((sum: number, deal: any) => sum + (Number(deal.commission || 0) || 0), 0) || undefined,
      timestamp: Number(latestDeal.executionTimestamp || latestDeal.utcLastUpdateTimestamp || Date.now()),
      brokerOrderId: String(brokerId)
    };
  }
}
