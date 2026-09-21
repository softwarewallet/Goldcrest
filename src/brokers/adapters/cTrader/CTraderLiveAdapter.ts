import { CTraderBrokerAdapter, CTraderConfig } from './CTraderBrokerAdapter';
import { NormalizedOrder, OrderRequest, TradingEnvironment } from '../../types';
import { BrokerError } from '../../errors';
import { normalizePriceToInstrumentDigits, sizeForexOrderToMaxTradeValue } from '../../safety/TradeSizing';

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
      apiHost: customConfig?.apiHost ?? process.env.CTRADER_LIVE_API_HOST ?? 'https://live.ctraderapi.com'
    };
    super(config);
  }

  override syncConfig(): void {
    if (!this.config.clientId && process.env.CTRADER_LIVE_CLIENT_ID) {
      this.config.clientId = process.env.CTRADER_LIVE_CLIENT_ID;
    }
    if (!this.config.clientSecret && process.env.CTRADER_LIVE_CLIENT_SECRET) {
      this.config.clientSecret = process.env.CTRADER_LIVE_CLIENT_SECRET;
    }
    if (!this.config.accessToken && process.env.CTRADER_LIVE_ACCESS_TOKEN) {
      this.config.accessToken = process.env.CTRADER_LIVE_ACCESS_TOKEN;
    }
    if (!this.config.accountId && process.env.CTRADER_LIVE_ACCOUNT_ID) {
      this.config.accountId = process.env.CTRADER_LIVE_ACCOUNT_ID;
    }
    super.syncConfig();
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
      apiHost: process.env.CTRADER_LIVE_API_HOST ?? 'https://live.ctraderapi.com'
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

  /**
   * Final cTrader LIVE sizing boundary.
   *
   * Even when a caller supplies quantity=1 (or any other value), the live
   * order is force-sized from maxTradeValueForexUsd / executable price before
   * the broker packet is constructed. This is intentionally repeated at the
   * adapter boundary so no direct cTrader caller can bypass the max-value rule.
   */
  private async enforceMaxTradeValueSizing(order: OrderRequest): Promise<void> {
    // Hard requirement: every live order must request a trailing stop loss.
    // Do not allow callers, signals, or UI state to disable this control.
    order.trailingStopLoss = true;

    if (order.market !== 'FOREX') return;

    const instrument = await this.getInstrument(order.symbol);
    if (!instrument) {
      throw new BrokerError(
        'INVALID_SYMBOL',
        `Live broker instrument metadata unavailable for ${order.symbol}.`,
        'CTRADER',
        this.environment
      );
    }

    let executionPrice = Number(order.price || 0);
    if (!(executionPrice > 0) || !Number.isFinite(executionPrice)) {
      const quote = await this.getQuote(order.symbol);
      if (quote.status !== 'FRESH' || !(quote.bid > 0 && quote.ask > 0)) {
        throw new BrokerError(
          'STALE_DATA',
          `Fresh live quote unavailable for ${order.symbol}; max-trade-value sizing cannot be calculated safely.`,
          'CTRADER',
          this.environment
        );
      }
      executionPrice = order.side === 'BUY' ? quote.ask : quote.bid;
    }

    // cTrader validates every submitted price field against the symbol's
    // authoritative decimal precision. Normalize BEFORE sizing so the notional
    // calculation uses the exact executable price that will be sent to cTrader.
    const normalizedExecutionPrice = normalizePriceToInstrumentDigits(
      executionPrice,
      instrument.digits
    );

    const sizing = await sizeForexOrderToMaxTradeValue(
      this,
      order.symbol,
      normalizedExecutionPrice,
      instrument,
      Number(order.quantity)
    );

    // Normalize every broker-facing price field at the final LIVE boundary.
    // Signals may arrive with 5 decimals for all FX pairs, while JPY crosses
    // commonly allow only 3 (e.g. 157.711, not 157.71077).
    order.quantity = sizing.quantity;
    order.price = normalizedExecutionPrice;
    if (order.stopLoss !== undefined && order.stopLoss > 0) {
      order.stopLoss = normalizePriceToInstrumentDigits(order.stopLoss, instrument.digits);
    }
    if (order.takeProfit !== undefined && order.takeProfit > 0) {
      order.takeProfit = normalizePriceToInstrumentDigits(order.takeProfit, instrument.digits);
    }

    this.logAction('FORCE_MAX_TRADE_VALUE_SIZING', 'SUCCESS', this.config.accountId || '', {
      symbol: order.symbol,
      quantity: sizing.quantity,
      price: executionPrice
    });
  }

  // Direct broker-route orders remain explicitly blocked. The autonomous
  // execution engine uses placeAutonomousOrder() only after its own gates pass.
  override async placeOrder(order: OrderRequest): Promise<NormalizedOrder> {
    await this.enforceMaxTradeValueSizing(order);
    return super.placeOrder(order);
  }

  async placeAutonomousOrder(order: OrderRequest): Promise<NormalizedOrder> {
    await this.enforceMaxTradeValueSizing(order);
    return super.placeOrder(order);
  }
}
