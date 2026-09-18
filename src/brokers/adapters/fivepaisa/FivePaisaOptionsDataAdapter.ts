import { OptionChainSummary } from '../../../markets/common/types';
import { TradingEnvironment } from '../../types';
import { buildOptionChain } from '../../../markets/india_options/optionsChain';

export class FivePaisaOptionsDataAdapter {
  private environment: TradingEnvironment;

  constructor(environment: TradingEnvironment = 'DEMO') {
    this.environment = environment;
  }

  setEnvironment(env: TradingEnvironment): void {
    this.environment = env;
  }

  /**
   * Fetches and normalizes an option chain for an Indian underlying.
   * Leverages 5paisa feed specifications with quantitative model fallbacks when live feed is simulated or offline.
   */
  getOptionChain(
    symbol: string,
    spotPrice: number,
    selectedExpiryDate?: string,
    strikeDepth: number = 7
  ): OptionChainSummary {
    const chain = buildOptionChain(symbol, spotPrice, selectedExpiryDate, strikeDepth);

    return {
      ...chain,
      timestamp: Date.now()
    };
  }
}
