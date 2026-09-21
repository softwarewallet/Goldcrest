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
  brokerMinimumQuantity: number;
  brokerStepQuantity: number;
}

/**
 * Normalize a broker-facing price to the exact decimal precision allowed by
 * the live instrument. Number(toFixed()) removes both excess decimals and
 * binary floating-point residue before the value reaches cTrader.
 */
/**
 * Goldcrest-wide broker price precision policy.
 *
 * Every executable/order price is normalized to exactly the maximum of three
 * decimal places, irrespective of the symbol's broker-reported precision.
 * This is intentionally centralized so no execution path can send a 4th+
 * decimal place to a broker.
 */
export const GOLD_CREST_PRICE_DIGITS = 3;

export function normalizePriceToThreeDigits(price: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('INVALID_PRICE: Price must be a positive finite number.');
  }
  return Number(price.toFixed(GOLD_CREST_PRICE_DIGITS));
}

/**
 * Backward-compatible name used by existing execution code. The global
 * three-digit policy intentionally ignores broker/symbol precision.
 */
export function normalizePriceToInstrumentDigits(price: number, _digits?: number): number {
  return normalizePriceToThreeDigits(price);
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
 * Broker volume constraints are authoritative execution metadata. They are
 * expressed by cTrader in protocol cents (1/100 of a base-currency unit) and
 * are normalized into base-currency units by the cTrader adapter. Goldcrest
 * quantizes the calculated quantity DOWN to the broker step so the order
 * remains at or below the configured notional cap while still producing a
 * broker-valid volume. It never rounds UP to satisfy a minimum because that
 * could exceed the maximum trade-value limit.
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

  const minimum = Number(instrument.minQuantity);
  const step = Number(instrument.stepQuantity);
  if (!(minimum > 0) || !Number.isFinite(minimum)) {
    throw new Error(
      `MAX_TRADE_VALUE_INVALID: Broker minimum quantity for ${symbol} is unavailable.`
    );
  }
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new Error(
      `MAX_TRADE_VALUE_INVALID: Broker volume step for ${symbol} is unavailable.`
    );
  }

  // cTrader volume is an integer number of 0.01 base-currency units.
  // Work in protocol cents rather than floating-point units so values such as
  // 0.01, 0.02 and 0.09 are represented exactly and values such as 0.015 can
  // never reach the broker.
  const minimumVolumeCents = Math.max(1, Math.round(minimum * 100));
  const stepVolumeCents = Math.max(1, Math.round(step * 100));
  const maximumVolumeCents = Math.max(1, Math.floor(maximum * 100));
  const rawMaxVolumeCents = Math.max(0, Math.floor(rawMaxQuantity * 100 + 1e-9));
  const boundedRawVolumeCents = Math.min(maximumVolumeCents, rawMaxVolumeCents);

  // cTrader's min/step are broker-authoritative. Quantize DOWN from the
  // maximum affordable volume. Never round up because doing so could violate
  // maxTradeValueForexUsd.
  const quantityVolumeCents =
    Math.floor(boundedRawVolumeCents / stepVolumeCents) * stepVolumeCents;

  if (quantityVolumeCents < minimumVolumeCents) {
    throw new Error(
      `MAX_TRADE_VALUE_INVALID: Calculated Forex quantity for ${symbol} cannot satisfy the broker minimum volume of ${minimum.toFixed(2)} units without exceeding the configured maximum trade value of ${maxTradeValueUsd.toFixed(2)} USD.`
    );
  }

  const quantity = quantityVolumeCents / 100;
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
    brokerMaximumQuantity: maximum,
    brokerMinimumQuantity: minimum,
    brokerStepQuantity: step
  };
}
