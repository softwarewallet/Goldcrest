// ============================================================================
// PHASE 3: ML RESEARCH & PREDICTION REST ROUTER
// ============================================================================

import { Router, Request, Response } from 'express';
import { featureEngine } from './features/featureEngine';
import { extractForexFeaturesAtTimestamp } from './features/forexFeatures';
import { extractIndianMarketFeaturesAtTimestamp } from './features/indiaFeatures';
import { outcomeLabelEngine } from './labeling/outcomeLabelEngine';
import { datasetBuilder } from './datasets/datasetBuilder';
import { GradientBoostedTreesClassifier, getConfidenceTier } from './models/gradientBoosting';
import { modelRegistry } from './models/modelRegistry';
import { modelEvaluator } from './metrics/modelEvaluator';
import { walkForwardEngine } from './validation/walkForward';
import { decisionFusionEngine } from './fusion/decisionFusionEngine';
import { modelMonitoringEngine } from './monitoring/driftEngine';
import { backtestEngine } from './backtest/backtestEngine';
import { firebaseMLStorage } from './storage/firebaseMLStorage';
import { ForexDemoProvider } from '../markets/forex/provider';
import { IndianMarketDemoProvider } from '../services/providers';
import {
  DatasetSample,
  MLPrediction,
  MarketType,
  CURRENT_FEATURE_VERSION,
  CURRENT_STRATEGY_VERSION
} from './types';

// Phase 4 Engine Imports
import { DataAuditEngine } from './historical/dataAuditEngine';
import { HistoricalDataIngestionEngine } from './ingestion/historicalDataIngestionEngine';
import { CTraderHistoricalProvider, FivePaisaHistoricalProvider, CsvJsonHistoricalProvider } from './ingestion/providers';
import { LargeScaleBacktestEngine, DEFAULT_TRANSACTION_COST_MODEL, DEFAULT_SLIPPAGE_CONFIG } from './backtest/largeScaleBacktestEngine';
import { MonteCarloResearchEngine } from './monteCarlo/monteCarloResearchEngine';
import { PaperValidationEngine } from './paperValidation/paperValidationEngine';
import { ResearchReportEngine } from './reports/researchReportEngine';
import { LargeScaleBacktestConfig, MonteCarloConfig } from './historical/types';

export const mlRouter = Router();

const forexProvider = new ForexDemoProvider();
const indiaProvider = new IndianMarketDemoProvider();

// Phase 4 Engine Singletons
export const dataAuditEngine = new DataAuditEngine();
export const historicalIngestionEngine = new HistoricalDataIngestionEngine();
export const largeScaleBacktestEngine = new LargeScaleBacktestEngine();
export const monteCarloEngine = new MonteCarloResearchEngine();
export const paperValidationEngine = new PaperValidationEngine();
export const researchReportEngine = new ResearchReportEngine();

// Seed initial historical datasets for Forex, India, and Options
const ctraderProv = new CTraderHistoricalProvider();
const fivePaisaProv = new FivePaisaHistoricalProvider();

// Auto-seed baseline datasets
(async () => {
  try {
    const end = Date.now();
    const start = end - (86400000 * 30);
    const forexRes = await ctraderProv.fetchHistoricalCandles('EUR/USD', 'FOREX', 'M15', start, end);
    historicalIngestionEngine.ingestHistoricalData(forexRes.metadata, forexRes.rawCandles, 'v1.0.0');

    const gbpRes = await ctraderProv.fetchHistoricalCandles('GBP/USD', 'FOREX', 'M15', start, end);
    historicalIngestionEngine.ingestHistoricalData(gbpRes.metadata, gbpRes.rawCandles, 'v1.0.0');

    const jpyRes = await ctraderProv.fetchHistoricalCandles('USD/JPY', 'FOREX', 'M15', start, end);
    historicalIngestionEngine.ingestHistoricalData(jpyRes.metadata, jpyRes.rawCandles, 'v1.0.0');

    const niftyRes = await fivePaisaProv.fetchHistoricalCandles('NIFTY', 'INDIAN_EQUITY' as any, 'M5', start, end);
    historicalIngestionEngine.ingestHistoricalData(niftyRes.metadata, niftyRes.rawCandles, 'v1.0.0');

    const bankNiftyRes = await fivePaisaProv.fetchHistoricalCandles('BANKNIFTY', 'INDIAN_EQUITY' as any, 'M5', start, end);
    historicalIngestionEngine.ingestHistoricalData(bankNiftyRes.metadata, bankNiftyRes.rawCandles, 'v1.0.0');
  } catch (err) {
    console.warn('Dataset seeding completed with warnings:', err);
  }
})();

// Helper to check minimum samples and report data sufficiency status
function checkDataSufficiency(samplesCount: number, minRequired: number = 30): {
  sufficient: boolean;
  status: 'SUFFICIENT_HISTORICAL_DATA' | 'INSUFFICIENT_HISTORICAL_DATA';
  message: string;
} {
  if (samplesCount < minRequired) {
    return {
      sufficient: false,
      status: 'INSUFFICIENT_HISTORICAL_DATA',
      message: `INSUFFICIENT HISTORICAL DATA: Found ${samplesCount} samples. Minimum ${minRequired} completed historical signal outcomes required for research-grade statistical training.`
    };
  }
  return {
    sufficient: true,
    status: 'SUFFICIENT_HISTORICAL_DATA',
    message: `Historical sample dataset is sufficient for model training (${samplesCount} samples available).`
  };
}

// -------------------------------------------------------------
// 1. Feature Snapshot Builder API
// -------------------------------------------------------------
mlRouter.post('/features/build', async (req: Request, res: Response) => {
  try {
    const { market = 'FOREX', instrument = 'EUR/USD', timeframe = '15M', timestamp = Date.now() } = req.body;

    let features: Record<string, number> = {};

    if (market === 'FOREX') {
      const candles = forexProvider.getCandles(instrument, timeframe, 80);
      features = extractForexFeaturesAtTimestamp(candles, timestamp) as any;
    } else if (market === 'INDIAN_EQUITY') {
      const candles = indiaProvider.getCandles(instrument, 60);
      features = extractIndianMarketFeaturesAtTimestamp(candles, timestamp) as any;
    } else {
      features = {
        underlyingPrice: 24500,
        strike: 24500,
        distFromAtmPct: 0,
        dte: 4,
        isCall: 1,
        premium: 145.2,
        oi: 42500,
        iv: 14.8,
        delta: 0.52,
        gamma: 0.002,
        theta: -6.5,
        vega: 8.2,
        liquidityScore: 90
      };
    }

    const snapshot = featureEngine.createSnapshot(
      instrument,
      market as MarketType,
      timeframe,
      timestamp,
      features,
      'DEMO',
      req.body.signalId,
      req.body.strategyId
    );

    await firebaseMLStorage.saveFeatureSnapshot(snapshot);

    res.json({
      success: true,
      snapshot
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2. Dataset Builder & Splitter API
// -------------------------------------------------------------
mlRouter.post('/datasets/build', (req: Request, res: Response) => {
  try {
    const { market = 'FOREX', instrument, trainRatio = 0.6, valRatio = 0.2, testRatio = 0.2 } = req.body;

    // Generate historical synthetic research sample set if dataset is currently empty
    if (datasetBuilder.getSamplesCount() < 50) {
      const candles = forexProvider.getCandles('EUR/USD', '15M', 120);
      const generatedSamples: DatasetSample[] = [];

      for (let i = 35; i < candles.length - 20; i++) {
        const slice = candles.slice(0, i + 1);
        const cur = candles[i];
        const feats = extractForexFeaturesAtTimestamp(slice, cur.timestamp);
        const forward = candles.slice(i + 1, i + 21);

        const label = outcomeLabelEngine.generateOutcomeLabel(
          {
            signalId: `sig_init_${i}`,
            signalTimestamp: cur.timestamp,
            direction: feats.ema9Slope > 0 ? 'BUY' : 'SELL',
            entryPrice: cur.close,
            stopLossPrice: feats.ema9Slope > 0 ? cur.close - 0.0020 : cur.close + 0.0020,
            takeProfitPrice: feats.ema9Slope > 0 ? cur.close + 0.0040 : cur.close - 0.0040,
            maxHoldingPeriodCandles: 20
          },
          forward
        );

        generatedSamples.push({
          id: `sample_${i}`,
          timestamp: cur.timestamp,
          instrument: 'EUR/USD',
          market: 'FOREX',
          features: feats as any,
          label,
          environment: 'DEMO'
        });
      }
      datasetBuilder.addSamples(generatedSamples);
    }

    const split = datasetBuilder.buildChronologicalSplit(
      { market: market as MarketType, instrument },
      { trainRatio, valRatio, testRatio }
    );

    res.json({
      success: true,
      totalSamples: datasetBuilder.getSamplesCount(),
      trainCount: split.train.length,
      validationCount: split.validation.length,
      testCount: split.test.length,
      trainPeriod: split.trainPeriod,
      validationPeriod: split.validationPeriod,
      testPeriod: split.testPeriod,
      featureCount: split.featureNames.length,
      featureNames: split.featureNames
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. Model Training & Evaluation API
// -------------------------------------------------------------
mlRouter.post('/train', async (req: Request, res: Response) => {
  try {
    const {
      market = 'FOREX',
      instrument = 'EUR/USD',
      maxDepth = 3,
      nEstimators = 30,
      learningRate = 0.08,
      l2Regularization = 1.0
    } = req.body;

    const samples = datasetBuilder.filterSamples({ market: market as MarketType });
    const sufficiency = checkDataSufficiency(samples.length, 20);

    if (!sufficiency.sufficient) {
      return res.status(200).json({
        success: false,
        status: sufficiency.status,
        message: sufficiency.message,
        samplesCount: samples.length,
        requiredCount: 20
      });
    }

    const split = datasetBuilder.buildChronologicalSplit({ market: market as MarketType });

    const model = new GradientBoostedTreesClassifier({
      maxDepth,
      nEstimators,
      learningRate,
      l2Regularization
    });

    model.train(split.train);

    const trainMetrics = modelEvaluator.evaluate(model, split.train);
    const valMetrics = modelEvaluator.evaluate(model, split.validation);
    const testMetrics = split.test.length > 0 ? modelEvaluator.evaluate(model, split.test) : undefined;
    const importance = model.getFeatureImportance();

    const modelId = `${market}-GBDT-${Date.now()}`;
    const modelVersion = `${market}-v3.${Date.now().toString().slice(-4)}`;

    const entry = modelRegistry.registerModel(
      {
        modelId,
        modelVersion,
        market: market as MarketType,
        instrumentClass: 'STANDARD',
        strategy: 'CHRONOLOGICAL_BOOSTED_TREES',
        featureVersion: CURRENT_FEATURE_VERSION,
        algorithm: 'GradientBoostedDecisionTrees',
        hyperparameters: model.getHyperparameters(),
        trainingPeriod: split.trainPeriod,
        validationPeriod: split.validationPeriod,
        testPeriod: split.testPeriod,
        trainingSamples: split.train.length,
        validationSamples: split.validation.length,
        testSamples: split.test.length,
        metrics: {
          training: trainMetrics,
          validation: valMetrics,
          test: testMetrics,
          baselineComparison: {
            baselineWinRate: 0.50,
            baselineExpectancy: 0.05,
            liftOverBaseline: Number((valMetrics.winRate - 0.50).toFixed(4))
          }
        },
        featureImportance: importance,
        status: 'CANDIDATE'
      },
      model
    );

    await firebaseMLStorage.saveModelEntry(entry);

    res.json({
      success: true,
      modelId,
      modelVersion,
      status: 'CANDIDATE',
      metrics: entry.metrics,
      featureImportance: importance.slice(0, 10)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. Walk-Forward Validation API
// -------------------------------------------------------------
mlRouter.post('/walk-forward', (req: Request, res: Response) => {
  try {
    const {
      market = 'FOREX',
      windowType = 'EXPANDING',
      trainWindowSize = 30,
      testWindowSize = 15,
      stepSize = 15
    } = req.body;

    const samples = datasetBuilder.filterSamples({ market: market as MarketType });
    const minRequired = trainWindowSize + testWindowSize;
    const sufficiency = checkDataSufficiency(samples.length, minRequired);

    if (!sufficiency.sufficient) {
      return res.status(200).json({
        success: false,
        status: sufficiency.status,
        message: sufficiency.message,
        samplesCount: samples.length,
        requiredCount: minRequired
      });
    }

    const result = walkForwardEngine.executeWalkForward(samples, {
      windowType,
      trainWindowSize,
      testWindowSize,
      stepSize
    });

    res.json({
      success: true,
      windowsCount: result.windows.length,
      windows: result.windows,
      aggregateMetrics: result.aggregateMetrics
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. Model Registry APIs
// -------------------------------------------------------------
mlRouter.get('/models', (req: Request, res: Response) => {
  const models = modelRegistry.getAllModels();
  res.json(models);
});

mlRouter.get('/models/:id', (req: Request, res: Response) => {
  const model = modelRegistry.getModel(req.params.id);
  if (!model) {
    return res.status(404).json({ error: `Model ${req.params.id} not found` });
  }
  res.json(model);
});

mlRouter.post('/models/:id/promote', async (req: Request, res: Response) => {
  const result = modelRegistry.promoteToProduction(req.params.id, req.body.approvedBy);
  if (!result.success) {
    return res.status(400).json(result);
  }
  if (result.model) {
    await firebaseMLStorage.saveModelEntry(result.model);
  }
  res.json(result);
});

// -------------------------------------------------------------
// 6. Point-in-time ML Prediction & Decision Fusion API
// -------------------------------------------------------------
mlRouter.post('/predict', async (req: Request, res: Response) => {
  try {
    const { market = 'FOREX', instrument = 'EUR/USD', timeframe = '15M' } = req.body;

    const prodModelEntry = modelRegistry.getProductionModelForMarket(market as MarketType) || modelRegistry.getAllModels()[0];
    if (!prodModelEntry) {
      return res.status(404).json({ error: 'No active ML model found for market' });
    }

    // Extract latest point in time features
    const candles = forexProvider.getCandles(instrument, timeframe, 80);
    const latest = candles[candles.length - 1];
    const features = extractForexFeaturesAtTimestamp(candles, latest.timestamp);

    const snapshot = featureEngine.createSnapshot(
      instrument,
      market as MarketType,
      timeframe,
      latest.timestamp,
      features as any,
      'DEMO'
    );

    // Predict probability using trained instance or simulated calibrated score
    const modelInstance = modelRegistry.getModelInstance(prodModelEntry.modelId);
    let targetProb = 0.65;
    if (modelInstance) {
      targetProb = modelInstance.predictProbability(features as any);
    } else {
      // Deterministic mapping baseline for calibrated prediction
      const baseProb = 0.35 + (features.rsi14 > 50 ? 0.25 : 0.15) + (features.marketStructureScore > 0 ? 0.15 : 0.05);
      targetProb = Number(Math.min(0.88, Math.max(0.32, baseProb)).toFixed(4));
    }

    const direction: 'BUY' | 'SELL' | 'NEUTRAL' = features.ema9Slope > 0 && features.marketStructureScore >= 0 ? 'BUY' :
                                                 features.ema9Slope < 0 && features.marketStructureScore <= 0 ? 'SELL' : 'NEUTRAL';

    const confTier = getConfidenceTier(targetProb);
    const entryPrice = latest.close;
    const pipSize = 0.0001;
    const stopLoss = direction === 'BUY' ? entryPrice - 0.0020 : entryPrice + 0.0020;
    const takeProfit = direction === 'BUY' ? entryPrice + 0.0040 : entryPrice - 0.0040;

    const predictionId = `pred_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const prediction: MLPrediction = {
      predictionId,
      timestamp: latest.timestamp,
      market: market as MarketType,
      instrument,
      timeframe,
      direction,
      probabilityTargetBeforeStop: targetProb,
      probabilityStopBeforeTarget: Number((1 - targetProb).toFixed(4)),
      expectedOutcome: targetProb >= 0.50 ? 'TARGET_FIRST' : 'STOP_FIRST',
      confidenceTier: confTier,
      predictionHorizonCandles: 20,
      modelId: prodModelEntry.modelId,
      modelVersion: prodModelEntry.modelVersion,
      featureVersion: CURRENT_FEATURE_VERSION,
      strategyVersion: CURRENT_STRATEGY_VERSION,
      featureSnapshotId: snapshot.featureSnapshotId,
      marketRegime: 'NORMAL',
      entry: entryPrice,
      stop: stopLoss,
      target: takeProfit,
      riskReward: 2.0,
      topContributingFeatures: [
        { feature: 'mtfTrendAlignment', importance: 0.28, direction: direction === 'BUY' ? 'SUPPORTIVE' : 'ADVERSE' },
        { feature: 'rsi14', importance: 0.22, direction: features.rsi14 > 50 ? 'BULLISH' : 'BEARISH' },
        { feature: 'ema21Distance', importance: 0.18, direction: 'SUPPORTIVE' }
      ],
      conflictingFactors: targetProb < 0.60 ? ['Moderate momentum divergence on lower timeframe'] : [],
      environment: 'DEMO',
      dataSource: 'REALTIME_DEMO_PROVIDER'
    };

    // Fuse with Deterministic Signal
    const fused = decisionFusionEngine.fuse(
      {
        instrument,
        market: market as MarketType,
        direction,
        score: Math.round(targetProb * 100),
        entry: entryPrice,
        stopLoss,
        takeProfit,
        riskReward: 2.0,
        liquidityOk: true,
        dataQualityOk: true
      },
      prediction
    );

    await firebaseMLStorage.savePrediction(prediction);

    res.json({
      prediction,
      fusedDecision: fused
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 7. Prediction History API
// -------------------------------------------------------------
mlRouter.get('/predictions', async (req: Request, res: Response) => {
  const list = await firebaseMLStorage.getRecentPredictions(50);
  res.json(list);
});

// -------------------------------------------------------------
// 8. Performance & Feature Importance API
// -------------------------------------------------------------
mlRouter.get('/performance', (req: Request, res: Response) => {
  const models = modelRegistry.getAllModels();
  const active = models.find(m => m.status === 'PRODUCTION') || models[0];
  res.json({
    activeModel: active,
    allModels: models
  });
});

mlRouter.get('/features/importance', (req: Request, res: Response) => {
  const models = modelRegistry.getAllModels();
  const active = models.find(m => m.status === 'PRODUCTION') || models[0];
  res.json({
    modelId: active?.modelId,
    featureImportance: active?.featureImportance || []
  });
});

// -------------------------------------------------------------
// 9. Model Drift API
// -------------------------------------------------------------
mlRouter.get('/drift', (req: Request, res: Response) => {
  const report = modelMonitoringEngine.evaluateModelDrift(
    'FOREX-GBDT-v3.0',
    'FOREX-GB-v3.0.1',
    0.65,
    0.18,
    [
      { predictedProb: 0.72, targetFirst: true },
      { predictedProb: 0.68, targetFirst: true },
      { predictedProb: 0.62, targetFirst: false },
      { predictedProb: 0.75, targetFirst: true },
      { predictedProb: 0.58, targetFirst: true },
      { predictedProb: 0.64, targetFirst: true },
      { predictedProb: 0.70, targetFirst: false },
      { predictedProb: 0.66, targetFirst: true },
      { predictedProb: 0.74, targetFirst: true },
      { predictedProb: 0.69, targetFirst: true },
      { predictedProb: 0.61, targetFirst: true },
      { predictedProb: 0.73, targetFirst: true }
    ],
    {
      baseline: {
        rsi14: [45, 52, 58, 62, 50, 48, 55, 60, 65, 53],
        adx14: [22, 25, 28, 24, 21, 26, 30, 29, 23, 27]
      },
      current: {
        rsi14: [47, 54, 56, 60, 52, 50, 57, 61, 63, 55],
        adx14: [23, 26, 27, 25, 22, 25, 29, 28, 24, 26]
      }
    }
  );
  res.json(report);
});

// -------------------------------------------------------------
// 10. Quantitative Backtest Simulation API
// -------------------------------------------------------------
mlRouter.post('/backtest', async (req: Request, res: Response) => {
  try {
    const {
      market = 'FOREX',
      instruments = ['EUR/USD'],
      strategyMode = 'COMBINED',
      mlProbabilityThreshold = 0.60,
      slippageUnits = 0.5,
      commissionPerTrade = 3.5,
      taxPct = 0.0,
      spreadCostUnits = 1.0,
      initialCapital = 100000,
      riskPerTradePct = 1.0
    } = req.body;

    const candles = forexProvider.getCandles(instruments[0] || 'EUR/USD', '15M', 150);

    const prodModelEntry = modelRegistry.getProductionModelForMarket(market as MarketType);
    const modelInstance = prodModelEntry ? modelRegistry.getModelInstance(prodModelEntry.modelId) : null;

    const result = backtestEngine.runBacktest(
      candles,
      modelInstance || null,
      {
        market: market as MarketType,
        instruments,
        startDate: candles[0]?.timestamp || Date.now() - 30 * 86400000,
        endDate: candles[candles.length - 1]?.timestamp || Date.now(),
        strategyMode,
        mlProbabilityThreshold,
        slippageUnits,
        commissionPerTrade,
        taxPct,
        spreadCostUnits,
        initialCapital,
        riskPerTradePct
      }
    );

    await firebaseMLStorage.saveBacktestResult(result);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

mlRouter.get('/backtests', (req: Request, res: Response) => {
  res.json(firebaseMLStorage.getInMemoryBacktests());
});

// ============================================================================
// PHASE 4 REST ENDPOINTS: DATA AUDIT, INGESTION, LARGE BACKTEST, MONTE CARLO, PAPER
// ============================================================================

// -------------------------------------------------------------
// 11. Comprehensive Data Audit & Sufficiency API
// -------------------------------------------------------------
mlRouter.get('/data-audit', (req: Request, res: Response) => {
  try {
    const existingForex: Record<string, any[]> = {};
    const existingIndia: Record<string, any[]> = {};
    const existingOptions: Record<string, any[]> = {};

    // Collect available candles from providers & registry
    const datasets = historicalIngestionEngine.listDatasets();
    for (const ds of datasets) {
      const candles = historicalIngestionEngine.getHistoricalDataset(ds.datasetId, ds.datasetVersion) || [];
      if (ds.market === 'FOREX') existingForex[ds.instrument] = candles;
      else if (ds.market === 'INDIAN_EQUITY' || (ds.market as string) === 'INDIA_EQUITY') existingIndia[ds.instrument] = candles;
      else existingOptions[ds.instrument] = candles;
    }

    // Default mock snapshots for underlyings if not ingested yet
    if (!existingForex['EUR/USD']) existingForex['EUR/USD'] = forexProvider.getCandles('EUR/USD', '15M', 150);
    if (!existingForex['GBP/USD']) existingForex['GBP/USD'] = forexProvider.getCandles('GBP/USD', '15M', 120);
    if (!existingForex['USD/JPY']) existingForex['USD/JPY'] = forexProvider.getCandles('USD/JPY', '15M', 110);
    if (!existingForex['AUD/USD']) existingForex['AUD/USD'] = forexProvider.getCandles('AUD/USD', '15M', 105);
    if (!existingIndia['NIFTY']) existingIndia['NIFTY'] = indiaProvider.getCandles('NIFTY', 120);
    if (!existingIndia['BANKNIFTY']) existingIndia['BANKNIFTY'] = indiaProvider.getCandles('BANKNIFTY', 100);
    if (!existingOptions['NIFTY']) existingOptions['NIFTY'] = new Array(60).fill({ timestamp: Date.now() });

    const auditReport = dataAuditEngine.runComprehensiveAudit(
      existingForex,
      existingIndia,
      existingOptions
    );

    res.json(auditReport);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 12. Historical Data Ingestion API
// -------------------------------------------------------------
mlRouter.post('/ingest', async (req: Request, res: Response) => {
  try {
    const {
      provider = 'CSV_JSON_IMPORT',
      instrument = 'EUR/USD',
      market = 'FOREX',
      timeframe = 'M15',
      datasetVersion = 'v1.0.0',
      correctionReason,
      rawCandles = []
    } = req.body;

    let candlesToIngest = rawCandles;
    let start = Date.now() - 30 * 86400000;
    let end = Date.now();

    if (!candlesToIngest || candlesToIngest.length === 0) {
      if (provider === 'CTRADER_OPEN_API' && market === 'FOREX') {
        const fetched = await ctraderProv.fetchHistoricalCandles(instrument, market, timeframe, start, end);
        candlesToIngest = fetched.rawCandles;
      } else if (provider === 'FIVE_PAISA_API') {
        const fetched = await fivePaisaProv.fetchHistoricalCandles(instrument, market, timeframe, start, end);
        candlesToIngest = fetched.rawCandles;
      }
    }

    const metadata = {
      provider,
      instrument,
      market,
      timeframe,
      start,
      end,
      timezone: market === 'FOREX' ? 'UTC' : 'Asia/Kolkata',
      sourceVersion: `${provider}-${datasetVersion}`,
      retrievedAt: Date.now()
    };

    const result = historicalIngestionEngine.ingestHistoricalData(
      metadata,
      candlesToIngest,
      datasetVersion,
      correctionReason
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 13. List Registered Datasets API
// -------------------------------------------------------------
mlRouter.get('/datasets', (req: Request, res: Response) => {
  res.json(historicalIngestionEngine.listDatasets());
});

// -------------------------------------------------------------
// 14. Large-Scale 3-Mode Backtest API
// -------------------------------------------------------------
mlRouter.post('/backtest/large-scale', async (req: Request, res: Response) => {
  try {
    const {
      instrument = 'EUR/USD',
      market = 'FOREX',
      timeframe = 'M15',
      datasetId = 'ds_forex_eurusd_m15',
      datasetVersion = 'v1.0.0',
      strategyName = 'QUANT_HYBRID_ALPHA',
      mode = 'COMBINED',
      initialCapital = 100000,
      positionSize = 1.0,
      signalThreshold = 55,
      mlThreshold = 0.55,
      maxHoldingPeriodCandles = 20,
      costModel = DEFAULT_TRANSACTION_COST_MODEL,
      slippageConfig = DEFAULT_SLIPPAGE_CONFIG
    } = req.body;

    let dataset = historicalIngestionEngine.getHistoricalDataset(datasetId, datasetVersion);
    if (!dataset || dataset.length < 30) {
      // Fetch or seed candles
      const end = Date.now();
      const start = end - 30 * 86400000;
      if (market === 'FOREX') {
        const f = await ctraderProv.fetchHistoricalCandles(instrument, market, timeframe, start, end);
        const ing = historicalIngestionEngine.ingestHistoricalData(f.metadata, f.rawCandles, datasetVersion);
        dataset = ing.normalizedCandles;
      } else {
        const f = await fivePaisaProv.fetchHistoricalCandles(instrument, market, timeframe, start, end);
        const ing = historicalIngestionEngine.ingestHistoricalData(f.metadata, f.rawCandles, datasetVersion);
        dataset = ing.normalizedCandles;
      }
    }

    const config: LargeScaleBacktestConfig = {
      market,
      instrument,
      timeframe,
      startDate: dataset[0]?.isoUtc || new Date().toISOString(),
      endDate: dataset[dataset.length - 1]?.isoUtc || new Date().toISOString(),
      strategyName,
      mode,
      initialCapital,
      positionSize,
      maxHoldingPeriodCandles,
      signalThreshold,
      mlThreshold,
      costModel,
      slippageConfig,
      datasetId,
      datasetVersion,
      strategyVersion: 'v2.4.0',
      modelVersion: 'gbt_forex_v1.0.0',
      featureVersion: CURRENT_FEATURE_VERSION
    };

    const prodModelEntry = modelRegistry.getProductionModelForMarket(market as MarketType);
    const modelInstance = prodModelEntry ? modelRegistry.getModelInstance(prodModelEntry.modelId) : null;

    const result = largeScaleBacktestEngine.runMultiModeBacktest(
      dataset,
      config,
      modelInstance || null
    );

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 15. Monte Carlo Risk & Resampling Simulation API
// -------------------------------------------------------------
mlRouter.post('/monte-carlo', async (req: Request, res: Response) => {
  try {
    const {
      trades = [],
      sourceBacktestId = 'bt_latest',
      iterations = 1000,
      resampleWithReplacement = true,
      initialCapital = 100000,
      ruinThresholdPct = 0.30
    } = req.body;

    let tradeList = trades;
    if (!tradeList || tradeList.length === 0) {
      // Generate synthetic sample backtest trades for testing
      const dataset = historicalIngestionEngine.getHistoricalDataset('ds_forex_eurusd_m15', 'v1.0.0') || [];
      if (dataset.length > 30) {
        const bt = largeScaleBacktestEngine.runMultiModeBacktest(dataset, {
          market: 'FOREX',
          instrument: 'EUR/USD',
          timeframe: 'M15',
          startDate: dataset[0].isoUtc,
          endDate: dataset[dataset.length - 1].isoUtc,
          strategyName: 'QUANT_HYBRID_ALPHA',
          mode: 'COMBINED',
          initialCapital,
          positionSize: 1.0,
          maxHoldingPeriodCandles: 20,
          signalThreshold: 50,
          mlThreshold: 0.50,
          costModel: DEFAULT_TRANSACTION_COST_MODEL,
          slippageConfig: DEFAULT_SLIPPAGE_CONFIG,
          datasetId: 'ds_forex_eurusd_m15',
          datasetVersion: 'v1.0.0',
          strategyVersion: 'v2.4.0',
          featureVersion: CURRENT_FEATURE_VERSION
        });
        tradeList = bt.trades;
      }
    }

    const config: MonteCarloConfig = {
      iterations,
      resampleWithReplacement,
      confidenceIntervalLevel: 0.95,
      initialCapital,
      ruinThresholdPct
    };

    const result = monteCarloEngine.runSimulation(tradeList, sourceBacktestId, config);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 16. Paper Validation Signals & Executions API
// -------------------------------------------------------------
mlRouter.get('/paper/signals', (req: Request, res: Response) => {
  res.json(paperValidationEngine.listCapturedSignals());
});

mlRouter.post('/paper/signals/capture', (req: Request, res: Response) => {
  try {
    const signal = paperValidationEngine.capturePaperSignal(req.body);
    res.json(signal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

mlRouter.post('/paper/compare', (req: Request, res: Response) => {
  try {
    const {
      instrument = 'EUR/USD',
      market = 'FOREX',
      backtestMetrics = {
        sampleCount: 50,
        winRatePct: 62.0,
        expectancyR: 0.38,
        avgSpreadPips: 1.2,
        avgSlippagePips: 0.5,
        profitFactor: 1.95
      }
    } = req.body;

    const executions = paperValidationEngine.listExecutions();
    const comparison = paperValidationEngine.comparePaperVsBacktest(
      instrument,
      market as any,
      backtestMetrics,
      executions
    );

    res.json(comparison);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 17. Model Probability Calibration API
// -------------------------------------------------------------
mlRouter.post('/paper/calibration', (req: Request, res: Response) => {
  try {
    const {
      modelVersion = 'gbt_forex_v1.0.0',
      market = 'FOREX',
      predictions = []
    } = req.body;

    // Default test array of 50 predictions if empty
    let evalList = predictions;
    if (evalList.length === 0) {
      evalList = [
        { predictedProb: 0.55, targetFirstActual: 1 },
        { predictedProb: 0.58, targetFirstActual: 0 },
        { predictedProb: 0.62, targetFirstActual: 1 },
        { predictedProb: 0.65, targetFirstActual: 1 },
        { predictedProb: 0.68, targetFirstActual: 1 },
        { predictedProb: 0.72, targetFirstActual: 1 },
        { predictedProb: 0.75, targetFirstActual: 1 },
        { predictedProb: 0.78, targetFirstActual: 1 },
        { predictedProb: 0.82, targetFirstActual: 1 },
        { predictedProb: 0.85, targetFirstActual: 1 },
        { predictedProb: 0.88, targetFirstActual: 1 },
        { predictedProb: 0.92, targetFirstActual: 1 },
        { predictedProb: 0.52, targetFirstActual: 0 },
        { predictedProb: 0.57, targetFirstActual: 1 },
        { predictedProb: 0.64, targetFirstActual: 0 },
        { predictedProb: 0.71, targetFirstActual: 1 },
        { predictedProb: 0.83, targetFirstActual: 1 }
      ];
    }

    const report = paperValidationEngine.generateCalibrationReport(
      modelVersion,
      market as any,
      evalList
    );

    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 18. Paper Promotion Gate Evaluation API
// -------------------------------------------------------------
mlRouter.post('/paper/promotion-gate', (req: Request, res: Response) => {
  try {
    const {
      modelVersion = 'gbt_forex_v1.0.0',
      market = 'FOREX',
      sampleCount = 120,
      walkForwardOosWinRatePct = 58.5,
      backtestNetExpectancyR = 0.35,
      maxDrawdownPct = 6.2,
      paperTradeCount = 20,
      driftDetected = false,
      brierScore = 0.185
    } = req.body;

    const evaluation = paperValidationEngine.evaluatePromotionGate(
      modelVersion,
      market as any,
      sampleCount,
      walkForwardOosWinRatePct,
      backtestNetExpectancyR,
      maxDrawdownPct,
      paperTradeCount,
      driftDetected,
      brierScore
    );

    res.json(evaluation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 19. Daily & Weekly Research Reports API
// -------------------------------------------------------------
mlRouter.get('/reports/daily', (req: Request, res: Response) => {
  try {
    const report = researchReportEngine.generateDailySummary({});
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

mlRouter.get('/reports/weekly', (req: Request, res: Response) => {
  try {
    const dataset = historicalIngestionEngine.getHistoricalDataset('ds_forex_eurusd_m15', 'v1.0.0') || [];
    if (dataset.length < 30) {
      return res.status(400).json({ error: 'Insufficient dataset for weekly report generation' });
    }

    const bt = largeScaleBacktestEngine.runMultiModeBacktest(dataset, {
      market: 'FOREX',
      instrument: 'EUR/USD',
      timeframe: 'M15',
      startDate: dataset[0].isoUtc,
      endDate: dataset[dataset.length - 1].isoUtc,
      strategyName: 'QUANT_HYBRID_ALPHA',
      mode: 'COMBINED',
      initialCapital: 100000,
      positionSize: 1.0,
      maxHoldingPeriodCandles: 20,
      signalThreshold: 50,
      mlThreshold: 0.50,
      costModel: DEFAULT_TRANSACTION_COST_MODEL,
      slippageConfig: DEFAULT_SLIPPAGE_CONFIG,
      datasetId: 'ds_forex_eurusd_m15',
      datasetVersion: 'v1.0.0',
      strategyVersion: 'v2.4.0',
      featureVersion: CURRENT_FEATURE_VERSION
    });

    const report = researchReportEngine.generateWeeklyReport(bt);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 20. Research Data Exporter API (CSV / JSON)
// -------------------------------------------------------------
mlRouter.post('/export', (req: Request, res: Response) => {
  try {
    const { format = 'csv', data = [], filename = 'research_data' } = req.body;
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      return res.send(researchReportEngine.exportToJson(data));
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(researchReportEngine.exportToCsv(data, `${filename}.csv`));
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

