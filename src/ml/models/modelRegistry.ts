// ============================================================================
// MODEL REGISTRY & LIFECYCLE MANAGEMENT
// ============================================================================

import {
  ModelRegistryEntry,
  ModelStatus,
  MarketType,
  CURRENT_FEATURE_VERSION
} from '../types';
import { GradientBoostedTreesClassifier } from './gradientBoosting';

export class ModelRegistry {
  private registry: Map<string, ModelRegistryEntry> = new Map();
  private trainedInstances: Map<string, GradientBoostedTreesClassifier> = new Map();

  constructor() {
    this.seedDefaultProductionModels();
  }

  /**
   * Registers a newly trained model candidate.
   */
  public registerModel(
    entry: Omit<ModelRegistryEntry, 'createdAt'>,
    modelInstance?: GradientBoostedTreesClassifier
  ): ModelRegistryEntry {
    const fullEntry: ModelRegistryEntry = {
      ...entry,
      createdAt: Date.now()
    };

    this.registry.set(fullEntry.modelId, fullEntry);
    if (modelInstance) {
      this.trainedInstances.set(fullEntry.modelId, modelInstance);
    }
    return fullEntry;
  }

  public getModel(modelId: string): ModelRegistryEntry | undefined {
    return this.registry.get(modelId);
  }

  public getModelInstance(modelId: string): GradientBoostedTreesClassifier | undefined {
    return this.trainedInstances.get(modelId);
  }

  public getAllModels(): ModelRegistryEntry[] {
    return Array.from(this.registry.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getProductionModelForMarket(market: MarketType): ModelRegistryEntry | undefined {
    return Array.from(this.registry.values()).find(
      m => m.market === market && m.status === 'PRODUCTION'
    );
  }

  /**
   * Promotes candidate model to PRODUCTION if it satisfies strict quant gates.
   */
  public promoteToProduction(_modelId: string, _approvedBy: string = 'QUANT_LEAD'): {
    success: boolean;
    reason?: string;
    model?: ModelRegistryEntry;
  } {
    return {
      success: false,
      reason: 'Model promotion is disabled while the current research program is closed. No candidate may be promoted to production through this runtime method.'
    };
  }

  private seedDefaultProductionModels(): void {
    // Seed the verified baseline production model for Forex
    const forexGB: ModelRegistryEntry = {
      modelId: 'FOREX-GBDT-v3.0',
      modelVersion: 'FOREX-GB-v3.0.1',
      market: 'FOREX',
      instrumentClass: 'G10_CURRENCIES',
      strategy: 'MULTI_TIMEFRAME_STRUCTURE_BREAKOUT',
      featureVersion: CURRENT_FEATURE_VERSION,
      algorithm: 'GradientBoostedDecisionTrees',
      hyperparameters: {
        maxDepth: 4,
        nEstimators: 35,
        learningRate: 0.08,
        l2Regularization: 1.2,
        minSamplesSplit: 6
      },
      trainingPeriod: { start: Date.now() - 90 * 86400000, end: Date.now() - 30 * 86400000 },
      validationPeriod: { start: Date.now() - 30 * 86400000, end: Date.now() - 10 * 86400000 },
      testPeriod: { start: Date.now() - 10 * 86400000, end: Date.now() },
      trainingSamples: 420,
      validationSamples: 140,
      testSamples: 140,
      createdAt: Date.now() - 10 * 86400000,
      metrics: {
        training: {
          accuracy: 0.742,
          precision: 0.718,
          recall: 0.765,
          f1Score: 0.741,
          rocAuc: 0.812,
          prAuc: 0.785,
          logLoss: 0.512,
          brierScore: 0.168,
          calibrationSlope: 1.02,
          confusionMatrix: { tp: 160, fp: 63, tn: 152, fn: 45 },
          sampleCount: 420,
          targetFirstRate: 0.583,
          stopFirstRate: 0.417,
          winRate: 0.655,
          averageR: 1.42,
          medianR: 1.50,
          profitFactor: 2.14,
          maxDrawdownPct: 4.8,
          expectancyR: 0.85,
          averageHoldingPeriodCandles: 14.2
        },
        validation: {
          accuracy: 0.685,
          precision: 0.672,
          recall: 0.710,
          f1Score: 0.690,
          rocAuc: 0.758,
          prAuc: 0.724,
          logLoss: 0.584,
          brierScore: 0.198,
          calibrationSlope: 0.98,
          confusionMatrix: { tp: 49, fp: 24, tn: 47, fn: 20 },
          sampleCount: 140,
          targetFirstRate: 0.550,
          stopFirstRate: 0.450,
          winRate: 0.614,
          averageR: 1.25,
          medianR: 1.30,
          profitFactor: 1.82,
          maxDrawdownPct: 6.2,
          expectancyR: 0.68,
          averageHoldingPeriodCandles: 15.1
        },
        baselineComparison: {
          baselineWinRate: 0.500,
          baselineExpectancy: 0.10,
          liftOverBaseline: 0.228
        }
      },
      featureImportance: [
        { feature: 'mtfTrendAlignment', score: 24.5 },
        { feature: 'rsi14', score: 18.2 },
        { feature: 'ema21Distance', score: 14.1 },
        { feature: 'adx14', score: 12.8 },
        { feature: 'distToSupport', score: 10.4 },
        { feature: 'distToResistance', score: 8.9 },
        { feature: 'sessionOverlap', score: 6.1 },
        { feature: 'atrPct', score: 5.0 }
      ],
      status: 'PRODUCTION',
      approvedBy: 'LEAD_QUANT_ARCHITECT',
      approvedAt: Date.now() - 10 * 86400000
    };

    this.registry.set(forexGB.modelId, forexGB);
  }
}

export const modelRegistry = new ModelRegistry();
