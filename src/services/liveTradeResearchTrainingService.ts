import { executeQuery, executeRun } from '../database/db';
import { getLiveTradeResearchFeatures, ResearchFeatureRow } from './liveTradeResearchFeatureService';

export interface ResearchTrainingRow extends ResearchFeatureRow {
  label1dReturnPct: number | null;
  label3dReturnPct: number | null;
  label7dReturnPct: number | null;
  label1dDirection: 'UP' | 'DOWN' | 'FLAT' | null;
  label3dDirection: 'UP' | 'DOWN' | 'FLAT' | null;
  label7dDirection: 'UP' | 'DOWN' | 'FLAT' | null;
}

function direction(returnPct: number | null): 'UP' | 'DOWN' | 'FLAT' | null {
  if (returnPct === null) return null;
  if (returnPct > 0) return 'UP';
  if (returnPct < 0) return 'DOWN';
  return 'FLAT';
}

async function buildTrainingRows(features: ResearchFeatureRow[]): Promise<ResearchTrainingRow[]> {
  const symbols = [...new Set(features.map(row => row.symbol))];
  const candles = new Map<string, Array<{ timestamp: number; close: number }>>();

  for (const symbol of symbols) {
    const rows = await executeQuery<any>(
      `SELECT timestamp, close
         FROM candles
        WHERE symbol = ? AND timeframe = 'Daily'
        ORDER BY timestamp ASC`,
      [symbol]
    );
    candles.set(symbol, rows
      .map(row => ({ timestamp: Number(row.timestamp), close: Number(row.close) }))
      .filter(row => row.timestamp > 0 && row.close > 0));
  }

  return features.map(feature => {
    const bars = candles.get(feature.symbol) || [];
    const future = bars.filter(bar => bar.timestamp > feature.signalTimestamp);
    // Use the first authoritative post-signal Daily close as the forward-return
    // baseline. Each label horizon then compares that baseline with the close
    // at the corresponding subsequent trading-day offset.
    const base = future[0]?.close ?? null;
    const closeAt = (offset: number) => future[offset]?.close ?? null;
    const calc = (offset: number) => {
      const target = closeAt(offset);
      if (base === null || target === null || base <= 0) return null;
      return ((target / base) - 1) * 100;
    };
    const label1dReturnPct = calc(1);
    const label3dReturnPct = calc(3);
    const label7dReturnPct = calc(7);

    return {
      ...feature,
      label1dReturnPct,
      label3dReturnPct,
      label7dReturnPct,
      label1dDirection: direction(label1dReturnPct),
      label3dDirection: direction(label3dReturnPct),
      label7dDirection: direction(label7dReturnPct)
    };
  });
}

export async function getLiveTradeResearchTrainingDataset(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
} = {}): Promise<ResearchTrainingRow[]> {
  const features = await getLiveTradeResearchFeatures({
    fromTimestamp: params.fromTimestamp,
    toTimestamp: params.toTimestamp,
    closedOnly: true,
    limit: params.limit || 50000
  });
  return buildTrainingRows(features);
}

export async function materializeLiveTradeResearchTrainingDataset(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
} = {}): Promise<{ rowsProcessed: number; labeled1d: number; labeled3d: number; labeled7d: number; updatedAt: number }> {
  const rows = await getLiveTradeResearchTrainingDataset({
    ...params,
    limit: 100000
  });
  const updatedAt = Date.now();

  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_labels (
    signal_id TEXT NOT NULL,
    label_version TEXT NOT NULL,
    horizon TEXT NOT NULL,
    label_source TEXT NOT NULL,
    actual_direction TEXT,
    forward_return_pct REAL,
    profitable INTEGER,
    realized_pnl REAL,
    outcome_label TEXT,
    entry_price REAL,
    exit_price REAL,
    stop_loss REAL,
    take_profit REAL,
    stop_hit INTEGER,
    target_hit INTEGER,
    mfe_pnl REAL,
    mae_pnl REAL,
    holding_duration_ms INTEGER,
    exit_timestamp INTEGER,
    labeled_at INTEGER NOT NULL,
    PRIMARY KEY(signal_id, label_version, horizon)
  )`);
  await executeRun(`CREATE TABLE IF NOT EXISTS live_trade_research_training (
    signal_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    signal_timestamp INTEGER NOT NULL,
    direction TEXT NOT NULL,
    score REAL NOT NULL,
    market_regime TEXT NOT NULL,
    session TEXT NOT NULL,
    trend_direction TEXT NOT NULL,
    trend_alignment TEXT NOT NULL,
    trend_7d_return_pct REAL,
    trend_30d_return_pct REAL,
    trend_90d_return_pct REAL,
    trend_365d_return_pct REAL,
    trend_7d_volatility_pct REAL,
    trend_30d_volatility_pct REAL,
    trend_90d_volatility_pct REAL,
    trend_365d_volatility_pct REAL,
    news_risk_level TEXT,
    news_high_impact_count INTEGER NOT NULL,
    news_active_high_impact_count INTEGER NOT NULL,
    news_sentiment REAL,
    quote_spread REAL,
    risk_reward REAL,
    stop_distance REAL,
    target_distance REAL,
    realized_pnl REAL,
    outcome TEXT,
    holding_duration_ms REAL,
    label_1d_return_pct REAL,
    label_3d_return_pct REAL,
    label_7d_return_pct REAL,
    label_1d_direction TEXT,
    label_3d_direction TEXT,
    label_7d_direction TEXT,
    updated_at INTEGER NOT NULL
  )`);

  for (const row of rows) {
    await executeRun(
      `INSERT OR REPLACE INTO live_trade_research_training (
        signal_id, symbol, signal_timestamp, direction, score, market_regime, session,
        trend_direction, trend_alignment, trend_7d_return_pct, trend_30d_return_pct,
        trend_90d_return_pct, trend_365d_return_pct, trend_7d_volatility_pct,
        trend_30d_volatility_pct, trend_90d_volatility_pct, trend_365d_volatility_pct,
        news_risk_level, news_high_impact_count, news_active_high_impact_count, news_sentiment,
        quote_spread, risk_reward, stop_distance, target_distance, realized_pnl, outcome,
        holding_duration_ms, label_1d_return_pct, label_3d_return_pct, label_7d_return_pct,
        label_1d_direction, label_3d_direction, label_7d_direction, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.signalId, row.symbol, row.signalTimestamp, row.direction, row.score,
        row.marketRegime, row.session, row.trendDirection, row.trendAlignment,
        row.trend7dReturnPct, row.trend30dReturnPct, row.trend90dReturnPct, row.trend365dReturnPct,
        row.trend7dVolatilityPct, row.trend30dVolatilityPct, row.trend90dVolatilityPct, row.trend365dVolatilityPct,
        row.newsRiskLevel, row.newsHighImpactCount, row.newsActiveHighImpactCount, row.newsSentiment,
        row.quoteSpread, row.riskReward, row.stopDistance, row.targetDistance, row.realizedPnl, row.outcome,
        row.holdingDurationMs, row.label1dReturnPct, row.label3dReturnPct, row.label7dReturnPct,
        row.label1dDirection, row.label3dDirection, row.label7dDirection, updatedAt
      ]
    );
  }

  // Persist the forward-market labels separately from the realized broker outcome.
  // This prevents the training/evaluation layer from confusing a 1D directional
  // label with the actual profitability of a closed trade.
  for (const row of rows) {
    const realizedPnl = row.realizedPnl;
    const explicitOutcome = String(row.outcome || '').trim().toUpperCase();
    const outcomeLabel = explicitOutcome || (realizedPnl === null ? null : realizedPnl > 0 ? 'WIN' : realizedPnl < 0 ? 'LOSS' : 'BREAKEVEN');
    const profitable = realizedPnl === null ? null : realizedPnl > 0 ? 1 : 0;
    const horizons: Array<{ horizon: '1D' | '3D' | '7D'; direction: string | null; forward: number | null }> = [
      { horizon: '1D', direction: row.label1dDirection, forward: row.label1dReturnPct },
      { horizon: '3D', direction: row.label3dDirection, forward: row.label3dReturnPct },
      { horizon: '7D', direction: row.label7dDirection, forward: row.label7dReturnPct }
    ];
    for (const label of horizons) {
      await executeRun(
        `INSERT OR REPLACE INTO live_trade_research_labels (
          signal_id, label_version, horizon, label_source, actual_direction,
          forward_return_pct, profitable, realized_pnl, outcome_label,
          entry_price, exit_price, stop_loss, take_profit, stop_hit, target_hit,
          mfe_pnl, mae_pnl, holding_duration_ms, exit_timestamp, labeled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.signalId, 'PHASE10_V1', label.horizon, 'DAILY_FORWARD_PLUS_REALIZED_TRADE',
          label.direction, label.forward, profitable, realizedPnl, outcomeLabel,
          null, null, row.stopDistance, row.targetDistance, null, null,
          null, null, row.holdingDurationMs, null, updatedAt
        ]
      );
    }
  }

  return {
    rowsProcessed: rows.length,
    labeled1d: rows.filter(row => row.label1dReturnPct !== null).length,
    labeled3d: rows.filter(row => row.label3dReturnPct !== null).length,
    labeled7d: rows.filter(row => row.label7dReturnPct !== null).length,
    updatedAt
  };
}
