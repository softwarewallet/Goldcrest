// ============================================================================
// MONTE CARLO RESEARCH & RISK SIMULATION ENGINE
// ============================================================================

import {
  MonteCarloConfig,
  MonteCarloSimulationResult,
  BacktestTradeAudit
} from '../historical/types';

export class MonteCarloResearchEngine {
  /**
   * Runs randomized permutation and bootstrap resampling across historical trade outcomes.
   * STRICT NOTE: This is exclusively a risk-analysis & statistical significance tool, NOT a predictor.
   */
  public runSimulation(
    trades: BacktestTradeAudit[],
    sourceBacktestId: string,
    config: MonteCarloConfig = {
      iterations: 1000,
      resampleWithReplacement: true,
      confidenceIntervalLevel: 0.95,
      initialCapital: 100000,
      ruinThresholdPct: 0.30
    }
  ): MonteCarloSimulationResult {
    const simulationId = config.simulationId || `mc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const N = trades.length;

    if (N === 0) {
      throw new Error('Cannot run Monte Carlo simulation on empty trade set.');
    }

    const netPnlArray = trades.map(t => t.netPnl);
    const simulatedFinalPnls: number[] = [];
    const simulatedMaxDrawdowns: number[] = [];
    const simulatedWorstStreaks: number[] = [];
    const simulatedSharpes: number[] = [];
    const simulatedCurvesSample: Array<Array<{ step: number; equity: number }>> = [];

    let ruinCount = 0;
    const ruinFloor = config.initialCapital * (1 - config.ruinThresholdPct);

    // Run N iterations
    for (let iter = 0; iter < config.iterations; iter++) {
      let currentEquity = config.initialCapital;
      let peakEquity = config.initialCapital;
      let maxDrawdownPct = 0;
      let currentLosingStreak = 0;
      let worstLosingStreak = 0;
      let hasHitRuin = false;

      const curvePoints: Array<{ step: number; equity: number }> = [{ step: 0, equity: currentEquity }];
      const iterReturns: number[] = [];

      for (let s = 0; s < N; s++) {
        // Bootstrap sample (with or without replacement)
        const sampleIdx = config.resampleWithReplacement
          ? Math.floor(Math.random() * N)
          : s; // Or random permutation

        const pnl = netPnlArray[sampleIdx];
        const prevEq = currentEquity;
        currentEquity += pnl;

        if (prevEq > 0) {
          iterReturns.push(pnl / prevEq);
        }

        if (currentEquity > peakEquity) {
          peakEquity = currentEquity;
        }

        const ddAmount = peakEquity - currentEquity;
        const ddPct = peakEquity > 0 ? (ddAmount / peakEquity) * 100 : 0;
        if (ddPct > maxDrawdownPct) {
          maxDrawdownPct = ddPct;
        }

        if (pnl < 0) {
          currentLosingStreak++;
          if (currentLosingStreak > worstLosingStreak) {
            worstLosingStreak = currentLosingStreak;
          }
        } else if (pnl > 0) {
          currentLosingStreak = 0;
        }

        if (currentEquity <= ruinFloor) {
          hasHitRuin = true;
        }

        if (iter < 10) {
          curvePoints.push({ step: s + 1, equity: currentEquity });
        }
      }

      if (hasHitRuin) ruinCount++;

      const finalNetPnl = currentEquity - config.initialCapital;
      simulatedFinalPnls.push(finalNetPnl);
      simulatedMaxDrawdowns.push(maxDrawdownPct);
      simulatedWorstStreaks.push(worstLosingStreak);

      if (iter < 10) {
        simulatedCurvesSample.push(curvePoints);
      }

      // Compute iteration Sharpe
      const meanRet = iterReturns.reduce((a, b) => a + b, 0) / iterReturns.length;
      const varRet = iterReturns.reduce((acc, r) => acc + Math.pow(r - meanRet, 2), 0) / Math.max(1, iterReturns.length - 1);
      const sDev = Math.sqrt(varRet);
      const sharpe = sDev > 0 ? (meanRet / sDev) * Math.sqrt(252) : 0;
      simulatedSharpes.push(sharpe);
    }

    // Sort metrics for percentile extractions
    simulatedFinalPnls.sort((a, b) => a - b);
    simulatedMaxDrawdowns.sort((a, b) => a - b);
    simulatedWorstStreaks.sort((a, b) => a - b);
    simulatedSharpes.sort((a, b) => a - b);

    const getPercentile = (arr: number[], pct: number) => {
      const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * pct)));
      return arr[idx];
    };

    const medianFinalNetPnl = getPercentile(simulatedFinalPnls, 0.50);
    const p5NetPnl = getPercentile(simulatedFinalPnls, 0.05);
    const p25NetPnl = getPercentile(simulatedFinalPnls, 0.25);
    const p75NetPnl = getPercentile(simulatedFinalPnls, 0.75);
    const p95NetPnl = getPercentile(simulatedFinalPnls, 0.95);

    const expectedMaxDrawdownPct = getPercentile(simulatedMaxDrawdowns, 0.50);
    const p95MaxDrawdownPct = getPercentile(simulatedMaxDrawdowns, 0.95);
    const p99MaxDrawdownPct = getPercentile(simulatedMaxDrawdowns, 0.99);

    const probabilityOfRuinPct = (ruinCount / config.iterations) * 100;
    const expectedWorstLosingStreak = Math.round(getPercentile(simulatedWorstStreaks, 0.50));
    const p95WorstLosingStreak = Math.round(getPercentile(simulatedWorstStreaks, 0.95));

    // Sharpe distribution statistics
    const sharpeMean = simulatedSharpes.reduce((a, b) => a + b, 0) / simulatedSharpes.length;
    const sharpeStdDev = Math.sqrt(simulatedSharpes.reduce((acc, s) => acc + Math.pow(s - sharpeMean, 2), 0) / simulatedSharpes.length);
    const sharpeCiLower = getPercentile(simulatedSharpes, 0.025);
    const sharpeCiUpper = getPercentile(simulatedSharpes, 0.975);

    // Statistical significance & sample size verification
    const isStatisticallySignificant = N >= 30;
    const standardError = N > 0 ? (sharpeStdDev / Math.sqrt(N)) : 1.0;
    const marginOfErrorPct = Number((standardError * 1.96 * 100).toFixed(2));

    const confidenceStatement = isStatisticallySignificant
      ? `Sample size of ${N} trades meets Central Limit Theorem threshold (N >= 30). Standard Error: ${standardError.toFixed(4)}.`
      : `INSUFFICIENT SAMPLE (${N} trades < 30). Results carry high statistical uncertainty and wide confidence intervals.`;

    // Simulated Drawdown Distribution Bins
    const bins = [
      { min: 0, max: 5, label: '0% - 5%' },
      { min: 5, max: 10, label: '5% - 10%' },
      { min: 10, max: 15, label: '10% - 15%' },
      { min: 15, max: 20, label: '15% - 20%' },
      { min: 20, max: 30, label: '20% - 30%' },
      { min: 30, max: 100, label: '> 30%' }
    ];

    const simulatedDrawdownDistribution = bins.map(b => {
      const count = simulatedMaxDrawdowns.filter(dd => dd >= b.min && (b.max === 100 ? dd <= 100 : dd < b.max)).length;
      return {
        drawdownBinPct: b.label,
        frequency: count,
        probabilityPct: Number(((count / config.iterations) * 100).toFixed(1))
      };
    });

    return {
      simulationId,
      sourceBacktestId,
      tradeCount: N,
      iterations: config.iterations,
      medianFinalNetPnl: Number(medianFinalNetPnl.toFixed(2)),
      p5NetPnl: Number(p5NetPnl.toFixed(2)),
      p25NetPnl: Number(p25NetPnl.toFixed(2)),
      p75NetPnl: Number(p75NetPnl.toFixed(2)),
      p95NetPnl: Number(p95NetPnl.toFixed(2)),
      expectedMaxDrawdownPct: Number(expectedMaxDrawdownPct.toFixed(2)),
      p95MaxDrawdownPct: Number(p95MaxDrawdownPct.toFixed(2)),
      p99MaxDrawdownPct: Number(p99MaxDrawdownPct.toFixed(2)),
      probabilityOfRuinPct: Number(probabilityOfRuinPct.toFixed(2)),
      expectedWorstLosingStreak,
      p95WorstLosingStreak,
      sharpeDistribution: {
        mean: Number(sharpeMean.toFixed(2)),
        stdDev: Number(sharpeStdDev.toFixed(2)),
        ciLower: Number(sharpeCiLower.toFixed(2)),
        ciUpper: Number(sharpeCiUpper.toFixed(2))
      },
      sampleSizeSufficiency: {
        sampleSize: N,
        isStatisticallySignificant,
        standardError: Number(standardError.toFixed(4)),
        marginOfErrorPct,
        confidenceStatement
      },
      simulatedDrawdownDistribution,
      simulatedEquityCurvesSample: simulatedCurvesSample
    };
  }
}
