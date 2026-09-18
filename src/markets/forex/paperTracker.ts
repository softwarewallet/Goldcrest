import { executeQuery, executeRun } from '../../database/db';
import { PaperSignalTrackingRecord, ForexSignal } from './types';
import { getForexPairConfig } from './instruments';

export class PaperSignalTracker {
  private activeTracks: Map<string, PaperSignalTrackingRecord> = new Map();

  /**
   * Initializes or activates tracking for a generated actionable signal
   */
  async trackSignal(signal: ForexSignal, currentPrice: number): Promise<PaperSignalTrackingRecord | null> {
    if (!signal.tradePlan || signal.direction === 'NO_TRADE' || signal.direction === 'NEUTRAL') {
      return null;
    }

    const config = getForexPairConfig(signal.pair);
    const isBuy = signal.direction.includes('BUY');
    const entryPrice = signal.tradePlan.entryPreferred;

    const riskPips = Math.abs(currentPrice - entryPrice) / config.pipSize;
    const unrealizedPips = isBuy ? (currentPrice - entryPrice) / config.pipSize : (entryPrice - currentPrice) / config.pipSize;
    // Standard lot calculation ($10/pip for standard major)
    const pipValueUsd = 10;
    const unrealizedUsd = unrealizedPips * pipValueUsd;

    const record: PaperSignalTrackingRecord = {
      id: `PTRK_${signal.id}`,
      signalId: signal.id,
      pair: signal.pair,
      direction: isBuy ? 'BUY' : 'SELL',
      entryPrice,
      currentPrice,
      stopLoss: signal.tradePlan.stopLoss,
      tp1: signal.tradePlan.takeProfit1.targetPrice,
      tp2: signal.tradePlan.takeProfit2.targetPrice,
      tp3: signal.tradePlan.takeProfit3.targetPrice,
      unrealizedPnlPips: Number(unrealizedPips.toFixed(1)),
      unrealizedPnlUsd: Number(unrealizedUsd.toFixed(2)),
      status: 'ACTIVE',
      exitCondition: null,
      entryTimestamp: Date.now(),
      lastUpdatedTimestamp: Date.now(),
      exitTimestamp: null
    };

    this.activeTracks.set(record.id, record);
    await this.persistRecord(record);
    return record;
  }

  /**
   * Updates an active paper track with latest tick/candle price and checks for SL/TP exit
   */
  async updatePrice(trackId: string, currentPrice: number): Promise<PaperSignalTrackingRecord | null> {
    let track = this.activeTracks.get(trackId);
    if (!track) {
      // Try loading from DB
      const rows = await executeQuery<any>('SELECT * FROM paper_tracking WHERE id = ?', [trackId]);
      if (rows.length > 0) {
        track = this.mapDbRowToRecord(rows[0]);
        this.activeTracks.set(track.id, track);
      }
    }

    if (!track || track.status !== 'ACTIVE') return track ?? null;

    const config = getForexPairConfig(track.pair);
    const isBuy = track.direction === 'BUY';
    const entryPrice = track.entryPrice;

    track.currentPrice = currentPrice;
    track.lastUpdatedTimestamp = Date.now();

    const unrealizedPips = isBuy ? (currentPrice - entryPrice) / config.pipSize : (entryPrice - currentPrice) / config.pipSize;
    track.unrealizedPnlPips = Number(unrealizedPips.toFixed(1));
    track.unrealizedPnlUsd = Number((unrealizedPips * 10).toFixed(2));

    // Check TP / SL hit
    if (isBuy) {
      if (currentPrice <= track.stopLoss) {
        track.status = 'STOPPED';
        track.exitCondition = `Stopped out at ${currentPrice.toFixed(config.digits)} (SL: ${track.stopLoss.toFixed(config.digits)})`;
        track.exitTimestamp = Date.now();
      } else if (currentPrice >= track.tp3) {
        track.status = 'TP3_HIT';
        track.exitCondition = `Target 3 reached at ${currentPrice.toFixed(config.digits)}`;
        track.exitTimestamp = Date.now();
      } else if (currentPrice >= track.tp2) {
        track.status = 'TP2_HIT';
        track.exitCondition = `Target 2 reached at ${currentPrice.toFixed(config.digits)}`;
      } else if (currentPrice >= track.tp1) {
        track.status = 'TP1_HIT';
        track.exitCondition = `Target 1 reached at ${currentPrice.toFixed(config.digits)}`;
      }
    } else {
      if (currentPrice >= track.stopLoss) {
        track.status = 'STOPPED';
        track.exitCondition = `Stopped out at ${currentPrice.toFixed(config.digits)} (SL: ${track.stopLoss.toFixed(config.digits)})`;
        track.exitTimestamp = Date.now();
      } else if (currentPrice <= track.tp3) {
        track.status = 'TP3_HIT';
        track.exitCondition = `Target 3 reached at ${currentPrice.toFixed(config.digits)}`;
        track.exitTimestamp = Date.now();
      } else if (currentPrice <= track.tp2) {
        track.status = 'TP2_HIT';
        track.exitCondition = `Target 2 reached at ${currentPrice.toFixed(config.digits)}`;
      } else if (currentPrice <= track.tp1) {
        track.status = 'TP1_HIT';
        track.exitCondition = `Target 1 reached at ${currentPrice.toFixed(config.digits)}`;
      }
    }

    await this.persistRecord(track);
    return track;
  }

  /**
   * Retrieves all paper tracking records
   */
  async getAllTracked(): Promise<PaperSignalTrackingRecord[]> {
    try {
      const rows = await executeQuery<any>('SELECT * FROM paper_tracking ORDER BY entry_timestamp DESC LIMIT 50');
      return rows.map(r => this.mapDbRowToRecord(r));
    } catch {
      return Array.from(this.activeTracks.values());
    }
  }

  private async persistRecord(record: PaperSignalTrackingRecord): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO paper_tracking (
        id, signal_id, pair, direction, entry_price, current_price,
        stop_loss, tp1, tp2, tp3, unrealized_pnl_pips, unrealized_pnl_usd,
        status, exit_condition, entry_timestamp, last_updated_timestamp, exit_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await executeRun(sql, [
      record.id,
      record.signalId,
      record.pair,
      record.direction,
      record.entryPrice,
      record.currentPrice,
      record.stopLoss,
      record.tp1,
      record.tp2,
      record.tp3,
      record.unrealizedPnlPips,
      record.unrealizedPnlUsd,
      record.status,
      record.exitCondition,
      record.entryTimestamp,
      record.lastUpdatedTimestamp,
      record.exitTimestamp
    ]);
  }

  private mapDbRowToRecord(r: any): PaperSignalTrackingRecord {
    return {
      id: r.id,
      signalId: r.signal_id,
      pair: r.pair,
      direction: r.direction,
      entryPrice: r.entry_price,
      currentPrice: r.current_price,
      stopLoss: r.stop_loss,
      tp1: r.tp1,
      tp2: r.tp2,
      tp3: r.tp3,
      unrealizedPnlPips: r.unrealized_pnl_pips,
      unrealizedPnlUsd: r.unrealized_pnl_usd,
      status: r.status,
      exitCondition: r.exit_condition,
      entryTimestamp: r.entry_timestamp,
      lastUpdatedTimestamp: r.last_updated_timestamp,
      exitTimestamp: r.exit_timestamp
    };
  }
}

export const paperSignalTracker = new PaperSignalTracker();
