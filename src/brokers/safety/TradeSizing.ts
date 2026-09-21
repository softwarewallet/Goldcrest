import { BrokerAdapter, BrokerInstrument } from '../types';
import { getSystemConfig } from '../../services/configService';

export interface ForexSizingResult {
  requestedQuantity: number;
  quantity: number;
  maxTradeValueUsd: number;
  estimatedTradeValueUsd: number;
  quoteToUsdRate: number;
  quoteCurrency: string;
  adjusted: boolean;
  brokerMinimumQuantity: number;
  brokerStepQuantity: number;
}

function floorToStep(quantity: number, step: number): number {
  if (!(quantity > 0) || !(step > 0)) return 0;
  return Math.floor((quantity + Number.EPSILON) / step) * step;
}

function getForexQuoteCurrency(symbol: string, instrument: BrokerInstrument): string {
  if (instrument.quoteCurrency) return instrument.quoteCurrency.toUpperCase();
  const compact = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  return compact.length === 6 ? compact.slice(3) : '';
}

/**
 * Calculates the largest broker-valid Forex quantity that does not exceed the
 * configured USD notional limit. Quantity is expressed in base-currency units,
 * which is the normalized unit used by the broker adapters.
 *
 * The requested quantity is treated as an upper bound (for example, a
 * risk-based quantity). It is never allowed to increase the quantity above the
 * configured maximum-trade-value quantity.
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
  const requested = Number(requestedQuantity);

  if (!(maxTradeValueUsd > 0) || !Number.isFinite(maxTradeValueUsd)) {
    throw new Error('MAX_TRADE_VALUE_INVALID: Configured maximum Forex trade value must be a positive finite USD amount.');
  }
  if (!(price > 0) || !Number.isFinite(price)) {
    throw new Error('MAX_TRADE_VALUE_INVALID: A fresh positive execution price is required for Forex position sizing.');
  }
  if (!(requested > 0) || !Number.isFinite(requested)) {
    throw new Error('INVALID_QUANTITY: Requested Forex quantity must be positive before position sizing.');
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

  const valuePerBaseUnitUsd = price * quoteToUsdRate;
  const rawMaxQuantity = maxTradeValueUsd / valuePerBaseUnitUsd;
  const step = Number(instrument.stepQuantity);
  const minimum = Number(instrument.minQuantity);
  const maximum = Number(instrument.maxQuantity);

  if (!(step > 0) || !(minimum > 0) || !(maximum > 0)) {
    throw new Error(`MAX_TRADE_VALUE_INVALID: Broker quantity constraints for ${symbol} are unavailable.`);
  }

  // Always round DOWN. Never round a trade up to the broker minimum because
  // doing so could violate the operator's configured maximum notional.
  const maxAllowedByValue = Math.min(maximum, floorToStep(rawMaxQuantity, step));

  if (maxAllowedByValue < minimum) {
    const minimumTradeValueUsd = minimum * valuePerBaseUnitUsd;
    throw new Error(
      `MAX_TRADE_VALUE_BELOW_BROKER_MINIMUM: Configured maximum ${maxTradeValueUsd.toFixed(2)} USD is below the broker minimum executable ${minimumTradeValueUsd.toFixed(2)} USD for ${symbol} (minimum quantity ${minimum}). Increase the maximum trade value or use a broker/symbol with a smaller minimum volume.`
    );
  }

  const requestedRounded = floorToStep(Math.min(requested, maximum), step);
  const quantity = Math.min(requestedRounded, maxAllowedByValue);

  if (quantity < minimum) {
    throw new Error(
      `INVALID_QUANTITY: Requested quantity ${requested} becomes ${quantity} after broker step rounding and is below the minimum ${minimum}.`
    );
  }

  const estimatedTradeValueUsd = quantity * valuePerBaseUnitUsd;

  // Final invariant: no live order may leave this function above the configured
  // notional cap, even because of floating-point rounding.
  if (estimatedTradeValueUsd > maxTradeValueUsd + 1e-9) {
    throw new Error(
      `MAX_TRADE_VALUE_EXCEEDED: Calculated Forex trade value ${estimatedTradeValueUsd.toFixed(2)} USD exceeds configured maximum ${maxTradeValueUsd.toFixed(2)} USD.`
    );
  }

  return {
    requestedQuantity: requested,
    quantity,
    maxTradeValueUsd,
    estimatedTradeValueUsd,
    quoteToUsdRate,
    quoteCurrency,
    adjusted: Math.abs(quantity - requested) > 1e-9,
    brokerMinimumQuantity: minimum,
    brokerStepQuantity: step
  };
}
