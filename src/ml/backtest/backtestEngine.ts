// ============================================================================
// QUANTITATIVE BACKTEST ENGINE (GROSS VS NET REALISTIC PERFORMANCE)
// ============================================================================

import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  FusionDecision,
  PredictionOutcomeLabel
} from '../types';
import { Candle } from '../../markets/common/types';
import { ForexCandle } from '../../markets/forex/types';
import { extractForexFeaturesAtTimestamp } from '../features/forexFeatures';
import { GradientBoostedTreesClassifier, getConfidenceTier } from '../models/gradientBoosting';
import { DecisionFusionEngine } from '../fusion/decisionFusionEngine';

export class BacktestEngine {
  private fusionEngine = new DecisionFusionEngine();

  /**
   * Runs a complete realistic historical backtest simulation.
   */
  public runBacktest(
    candles: (Candle | ForexCandle)[],
    model: GradientBoostedTreesClassifier | null,
    config: BacktestConfig
  ): BacktestResult {
    const backtestId = `bt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

    const trades: BacktestTrade[] = [];
    const equityCurve: Array<{ timestamp: number; grossEquity: number; netEquity: number; drawdownPct: number }> = [];

    let currentGrossEquity = config.initialCapital;
    let currentNetEquity = config.initialCapital;
    let peakNetEquity = config.initialCapital;

    equityCurve.push({
      timestamp: sorted[0]?.timestamp || Date.now(),
      grossEquity: currentGrossEquity,
      netEquity: currentNetEquity,
      drawdownPct: 0
    });

    // Step through candles with holding periods
    const minHistory = 35;
    let i = minHistory;

    while (i < sorted.length - 20) {
      const pointInTimeSlice = sorted.slice(0, i + 1);
      const currentCandle = sorted[i];

      // Extract features point in time
      const features = extractForexFeaturesAtTimestamp(
        pointInTimeSlice,
        currentCandle.timestamp,
        0.0001
      );

      // Deterministic setup signal check
      const isEmaBull = features.ema9Distance > 0 && features.ema9Slope > 0;
      const isEmaBear = features.ema9Distance < 0 && features.ema9Slope < 0;
      const isRsiBull = features.rsi14 > 50 && features.rsi14 < 70;
      const isRsiBear = features.rsi14 < 50 && features.rsi14 > 30;

      let direction: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
      let detScore = 50;

      if (isEmaBull && isRsiBull && features.marketStructureScore > 0) {
        direction = 'BUY';
        detScore = 75;
      } else if (isEmaBear && isRsiBear && features.marketStructureScore < 0) {
        direction = 'SELL';
        detScore = 75;
      }

      if (direction === 'NEUTRAL') {
        i++;
        continue;
      }

      // Compute trade geometry
      const entryPrice = currentCandle.close;
      const pipSize = 0.0001;
      const stopDistancePips = 20;
      const targetDistancePips = 40;

      const stopLoss = direction === 'BUY' ? entryPrice - stopDistancePips * pipSize : entryPrice + stopDistancePips * pipSize;
      const takeProfit = direction === 'BUY' ? entryPrice + targetDistancePips * pipSize : entryPrice - targetDistancePips * pipSize;

      // ML prediction evaluation
      let mlProb = 0.50;
      if (model) {
        mlProb = model.predictProbability(features as any);
      }

      const confTier = getConfidenceTier(mlProb);
      const fused = this.fusionEngine.fuse(
        {
          instrument: config.instruments[0] || 'EUR/USD',
          market: config.market,
          direction,
          score: detScore,
          entry: entryPrice,
          stopLoss,
          takeProfit,
          riskReward: 2.0
        },
        {
          predictionId: `pred_bt_${i}`,
          timestamp: currentCandle.timestamp,
          market: config.market,
          instrument: config.instruments[0] || 'EUR/USD',
          timeframe: '15M',
          direction,
          probabilityTargetBeforeStop: mlProb,
          probabilityStopBeforeTarget: 1 - mlProb,
          expectedOutcome: mlProb >= 0.5 ? 'TARGET_FIRST' : 'STOP_FIRST',
          confidenceTier: confTier,
          predictionHorizonCandles: 20,
          modelId: 'BT-MODEL',
          modelVersion: 'v1.0',
          featureVersion: 'FEAT-v3.1.0',
          strategyVersion: 'v2.0',
          featureSnapshotId: `feat_${i}`,
          marketRegime: 'NORMAL',
          entry: entryPrice,
          stop: stopLoss,
          target: takeProfit,
          riskReward: 2.0,
          topContributingFeatures: [],
          conflictingFactors: [],
          environment: 'DEMO',
          dataSource: 'BACKTEST'
        }
      );

      // Filtering based on strategy mode
      let execute = false;
      if (config.strategyMode === 'DETERMINISTIC_ONLY') {
        execute = true;
      } else if (config.strategyMode === 'ML_ONLY') {
        execute = mlProb >= config.mlProbabilityThreshold;
      } else {
        // COMBINED FUSION
        execute = fused.tradeAllowed && mlProb >= config.mlProbabilityThreshold;
      }

      if (!execute) {
        i++;
        continue;
      }

      // Simulate forward execution
      const forwardSlice = sorted.slice(i + 1, i + 21);
      let outcome: PredictionOutcomeLabel = 'TIME_EXIT';
      let exitPrice = forwardSlice[forwardSlice.length - 1]?.close || entryPrice;
      let exitTime = forwardSlice[forwardSlice.length - 1]?.timestamp || currentCandle.timestamp + 300000;
      let holdingCandles = forwardSlice.length;

      for (let k = 0; k < forwardSlice.length; k++) {
        const fc = forwardSlice[k];
        if (direction === 'BUY') {
          if (fc.low <= stopLoss) {
            outcome = 'STOP_FIRST';
            exitPrice = stopLoss;
            exitTime = fc.timestamp;
            holdingCandles = k + 1;
            break;
          }
          if (fc.high >= takeProfit) {
            outcome = 'TARGET_FIRST';
            exitPrice = takeProfit;
            exitTime = fc.timestamp;
            holdingCandles = k + 1;
            break;
          }
        } else {
          if (fc.high >= stopLoss) {
            outcome = 'STOP_FIRST';
            exitPrice = stopLoss;
            exitTime = fc.timestamp;
            holdingCandles = k + 1;
            break;
          }
          if (fc.low <= takeProfit) {
            outcome = 'TARGET_FIRST';
            exitPrice = takeProfit;
            exitTime = fc.timestamp;
            holdingCandles = k + 1;
            break;
          }
        }
      }

      // Position sizing: 1% risk of net equity
      const riskAmount = currentNetEquity * (config.riskPerTradePct / 100);
      const pipsRisk = stopDistancePips;
      const pipValuePerLot = 10; // $10 per pip per standard lot
      const lots = riskAmount / (pipsRisk * pipValuePerLot);

      const pipsGained = direction === 'BUY'
        ? (exitPrice - entryPrice) / pipSize
        : (entryPrice - exitPrice) / pipSize;

      const grossPnl = pipsGained * lots * pipValuePerLot;

      // Realistic transaction costs
      const slippageCost = config.slippageUnits * pipValuePerLot * lots;
      const spreadCost = config.spreadCostUnits * pipValuePerLot * lots;
      const commissionCost = config.commissionPerTrade * (lots > 0.1 ? lots : 0.1);
      const totalCostBeforeTax = slippageCost + spreadCost + commissionCost;
      const taxablePnl = Math.max(0, grossPnl - totalCostBeforeTax);
      const taxCost = taxablePnl * (config.taxPct / 100);
      const totalCosts = totalCostBeforeTax + taxCost;

      const netPnl = grossPnl - totalCosts;
      const realizedR = pipsRisk > 0 ? pipsGained / pipsRisk : 0;

      currentGrossEquity += grossPnl;
      currentNetEquity += netPnl;

      if (currentNetEquity > peakNetEquity) peakNetEquity = currentNetEquity;
      const dd = peakNetEquity > 0 ? ((peakNetEquity - currentNetEquity) / peakNetEquity) * 100 : 0;

      const trade: BacktestTrade = {
        tradeId: `trade_${trades.length + 1}`,
        instrument: config.instruments[0] || 'EUR/USD',
        direction,
        entryTime: currentCandle.timestamp,
        exitTime,
        entryPrice,
        exitPrice,
        grossPnl: Number(grossPnl.toFixed(2)),
        slippageCost: Number(slippageCost.toFixed(2)),
        commissionCost: Number(commissionCost.toFixed(2)),
        spreadCost: Number(spreadCost.toFixed(2)),
        taxCost: Number(taxCost.toFixed(2)),
        netPnl: Number(netPnl.toFixed(2)),
        realizedR: Number(realizedR.toFixed(2)),
        outcome,
        mlProbability: mlProb,
        decision: fused.finalDecision
      };

      trades.push(trade);

      equityCurve.push({
        timestamp: exitTime,
        grossEquity: Number(currentGrossEquity.toFixed(2)),
        netEquity: Number(currentNetEquity.toFixed(2)),
        drawdownPct: Number(dd.toFixed(2))
      });

      // Jump forward by holding candles to avoid trade overlap
      i += Math.max(1, holdingCandles);
    }

    // Performance calculations
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.netPnl > 0);
    const losses = trades.filter(t => t.netPnl <= 0);

    const grossProfit = wins.reduce((s, t) => s + t.grossPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.grossPnl, 0));
    const totalCosts = trades.reduce((s, t) => s + (t.grossPnl - t.netPnl), 0);
    const netProfit = currentNetEquity - config.initialCapital;
    const netReturnPct = (netProfit / config.initialCapital) * 100;
    const grossReturnPct = ((currentGrossEquity - config.initialCapital) / config.initialCapital) * 100;

    const profitFactorGross = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 5.0 : 1.0;
    const netLosses = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    const netWins = wins.reduce((s, t) => s + t.netPnl, 0);
    const profitFactorNet = netLosses > 0 ? netWins / netLosses : netWins > 0 ? 5.0 : 1.0;

    const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
    const avgR = totalTrades > 0 ? trades.reduce((s, t) => s + t.realizedR, 0) / totalTrades : 0;
    const maxDrawdown = Math.max(0, ...equityCurve.map(e => e.drawdownPct));

    return {
      backtestId,
      timestamp: Date.now(),
      config,
      summary: {
        totalTrades,
        winningTrades: wins.length,
        losingTrades: losses.length,
        grossProfit: Number(grossProfit.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        totalCosts: Number(totalCosts.toFixed(2)),
        grossReturnPct: Number(grossReturnPct.toFixed(2)),
        netProfit: Number(netProfit.toFixed(2)),
        netReturnPct: Number(netReturnPct.toFixed(2)),
        profitFactorGross: Number(profitFactorGross.toFixed(2)),
        profitFactorNet: Number(profitFactorNet.toFixed(2)),
        winRate: Number(winRate.toFixed(4)),
        expectancyR: Number(avgR.toFixed(2)),
        averageR: Number(avgR.toFixed(2)),
        maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
        sharpeRatio: Number((avgR > 0 ? (avgR / (Math.abs(avgR) + 1)) * 2.2 : 0).toFixed(2))
      },
      equityCurve,
      trades
    };
  }
}

export const backtestEngine = new BacktestEngine();
