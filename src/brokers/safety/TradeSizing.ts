import { BrokerAdapter, BrokerInstrument } from '../types';
import { getSystemConfig } from '../../services/configService';

export interface ForexSizingResult {
  requestedQuantity: number;
  quantity: number;
  rawMaxQuantity: number;
  maxTradeValueUsd: number;
  estimatedTradeValueUsd: number;
  quoteToUsdRate: number;
  quoteCurrency: string;
  adjusted: boolean;
  brokerMaximumQuantity: number;
}

/**
 * Normalize a broker-facing price to the exact decimal precision allowed by
 * the live instrument. Number(toFixed()) removes both excess decimals and
 * binary floating-point residue before the value reaches cTrader.
 */
export function normalizePriceToInstrumentDigits(price: number, digits: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('INVALID_PRICE: Price must be a positive finite number.');
  }
  if (!Number.isInteger(digits) || digits < 0 || digits > 10) {
    throw new Error('INVALID_PRICE: Instrument price precision is invalid.');
  }
  return Number(price.toFixed(digits));
}

function getForexQuoteCurrency(symbol: string, instrument: BrokerInstrument): string {
  if (instrument.quoteCurrency) return instrument.quoteCurrency.toUpperCase();
  const compact = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  return compact.length === 6 ? compact.slice(3) : '';
}

/**
 * Calculates the executable Forex quantity from the configured maximum trade
 * value, using the live execution price as the denominator:
 *
 *   quantity = maximum trade value / price
 *
 * When the pair quote currency is not USD, the live quote is first converted to
 * USD so the configured maxTradeValueForexUsd remains a true USD notional cap.
 *
 * The incoming/requested quantity is intentionally NOT an upper bound. It is
 * retained only for audit/telemetry so a caller cannot accidentally submit a
 * quantity such as 1 and bypass the configured maximum-trade-value sizing.
 * The broker minimum/step constraints are deliberately NOT enforced locally.
 * If cTrader rejects the calculated quantity because of broker-side volume
 * rules, the live order submission path surfaces that broker response instead
 * of inventing a larger order to satisfy a local minimum.
 */
export async function sizeForexOrderToMaxTradeValue(
  adapter: BrokerAdapter,
  symbol: string,
  price: number,
  instrument: BrokerInstrument,
  requestedQuantity: number
): Promise<ForexSizingResult> {
  const config = getSystemConfig();
  const maxTradeValueUsd = Number(config.maxTradeValueForexUsd);
  const requested = Number.isFinite(Number(requestedQuantity)) && Number(requestedQuantity) > 0
    ? Number(requestedQuantity)
    : 0;

  if (!(maxTradeValueUsd > 0) || !Number.isFinite(maxTradeValueUsd)) {
    throw new Error('MAX_TRADE_VALUE_INVALID: Configured maximum Forex trade value must be a positive finite USD amount.');
  }
  if (!(price > 0) || !Number.isFinite(price)) {
    throw new Error('MAX_TRADE_VALUE_INVALID: A fresh positive execution price is required for Forex position sizing.');
  }

  const quoteCurrency = getForexQuoteCurrency(symbol, instrument);
  if (!quoteCurrency) {
    throw new Error(`MAX_TRADE_VALUE_UNVERIFIABLE: Unable to determine quote currency for ${symbol}.`);
  }

  let quoteToUsdRate = 1;
  if (quoteCurrency !== 'USD') {
    if (typeof adapter.getAccountCurrencyConversionRate !== 'function') {
      throw new Error(`MAX_TRADE_VALUE_UNVERIFIABLE: USD conversion for ${quoteCurrency} is unavailable.`);
    }
    quoteToUsdRate = await adapter.getAccountCurrencyConversionRate(quoteCurrency, 'USD');
    if (!(quoteToUsdRate > 0) || !Number.isFinite(quoteToUsdRate)) {
      throw new Error(`MAX_TRADE_VALUE_UNVERIFIABLE: Invalid ${quoteCurrency}/USD conversion rate.`);
    }
  }

  // The execution value of one base-currency unit, expressed in USD.
  const valuePerBaseUnitUsd = price * quoteToUsdRate;

  // FORCE the quantity from the configured maximum trade value. Do not cap this
  // calculation by the caller's requested quantity.
  const rawMaxQuantity = maxTradeValueUsd / valuePerBaseUnitUsd;

  const maximum = Number(instrument.maxQuantity);
  if (!(maximum > 0) || !Number.isFinite(maximum)) {
    throw new Error(`MAX_TRADE_VALUE_INVALID: Broker maximum quantity for ${symbol} is unavailable.`);
  }

  // Forex order quantities are whole base-currency units. Always remove the
  // fractional remainder so the submitted order can never exceed the configured
  // notional cap because of a fractional quantity.
  //
  // Example: 7.65 -> 7.
  // Broker min/step rules are still not enforced locally; cTrader remains the
  // authority for whether the integer quantity is executable.
  const quantity = Math.min(maximum, Math.floor(rawMaxQuantity));
  if (!(quantity > 0) || !Number.isFinite(quantity)) {
    throw new Error(`MAX_TRADE_VALUE_INVALID: Calculated Forex quantity for ${symbol} is invalid.`);
  }

  const estimatedTradeValueUsd = quantity * valuePerBaseUnitUsd;

  // Final invariant: no live order may leave this function above the configured
  // notional cap, even because of floating-point noise.
  if (estimatedTradeValueUsd > maxTradeValueUsd + 1e-8) {
    throw new Error(
      `MAX_TRADE_VALUE_EXCEEDED: Calculated Forex trade value ${estimatedTradeValueUsd.toFixed(2)} USD exceeds configured maximum ${maxTradeValueUsd.toFixed(2)} USD.`
    );
  }

  return {
    requestedQuantity: requested,
    quantity,
    rawMaxQuantity,
    maxTradeValueUsd,
    estimatedTradeValueUsd,
    quoteToUsdRate,
    quoteCurrency,
    adjusted: Math.abs(quantity - requested) > 1e-9,
    brokerMaximumQuantity: maximum
  };
}
