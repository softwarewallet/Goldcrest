import { executeQuery, executeRun } from '../database/db';
import { LiveNewsSnapshot } from './liveNewsService';

export interface LiveTradeResearchSignal {
  signalId: string;
  symbol: string;
  timestamp: number;
  direction: string;
  signalCategory: string;
  score: number;
  scoreBreakdown: unknown;
  strategyVersion: string;
  modelVersion: string;
  marketRegime: string;
  session: string;
  dataStatus: string;
  tradePlan?: {
    entryMin?: number;
    entryMax?: number;
    entryPreferred?: number;
    entryType?: string;
    stopLoss?: number;
    takeProfit1?: number;
    takeProfit2?: number;
    takeProfit3?: number;
    riskReward?: number;
  } | null;
  reasons?: string[];
  noTradeReasons?: string[];
  quote?: {
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    status: string;
  } | null;
  requestedRiskQuantity?: number;
  configuredQuantity?: number;
  news?: LiveNewsSnapshot | null;
  context?: Record<string, unknown>;
}

export interface LiveTradeResearchExecution {
  signalId: string;
  status: string;
  code?: string;
  reason?: string;
  brokerOrderId?: string;
  executedEntryPrice?: number;
  executedQuantity?: number;
  commission?: number;
  brokerStatus?: string;
  executionTimestamp?: number;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function pairNews(snapshot: LiveNewsSnapshot | null | undefined, symbol: string): unknown {
  if (!snapshot) return null;
  const pairRisk = snapshot.pairRisk?.[symbol];
  return {
    status: snapshot.status,
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    articleCount: snapshot.articleCount,
    highImpactCount: snapshot.highImpactCount,
    activeHighImpactCount: snapshot.activeHighImpactCount,
    elevatedCount: snapshot.elevatedCount,
    riskLevel: snapshot.riskLevel,
    sentimentSummary: snapshot.sentimentSummary,
    providerStatus: snapshot.providerStatus,
    pairRisk: pairRisk || null
  };
}

/**
 * Durable research ledger for live Auto Trading.
 *
 * This is intentionally observational: it records what Goldcrest knew and
 * decided at signal time, plus the eventual broker result. It does not alter
 * execution or safety decisions.
 */
export async function recordLiveTradeResearchSignal(signal: LiveTradeResearchSignal): Promise<void> {
  const plan = signal.tradePlan || {};
  const news = pairNews(signal.news, signal.symbol);

  await executeRun(
    `INSERT OR REPLACE INTO live_trade_research (
      signal_id, symbol, broker, environment, signal_timestamp, captured_at,
      direction, signal_category, score, score_breakdown_json,
      strategy_version, model_version, market_regime, session, data_status,
      entry_min, entry_max, entry_preferred, entry_type,
      stop_loss, take_profit_1, take_profit_2, take_profit_3, risk_reward,
      quote_bid, quote_ask, quote_spread, quote_timestamp, quote_status,
      requested_risk_quantity, configured_quantity,
      news_status, news_source, news_json,
      reasons_json, no_trade_reasons_json, context_json,
      lifecycle_status, updated_at
    ) VALUES (
      ?, ?, 'CTRADER', 'LIVE', ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      'SIGNAL_EVALUATED', ?
    )`,
    [
      signal.signalId,
      signal.symbol,
      signal.timestamp,
      Date.now(),
      signal.direction,
      signal.signalCategory,
      Number(signal.score),
      json(signal.scoreBreakdown),
      signal.strategyVersion,
      signal.modelVersion,
      signal.marketRegime,
      signal.session,
      signal.dataStatus,
      Number(plan.entryMin ?? 0),
      Number(plan.entryMax ?? 0),
      Number(plan.entryPreferred ?? 0),
      plan.entryType || null,
      Number(plan.stopLoss ?? 0),
      Number(plan.takeProfit1 ?? 0),
      Number(plan.takeProfit2 ?? 0),
      plan.takeProfit3 == null ? null : Number(plan.takeProfit3),
      Number(plan.riskReward ?? 0),
      signal.quote?.bid ?? null,
      signal.quote?.ask ?? null,
      signal.quote?.spread ?? null,
      signal.quote?.timestamp ?? null,
      signal.quote?.status ?? null,
      signal.requestedRiskQuantity ?? null,
      signal.configuredQuantity ?? null,
      (news as any)?.status ?? null,
      (news as any)?.source ?? null,
      json(news),
      json(signal.reasons || []),
      json(signal.noTradeReasons || []),
      json(signal.context || {}),
      Date.now()
    ]
  );
}

export async function updateLiveTradeResearchQuote(params: {
  signalId: string;
  quote?: {
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    status: string;
  } | null;
  requestedRiskQuantity?: number;
  configuredQuantity?: number;
  context?: Record<string, unknown>;
}): Promise<void> {
  await executeRun(
    `UPDATE live_trade_research
       SET quote_bid = ?,
           quote_ask = ?,
           quote_spread = ?,
           quote_timestamp = ?,
           quote_status = ?,
           requested_risk_quantity = ?,
           configured_quantity = ?,
           context_json = CASE
             WHEN ? IS NULL THEN context_json
             ELSE ?
           END,
           updated_at = ?
     WHERE signal_id = ?`,
    [
      params.quote?.bid ?? null,
      params.quote?.ask ?? null,
      params.quote?.spread ?? null,
      params.quote?.timestamp ?? null,
      params.quote?.status ?? null,
      params.requestedRiskQuantity ?? null,
      params.configuredQuantity ?? null,
      params.context ? json(params.context) : null,
      params.context ? json(params.context) : null,
      Date.now(),
      params.signalId
    ]
  );
}

export async function updateLiveTradeResearchExecution(execution: LiveTradeResearchExecution): Promise<void> {
  const status = String(execution.status || '').toUpperCase();
  const lifecycleStatus =
    status === 'FILLED' || status === 'EXECUTED'
      ? 'OPEN'
      : ['REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED', 'BLOCKED'].includes(status)
        ? 'NOT_EXECUTED'
        : 'SUBMITTED';

  await executeRun(
    `UPDATE live_trade_research
       SET lifecycle_status = ?,
           execution_status = ?,
           execution_code = ?,
           execution_reason = ?,
           broker_order_id = ?,
           executed_entry_price = ?,
           executed_quantity = ?,
           commission = ?,
           broker_status = ?,
           execution_timestamp = ?,
           updated_at = ?
     WHERE signal_id = ?`,
    [
      lifecycleStatus,
      status,
      execution.code || null,
      execution.reason || null,
      execution.brokerOrderId || null,
      execution.executedEntryPrice ?? null,
      execution.executedQuantity ?? null,
      execution.commission ?? null,
      execution.brokerStatus || status,
      execution.executionTimestamp || Date.now(),
      Date.now(),
      execution.signalId
    ]
  );
}

export async function getLiveTradeResearch(signalId?: string): Promise<any[]> {
  if (signalId) {
    return executeQuery(
      'SELECT * FROM live_trade_research WHERE signal_id = ?',
      [signalId]
    );
  }
  return executeQuery(
    'SELECT * FROM live_trade_research ORDER BY signal_timestamp DESC LIMIT 500'
  );
}
