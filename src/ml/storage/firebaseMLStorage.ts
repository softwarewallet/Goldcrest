import { FeatureSnapshot, OutcomeLabel, MLPrediction, ModelRegistryEntry, BacktestResult } from '../types';
import { executeQuery, executeRun } from '../../database/db';

// SQLite is the authoritative local ML persistence layer.
export class FirebaseMLStorage {
  private async save(recordType: string, id: string, payload: any, timestamp: number): Promise<void> {
    await executeRun(
      'INSERT OR REPLACE INTO ml_storage_records (id, record_type, payload_json, timestamp) VALUES (?, ?, ?, ?)',
      [id, recordType, JSON.stringify(payload), timestamp]
    );
  }

  public async saveFeatureSnapshot(snapshot: FeatureSnapshot): Promise<void> {
    await this.save('FEATURE_SNAPSHOT', snapshot.featureSnapshotId, snapshot, Date.now());
  }

  public async saveOutcomeLabel(label: OutcomeLabel): Promise<void> {
    await this.save('OUTCOME_LABEL', label.outcomeId, label, Date.now());
  }

  public async savePrediction(prediction: MLPrediction): Promise<void> {
    await this.save('PREDICTION', prediction.predictionId, prediction, prediction.timestamp);
  }

  public async saveModelEntry(entry: ModelRegistryEntry): Promise<void> {
    await this.save('MODEL', entry.modelId, entry, Date.now());
  }

  public async saveBacktestResult(result: BacktestResult): Promise<void> {
    await this.save('BACKTEST', result.backtestId, result, result.timestamp);
  }

  public async getRecentPredictions(max: number = 50): Promise<MLPrediction[]> {
    const rows = await executeQuery<any>(
      'SELECT payload_json FROM ml_storage_records WHERE record_type = ? ORDER BY timestamp DESC LIMIT ?',
      ['PREDICTION', max]
    );
    return rows.map(r => JSON.parse(r.payload_json) as MLPrediction);
  }

  public async getInMemoryBacktests(): Promise<BacktestResult[]> {
    const rows = await executeQuery<any>(
      'SELECT payload_json FROM ml_storage_records WHERE record_type = ? ORDER BY timestamp DESC',
      ['BACKTEST']
    );
    return rows.map(r => JSON.parse(r.payload_json) as BacktestResult);
  }

  public async getStats(): Promise<{
    snapshotsCount: number;
    labelsCount: number;
    predictionsCount: number;
    modelsCount: number;
    backtestsCount: number;
  }> {
    const rows = await executeQuery<any>(
      'SELECT record_type, COUNT(*) AS count FROM ml_storage_records GROUP BY record_type'
    );
    const counts: Record<string, number> = {};
    rows.forEach(r => { counts[r.record_type] = Number(r.count); });
    return {
      snapshotsCount: counts.FEATURE_SNAPSHOT || 0,
      labelsCount: counts.OUTCOME_LABEL || 0,
      predictionsCount: counts.PREDICTION || 0,
      modelsCount: counts.MODEL || 0,
      backtestsCount: counts.BACKTEST || 0
    };
  }
}

export const firebaseMLStorage = new FirebaseMLStorage();
