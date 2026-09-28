import { executeQuery } from '../database/db';

export type PairPredictionAuditBucket = {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: number | null;
  totalPnl: number;
  averagePnl: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  averageMfe: number | null;
  averageMae: number | null;
  averageHoldingMinutes: number | null;
  sampleSufficient: boolean;
};

export type PairPredictionAccuracyAudit = {
  generatedAt: number;
  minimumSampleCount: number;
  scope: {
    totalClosedTrades: number;
    evaluatedTrades: number;
    excludedWithoutOutcome: number;
    fromTimestamp: number | null;
    toTimestamp: number | null;
  };
  overall: PairPredictionAuditBucket;
  recent30d: PairPredictionAuditBucket;
  recent90d: PairPredictionAuditBucket;
  byPair: PairPredictionAuditBucket[];
  byDirection: PairPredictionAuditBucket[];
  byScoreBand: PairPredictionAuditBucket[];
  byRegime: PairPredictionAuditBucket[];
  bySession: PairPredictionAuditBucket[];
  byNewsRisk: PairPredictionAuditBucket[];
  byStrategy: PairPredictionAuditBucket[];
  warnings: string[];
};

type RawResearchTrade = {
  symbol: string;
  signal_timestamp: number;
  direction: string;
  score: number;
  market_regime: string;
  session: string;
  news_status: string | null;
  news_json: string | null;
  strategy_version: string;
  realized_pnl: number | null;
  outcome: string | null;
  mfe_pnl: number | null;
  mae_pnl: number | null;
  holding_duration_ms: number | null;
  lifecycle_status: string;
  execution_status: string | null;
};

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizedOutcome(row: RawResearchTrade): 'WIN' | 'LOSS' | 'BREAKEVEN' | null {
  const explicit = String(row.outcome || '').trim().toUpperCase();
  if (['WIN', 'WON', 'PROFIT', 'PROFITABLE'].includes(explicit)) return 'WIN';
  if (['LOSS', 'LOST', 'LOSING'].includes(explicit)) return 'LOSS';
  if (['BREAKEVEN', 'BREAK_EVEN', 'BE'].includes(explicit)) return 'BREAKEVEN';

  const pnl = numberOrNull(row.realized_pnl);
  if (pnl === null) return null;
  if (pnl > 0) return 'WIN';
  if (pnl < 0) return 'LOSS';
  return 'BREAKEVEN';
}

function scoreBand(score: number): string {
  if (!Number.isFinite(score)) return 'UNKNOWN';
  if (score < 60) return '<60';
  if (score < 65) return '60-64';
  if (score < 70) return '65-69';
  if (score < 75) return '70-74';
  if (score < 80) return '75-79';
  if (score < 85) return '80-84';
  if (score < 90) return '85-89';
  return '90+';
}

function newsRisk(row: RawResearchTrade): string {
  try {
    const parsed = row.news_json ? JSON.parse(row.news_json) : null;
    const value = parsed?.pairRisk?.riskLevel || parsed?.riskLevel || row.news_status;
    return String(value || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
  } catch {
    return String(row.news_status || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
  }
}

function emptyBucket(key: string): PairPredictionAuditBucket {
  return {
    key, trades: 0, wins: 0, losses: 0, breakeven: 0, winRatePct: null,
    totalPnl: 0, averagePnl: null, averageWin: null, averageLoss: null,
    profitFactor: null, expectancy: null, averageMfe: null, averageMae: null,
    averageHoldingMinutes: null, sampleSufficient: false
  };
}

function buildBucket(key: string, rows: RawResearchTrade[]): PairPredictionAuditBucket {
  const bucket = emptyBucket(key);
  const evaluated = rows.filter(row => normalizedOutcome(row) !== null);
  bucket.trades = evaluated.length;
  for (const row of evaluated) {
    const outcome = normalizedOutcome(row);
    if (outcome === 'WIN') bucket.wins++;
    else if (outcome === 'LOSS') bucket.losses++;
    else bucket.breakeven++;
  }

  const pnls = evaluated.map(row => numberOrNull(row.realized_pnl)).filter((v): v is number => v !== null);
  const wins = pnls.filter(v => v > 0);
  const losses = pnls.filter(v => v < 0);
  const mfes = evaluated.map(row => numberOrNull(row.mfe_pnl)).filter((v): v is number => v !== null);
  const maes = evaluated.map(row => numberOrNull(row.mae_pnl)).filter((v): v is number => v !== null);
  const holds = evaluated.map(row => numberOrNull(row.holding_duration_ms)).filter((v): v is number => v !== null);

  bucket.winRatePct = bucket.trades ? (bucket.wins / bucket.trades) * 100 : null;
  bucket.totalPnl = pnls.reduce((sum, value) => sum + value, 0);
  bucket.averagePnl = pnls.length ? bucket.totalPnl / pnls.length : null;
  bucket.averageWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : null;
  bucket.averageLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null;
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  bucket.profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  bucket.expectancy = pnls.length ? bucket.totalPnl / pnls.length : null;
  bucket.averageMfe = mfes.length ? mfes.reduce((sum, value) => sum + value, 0) / mfes.length : null;
  bucket.averageMae = maes.length ? maes.reduce((sum, value) => sum + value, 0) / maes.length : null;
  bucket.averageHoldingMinutes = holds.length ? holds.reduce((sum, value) => sum + value, 0) / holds.length / 60000 : null;
  bucket.sampleSufficient = bucket.trades >= 30;
  return bucket;
}

function grouped(rows: RawResearchTrade[], keyOf: (row: RawResearchTrade) => string): PairPredictionAuditBucket[] {
  const groups = new Map<string, RawResearchTrade[]>();
  for (const row of rows) {
    const key = keyOf(row) || 'UNKNOWN';
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => buildBucket(key, group))
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key));
}

function maxLosingStreak(rows: RawResearchTrade[]): number {
  let current = 0;
  let maximum = 0;
  for (const row of [...rows].sort((a, b) => Number(a.signal_timestamp) - Number(b.signal_timestamp))) {
    const outcome = normalizedOutcome(row);
    if (outcome === 'LOSS') {
      current++;
      maximum = Math.max(maximum, current);
    } else if (outcome === 'WIN') {
      current = 0;
    }
  }
  return maximum;
}

export async function getPairPredictionAccuracyAudit(params: {
  fromTimestamp?: number;
  toTimestamp?: number;
  minimumSampleCount?: number;
} = {}): Promise<PairPredictionAccuracyAudit> {
  const toTimestamp = Number(params.toTimestamp || Date.now());
  const fromTimestamp = params.fromTimestamp == null ? null : Number(params.fromTimestamp);
  const minimumSampleCount = Math.max(10, Math.min(1000, Math.floor(Number(params.minimumSampleCount) || 30)));

  const conditions = [
    "lifecycle_status = 'CLOSED'",
    'signal_timestamp <= ?'
  ];
  const values: unknown[] = [toTimestamp];
  if (fromTimestamp !== null && Number.isFinite(fromTimestamp)) {
    conditions.push('signal_timestamp >= ?');
    values.push(fromTimestamp);
  }

  const rows = await executeQuery<RawResearchTrade>(
    `SELECT symbol, signal_timestamp, direction, score, market_regime, session,
            news_status, news_json, strategy_version, realized_pnl, outcome,
            mfe_pnl, mae_pnl, holding_duration_ms, lifecycle_status, execution_status
       FROM live_trade_research
      WHERE ${conditions.join(' AND ')}
      ORDER BY signal_timestamp ASC
      LIMIT 200000`,
    values
  );

  const evaluated = rows.filter(row => normalizedOutcome(row) !== null);
  const now = toTimestamp;
  const dayMs = 24 * 60 * 60 * 1000;
  const recent30d = evaluated.filter(row => Number(row.signal_timestamp) >= now - 30 * dayMs);
  const recent90d = evaluated.filter(row => Number(row.signal_timestamp) >= now - 90 * dayMs);

  const overall = buildBucket('ALL', evaluated);
  const recent30 = buildBucket('30D', recent30d);
  const recent90 = buildBucket('90D', recent90d);
  overall.sampleSufficient = overall.trades >= minimumSampleCount;
  recent30.sampleSufficient = recent30.trades >= minimumSampleCount;
  recent90.sampleSufficient = recent90.trades >= minimumSampleCount;

  const warnings: string[] = [];
  if (overall.trades < minimumSampleCount) warnings.push(`Only ${overall.trades} evaluated closed trades are available; model conclusions should remain provisional.`);
  if (recent30.trades < minimumSampleCount) warnings.push(`The latest 30-day window has only ${recent30.trades} evaluated trades.`);
  if (recent90.trades >= minimumSampleCount && overall.trades >= minimumSampleCount) {
    const delta = (recent30.winRatePct ?? 0) - (recent90.winRatePct ?? 0);
    if (recent30.trades >= minimumSampleCount && Math.abs(delta) >= 10) {
      warnings.push(`Recent 30-day win rate differs from the 90-day window by ${delta.toFixed(1)} percentage points; treat this as regime drift, not proof of a persistent edge.`);
    }
  }
  const streak = maxLosingStreak(evaluated);
  if (streak >= 5) warnings.push(`Historical maximum losing streak is ${streak} trades.`);

  const applyMinimum = (buckets: PairPredictionAuditBucket[]) =>
    buckets.map(bucket => ({ ...bucket, sampleSufficient: bucket.trades >= minimumSampleCount }));

  return {
    generatedAt: Date.now(),
    minimumSampleCount,
    scope: {
      totalClosedTrades: rows.length,
      evaluatedTrades: evaluated.length,
      excludedWithoutOutcome: rows.length - evaluated.length,
      fromTimestamp,
      toTimestamp
    },
    overall: { ...overall },
    recent30d: { ...recent30 },
    recent90d: { ...recent90 },
    byPair: applyMinimum(grouped(evaluated, row => row.symbol)),
    byDirection: applyMinimum(grouped(evaluated, row => String(row.direction || 'UNKNOWN').toUpperCase())),
    byScoreBand: applyMinimum(grouped(evaluated, row => scoreBand(Number(row.score)))),
    byRegime: applyMinimum(grouped(evaluated, row => String(row.market_regime || 'UNKNOWN').toUpperCase())),
    bySession: applyMinimum(grouped(evaluated, row => String(row.session || 'UNKNOWN').toUpperCase())),
    byNewsRisk: applyMinimum(grouped(evaluated, row => newsRisk(row))),
    byStrategy: applyMinimum(grouped(evaluated, row => String(row.strategy_version || 'UNKNOWN'))),
    warnings: [
      ...warnings,
      overall.profitFactor !== null && overall.profitFactor < 1 ? 'Historical gross profit is below historical gross loss; win rate alone should not be used as the optimization target.' : ''
    ].filter(Boolean)
  };
}
