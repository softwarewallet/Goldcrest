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
  NormalizedFill,
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
  fetchCTraderOrderDetails,
  fetchCTraderAssets,
  fetchCTraderConversionSymbols,
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
  environment: 'LIVE';
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
  // Conversion metadata changes far less frequently than live prices. Cache the
  // broker-provided asset map and conversion topology, while still fetching fresh
  // quotes for every risk decision.
  private conversionAssetCache: { expiresAt: number; assets: Awaited<ReturnType<typeof fetchCTraderAssets>> } | null = null;
  private conversionChainCache = new Map<string, { expiresAt: number; chain: Awaited<ReturnType<typeof fetchCTraderConversionSymbols>> }>();
  private static readonly CONVERSION_METADATA_TTL_MS = 5 * 60 * 1000;
  // Account identity and symbol metadata are stable over short trading windows.
  // Re-fetching them for every candle/quote request created dozens of extra
  // authenticated WebSocket sessions during Auto Live preparation.
  private rawAccountCache: { expiresAt: number; account: CTraderRawAccount } | null = null;
  private symbolCache: { expiresAt: number; accountKey: string; symbols: Awaited<ReturnType<typeof fetchCTraderSymbols>> } | null = null;
  private static readonly RAW_ACCOUNT_CACHE_TTL_MS = 60 * 1000;
  private static readonly SYMBOL_CACHE_TTL_MS = 5 * 60 * 1000;

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
    // If the global config has a selected account ID, override the adapter's accountId.
    // Conversion metadata is account-scoped, so invalidate it if the selected
    // account changes during the lifetime of this adapter instance.
    if (globalConfig.selectedCtraderAccountId) {
      const previousAccountId = this.config.accountId;
      this.config.accountId = globalConfig.selectedCtraderAccountId;
      if (previousAccountId !== this.config.accountId) {
        this.conversionAssetCache = null;
        this.conversionChainCache.clear();
        this.rawAccountCache = null;
        this.symbolCache = null;
      }
    }
  }

  protected getApiHost(): string {
    if (this.config.apiHost) return this.config.apiHost;
    return 'https://live.ctraderapi.com';
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
        accountType: 'LIVE',
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
   * Never injects fabricated fallback accounts.
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
        'live'
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
            accountType: 'LIVE',
            balance: details.balance,
            equity: details.equity,
            availableMargin: details.availableMargin,
            usedMargin: details.usedMargin,
            freeMargin: details.freeMargin,
            currency: details.currency,
            broker: 'CTRADER',
            environment: this.environment,
            connectionStatus: 'CONNECTED',
            server: details.brokerName || raw.brokerTitleShort || 'cTrader-Live',
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
        'live'
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
        accountType: 'LIVE',
        balance: details.balance,
        equity: details.equity,
        availableMargin: details.availableMargin,
        usedMargin: details.usedMargin,
        freeMargin: details.freeMargin,
        currency: details.currency,
        broker: 'CTRADER',
        environment: this.environment,
        connectionStatus: 'CONNECTED',
        server: details.brokerName || matched.brokerTitleShort || 'cTrader-Live',
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

  /**
   * Converts a Forex base-currency notional into the cTrader account deposit
   * currency using cTrader's native asset conversion-chain API. This avoids
   * assuming that every currency pair exists as a directly tradable symbol.
   * The returned rate is based on authoritative live broker quotes and fails
   * closed if any required conversion leg is unavailable or stale.
   */
  async getAccountCurrencyConversionRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const from = String(fromCurrency || '').trim().toUpperCase();
    const to = String(toCurrency || '').trim().toUpperCase();
    if (!from || !to) throw new Error('Currency conversion requires both source and target currencies.');
    if (from === to) return 1;

    const raw = await this.resolveRawAccount();
    const { clientId, clientSecret, accessToken } = this.config;
    if (!clientId || !clientSecret || !accessToken) throw new Error('cTrader credentials unavailable for currency conversion.');

    const now = Date.now();
    let assets: Awaited<ReturnType<typeof fetchCTraderAssets>>;
    if (this.conversionAssetCache && this.conversionAssetCache.expiresAt > now) {
      assets = this.conversionAssetCache.assets;
    } else {
      assets = await fetchCTraderAssets(raw.ctidTraderAccountId, clientId, clientSecret, accessToken, raw.isLive);
      this.conversionAssetCache = {
        assets,
        expiresAt: now + CTraderBrokerAdapter.CONVERSION_METADATA_TTL_MS
      };
    }
    const assetByName = new Map(assets.map(asset => [asset.name.toUpperCase(), asset.assetId]));
    const firstAssetId = assetByName.get(from);
    const lastAssetId = assetByName.get(to);
    if (firstAssetId === undefined || lastAssetId === undefined) {
      throw new Error(`cTrader asset ID unavailable for ${from} to ${to} conversion.`);
    }

    const chainKey = `${raw.ctidTraderAccountId}:${firstAssetId}:${lastAssetId}`;
    const cachedChain = this.conversionChainCache.get(chainKey);
    const chain = cachedChain && cachedChain.expiresAt > now
      ? cachedChain.chain
      : await fetchCTraderConversionSymbols(
          raw.ctidTraderAccountId,
          firstAssetId,
          lastAssetId,
          clientId,
          clientSecret,
          accessToken,
          raw.isLive
        );
    if (!cachedChain || cachedChain.expiresAt <= now) {
      this.conversionChainCache.set(chainKey, {
        chain,
        expiresAt: now + CTraderBrokerAdapter.CONVERSION_METADATA_TTL_MS
      });
    }
    if (chain.length === 0) throw new Error(`cTrader returned no conversion chain for ${from} to ${to}.`);

    let rate = 1;
    let currentAssetId = firstAssetId;
    for (const leg of chain) {
      const baseAssetId = leg.baseAssetId;
      const quoteAssetId = leg.quoteAssetId;
      if (baseAssetId === undefined || quoteAssetId === undefined) {
        throw new Error(`cTrader conversion leg ${leg.symbolName} is missing asset direction metadata.`);
      }

      const quote = await this.getQuote(leg.symbolName);
      if (quote.status === 'STALE' || !(quote.bid > 0 && quote.ask > 0)) {
        throw new Error(`Authoritative live quote unavailable for conversion leg ${leg.symbolName}.`);
      }

      if (baseAssetId === currentAssetId) {
        // Selling the source/base asset into the next asset uses bid.
        rate *= quote.bid;
        currentAssetId = quoteAssetId;
      } else if (quoteAssetId === currentAssetId) {
        // Converting the current asset through a reversed pair requires buying
        // the pair's base asset, so use ask and divide.
        rate /= quote.ask;
        currentAssetId = baseAssetId;
      } else {
        throw new Error(`cTrader conversion chain is discontinuous at ${leg.symbolName}.`);
      }
    }

    if (currentAssetId !== lastAssetId || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`cTrader conversion chain did not resolve ${from} to ${to}.`);
    }
    return rate;
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
    const cached = this.rawAccountCache;
    if (cached && cached.expiresAt > Date.now()) {
      if (!accountId
        || String(cached.account.traderLogin) === String(accountId)
        || String(cached.account.ctidTraderAccountId) === String(accountId)) {
        return cached.account;
      }
    }

    const liveAccounts = await fetchLiveCTraderAccounts(
      clientId!,
      clientSecret!,
      accessToken!,
      'live'
    );
    if (!liveAccounts || liveAccounts.length === 0) {
      throw new BrokerError('ACCOUNT_NOT_FOUND', 'No cTrader accounts found.', 'CTRADER', this.environment);
    }

    let matched: CTraderRawAccount | undefined;
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

    this.rawAccountCache = {
      account: matched,
      expiresAt: Date.now() + CTraderBrokerAdapter.RAW_ACCOUNT_CACHE_TTL_MS
    };
    return matched;
  }

  private async getCachedCTraderSymbols(raw: CTraderRawAccount): Promise<Awaited<ReturnType<typeof fetchCTraderSymbols>>> {
    const accountKey = String(raw.ctidTraderAccountId);
    const cached = this.symbolCache;
    if (cached && cached.expiresAt > Date.now() && cached.accountKey === accountKey) {
      return cached.symbols;
    }

    const symbols = await this.getCachedCTraderSymbols(raw);
    this.symbolCache = {
      accountKey,
      symbols,
      expiresAt: Date.now() + CTraderBrokerAdapter.SYMBOL_CACHE_TTL_MS
    };
    return symbols;
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
    const symbols = await this.getCachedCTraderSymbols(raw);
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
    const toTimestamp = Date.now();
    return this.getOrderHistoryRange(toTimestamp - 7 * 24 * 60 * 60 * 1000, toTimestamp);
  }

  async getOrderHistoryRange(fromTimestamp: number, toTimestamp: number): Promise<NormalizedOrder[]> {
    this.syncConfig();
    this.validateCredentials();
    const raw = await this.resolveRawAccount();
    const safeFrom = Math.max(0, Number(fromTimestamp));
    const safeTo = Math.max(safeFrom, Number(toTimestamp));
    const deals = await fetchCTraderDeals(raw.ctidTraderAccountId, safeFrom, safeTo, this.config.clientId!, this.config.clientSecret!, this.config.accessToken!, raw.isLive);
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
      const instruments = await this.getCachedCTraderSymbols(raw);
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
      const symbols = await this.getCachedCTraderSymbols(raw);
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


  async getOrderStatus(orderId: string, requestedQuantity?: number): Promise<NormalizedOrder> {
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
      // A pending order has no execution events to reconcile. Once any volume
      // is filled, continue to the authoritative deal ledger so every broker
      // execution can be persisted by its native deal ID.
      if (normalized && Number(normalized.filledQuantity || 0) <= 0) return normalized;
    }

    let historicalOrderStatus: number | undefined;
    let historicalOrder: any | null = null;
    let matchingDeals: any[] = [];
    try {
      const details = await fetchCTraderOrderDetails(
        raw.ctidTraderAccountId,
        brokerId,
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
      if (details.order) {
        historicalOrder = details.order;
        historicalOrderStatus = Number(details.order.orderStatus);
        matchingDeals = Array.isArray(details.deals) ? details.deals : [];
      }
    } catch {
      // Fall back to the deal history endpoint below. The deal ledger still
      // provides authoritative fill quantities and prices when order details
      // are temporarily unavailable.
    }

    if (matchingDeals.length === 0 && !historicalOrder) {
      const deals = await fetchCTraderDeals(
        raw.ctidTraderAccountId,
        Date.now() - 7 * 24 * 60 * 60 * 1000,
        Date.now(),
        this.config.clientId!,
        this.config.clientSecret!,
        this.config.accessToken!,
        raw.isLive
      );
      matchingDeals = deals
        .filter((d: any) => Number(d.orderId) === brokerId)
        .sort((a: any, b: any) => Number(a.executionTimestamp || a.createTimestamp || 0) - Number(b.executionTimestamp || b.createTimestamp || 0));
    }

    if (matchingDeals.length === 0 && !historicalOrder) {
      throw new BrokerError('ORDER_REJECTED', `cTrader order ${brokerId} was not found in authoritative broker state.`, 'CTRADER', this.environment);
    }

    // One cTrader order can produce multiple execution deals when liquidity
    // fills it in pieces. Aggregate the authoritative deals rather than using
    // only the latest deal, otherwise a later partial fill can overwrite the
    // cumulative fill with a smaller quantity.
    const brokerReportedVolume = matchingDeals.reduce(
      (sum: number, deal: any) => sum + Math.max(0, Number(deal.volume || 0)),
      0
    ) / 100;
    const requestedVolume = Number(requestedQuantity || 0) > 0
      ? Number(requestedQuantity)
      : brokerReportedVolume;
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
    const latestDeal = matchingDeals.length > 0
      ? matchingDeals[matchingDeals.length - 1]
      : {
          symbolId: historicalOrder?.tradeData?.symbolId,
          tradeSide: historicalOrder?.tradeData?.tradeSide,
          executionPrice: historicalOrder?.executionPrice,
          executionTimestamp: historicalOrder?.utcLastUpdateTimestamp || historicalOrder?.tradeData?.openTimestamp,
          dealStatus: historicalOrderStatus,
          dealId: undefined,
          commission: undefined
        };
    const symbols = await fetchCTraderSymbols(
      raw.ctidTraderAccountId,
      this.config.clientId!,
      this.config.clientSecret!,
      this.config.accessToken!,
      raw.isLive
    );
    const symbolInfo = symbols.find(s => Number(s.symbolId) === Number(latestDeal.symbolId));
    const normalizedSymbol = symbolInfo?.symbolName || String(latestDeal.symbolId);
    const fillEvents: NormalizedFill[] = matchingDeals
      .filter((deal: any) => Number(deal.filledVolume || 0) > 0 && deal.dealId !== undefined && Number(deal.executionPrice || 0) > 0)
      .map((deal: any) => ({
        brokerFillId: String(deal.dealId),
        brokerOrderId: String(brokerId),
        quantity: Math.max(0, Number(deal.filledVolume || 0)) / 100,
        price: Number(deal.executionPrice),
        commission: Number(deal.commission || 0) || undefined,
        timestamp: Number(deal.executionTimestamp || deal.utcLastUpdateTimestamp || deal.createTimestamp || Date.now())
      }));
    const hasFilledDeal = matchingDeals.some((d: any) => Number(d.dealStatus) === 2 || Number(d.filledVolume || 0) > 0);
    const hasRejectedDeal = matchingDeals.some((d: any) => [4, 5, 6, 7].includes(Number(d.dealStatus)));
    const statusFromOrder = historicalOrderStatus === 2
      ? 'FILLED'
      : historicalOrderStatus === 3
        ? 'REJECTED'
        : historicalOrderStatus === 4
          ? 'EXPIRED'
          : historicalOrderStatus === 5
            ? 'CANCELLED'
            : historicalOrderStatus === 1
              ? 'ACCEPTED'
              : undefined;
    const status = statusFromOrder || (
      requestedVolume > 0 && filledVolume >= requestedVolume
        ? 'FILLED'
        : filledVolume > 0
          ? 'PARTIALLY_FILLED'
          : hasRejectedDeal
            ? 'REJECTED'
            : hasFilledDeal
              ? 'PARTIALLY_FILLED'
              : 'ACCEPTED'
    );

    return {
      id: String(brokerId),
      broker: 'CTRADER',
      environment: this.environment,
      market: 'FOREX',
      symbol: normalizedSymbol,
      side: Number(latestDeal.tradeSide) === 2 ? 'SELL' : 'BUY',
      orderType: 'MARKET',
      quantity: requestedVolume > 0 ? requestedVolume : filledVolume,
      price: Number(latestDeal.executionPrice || 0) > 0 ? Number(latestDeal.executionPrice) : undefined,
      status,
      filledQuantity: filledVolume,
      averageFillPrice,
      commission: matchingDeals.reduce((sum: number, deal: any) => sum + (Number(deal.commission || 0) || 0), 0) || undefined,
      timestamp: Number(latestDeal.executionTimestamp || latestDeal.utcLastUpdateTimestamp || Date.now()),
      brokerOrderId: String(brokerId),
      fillEvents
    };
  }
}
