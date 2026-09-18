// ============================================================================
// FIREBASE FIRESTORE ML STORAGE BRIDGE & IMMUTABLE PERSISTENCE LAYER
// ============================================================================

import {
  FeatureSnapshot,
  OutcomeLabel,
  MLPrediction,
  ModelRegistryEntry,
  BacktestResult
} from '../types';
import { db, auth } from '../../firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';

export class FirebaseMLStorage {
  private inMemorySnapshots: Map<string, FeatureSnapshot> = new Map();
  private inMemoryLabels: Map<string, OutcomeLabel> = new Map();
  private inMemoryPredictions: Map<string, MLPrediction> = new Map();
  private inMemoryModels: Map<string, ModelRegistryEntry> = new Map();
  private inMemoryBacktests: Map<string, BacktestResult> = new Map();

  /**
   * Persists an immutable feature snapshot.
   */
  public async saveFeatureSnapshot(snapshot: FeatureSnapshot): Promise<void> {
    // In-memory cache
    this.inMemorySnapshots.set(snapshot.featureSnapshotId, snapshot);

    try {
      if (db) {
        const ref = doc(db, 'ml_feature_snapshots', snapshot.featureSnapshotId);
        await setDoc(ref, {
          ...snapshot,
          savedAt: new Date()
        });
      }
    } catch (err) {
      console.warn('Firestore ML snapshot save fallback to memory:', err);
    }
  }

  /**
   * Persists an immutable outcome label.
   */
  public async saveOutcomeLabel(label: OutcomeLabel): Promise<void> {
    this.inMemoryLabels.set(label.outcomeId, label);

    try {
      if (db) {
        const ref = doc(db, 'ml_outcome_labels', label.outcomeId);
        await setDoc(ref, {
          ...label,
          savedAt: new Date()
        });
      }
    } catch (err) {
      console.warn('Firestore ML outcome save fallback to memory:', err);
    }
  }

  /**
   * Persists prediction record.
   */
  public async savePrediction(prediction: MLPrediction): Promise<void> {
    this.inMemoryPredictions.set(prediction.predictionId, prediction);

    try {
      if (db) {
        const ref = doc(db, 'ml_prediction_records', prediction.predictionId);
        await setDoc(ref, {
          ...prediction,
          savedAt: new Date()
        });
      }
    } catch (err) {
      console.warn('Firestore ML prediction save fallback to memory:', err);
    }
  }

  /**
   * Saves or updates a model registry entry.
   */
  public async saveModelEntry(entry: ModelRegistryEntry): Promise<void> {
    this.inMemoryModels.set(entry.modelId, entry);

    try {
      if (db) {
        const ref = doc(db, 'ml_models', entry.modelId);
        await setDoc(ref, {
          ...entry,
          savedAt: new Date()
        });
      }
    } catch (err) {
      console.warn('Firestore ML model entry save fallback to memory:', err);
    }
  }

  /**
   * Saves backtest result.
   */
  public async saveBacktestResult(result: BacktestResult): Promise<void> {
    this.inMemoryBacktests.set(result.backtestId, result);

    try {
      if (db) {
        const ref = doc(db, 'ml_backtest_results', result.backtestId);
        await setDoc(ref, {
          ...result,
          savedAt: new Date()
        });
      }
    } catch (err) {
      console.warn('Firestore ML backtest save fallback to memory:', err);
    }
  }

  /**
   * Retrieves all predictions with optional limit.
   */
  public async getRecentPredictions(max: number = 50): Promise<MLPrediction[]> {
    const list = Array.from(this.inMemoryPredictions.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, max);
    return list;
  }

  public getInMemoryBacktests(): BacktestResult[] {
    return Array.from(this.inMemoryBacktests.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public getStats(): {
    snapshotsCount: number;
    labelsCount: number;
    predictionsCount: number;
    modelsCount: number;
    backtestsCount: number;
  } {
    return {
      snapshotsCount: this.inMemorySnapshots.size,
      labelsCount: this.inMemoryLabels.size,
      predictionsCount: this.inMemoryPredictions.size,
      modelsCount: this.inMemoryModels.size,
      backtestsCount: this.inMemoryBacktests.size
    };
  }
}

export const firebaseMLStorage = new FirebaseMLStorage();
