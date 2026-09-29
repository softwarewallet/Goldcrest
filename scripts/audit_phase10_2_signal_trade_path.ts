import { executeQuery } from '../src/database/db';

type Trade = {
  signal_id: string; symbol: string; signal_timestamp: number; direction: string;
  score: number; entry_preferred: number | null; stop_loss: number | null;
  take_profit_1: number | null; execution_timestamp: number | null;
  executed_entry_price: number | null; exit_timestamp: number | null;
  exit_price: number | null; realized_pnl: number | null; outcome: string | null;
  mfe_pnl: number | null; mae_pnl: number | null;
};
type Candle = {
  timeframe: string; timestamp: number; open: number; high: number; low: number; close: number;
};

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const ms = (v: number) => v > 0 && v < 10_000_000_000 ? v * 1000 : v;
const direction = (d: string) => /SELL|WATCH_SELL/i.test(d) ? 'SELL' : /BUY|WATCH_BUY/i.test(d) ? 'BUY' : 'UNKNOWN';

function pathMetrics(t: Trade, candles: Candle[]) {
  const side = direction(t.direction);
  const entry = n(t.executed_entry_price);
  const preferred = n(t.entry_preferred);
  const sl = n(t.stop_loss);
  const tp = n(t.take_profit_1);
  if (!entry || side === 'UNKNOWN' || !candles.length) return null;

  let maxFavorable = 0, maxAdverse = 0, tpFirst = false, slFirst = false;
  let favorableAtSignalEnd = 0, adverseAtSignalEnd = 0;
  const execTime = ms(n(t.execution_timestamp) || t.signal_timestamp);
  const exitTime = ms(n(t.exit_timestamp) || t.execution_timestamp || t.signal_timestamp);
  const signalTime = ms(t.signal_timestamp);

  for (const c of candles) {
    const hi = n(c.high) ?? c.close, lo = n(c.low) ?? c.close;
    const favorable = side === 'BUY' ? hi - entry : entry - lo;
    const adverse = side === 'BUY' ? lo - entry : entry - hi;
    maxFavorable = Math.max(maxFavorable, favorable);
    maxAdverse = Math.min(maxAdverse, adverse);

    if (c.timestamp >= signalTime && c.timestamp <= execTime) {
      favorableAtSignalEnd = Math.max(favorableAtSignalEnd, favorable);
      adverseAtSignalEnd = Math.min(adverseAtSignalEnd, adverse);
    }
    if (!tpFirst && tp != null) {
      const hit = side === 'BUY' ? hi >= tp : lo <= tp;
      if (hit) tpFirst = true;
    }
    if (!slFirst && sl != null) {
      const hit = side === 'BUY' ? lo <= sl : hi >= sl;
      if (hit) slFirst = true;
    }
    if (c.timestamp >= exitTime) break;
  }

  const firstExitEvent = tpFirst && slFirst ? 'BOTH_HIT_ORDER_UNRESOLVED' :
    tpFirst ? 'TARGET_REACHED' : slFirst ? 'STOP_REACHED' : 'NEITHER_REACHED';

  return {
    candleCount: candles.length,
    firstExitEvent,
    targetReached: tpFirst,
    stopReached: slFirst,
    maxFavorableMove: maxFavorable,
    maxAdverseMove: maxAdverse,
    favorableBeforeExecution: favorableAtSignalEnd,
    adverseBeforeExecution: adverseAtSignalEnd,
    entryDeviationFromPreferred: preferred != null ? entry - preferred : null,
    targetDistance: tp != null ? Math.abs(tp - entry) : null,
    stopDistance: sl != null ? Math.abs(sl - entry) : null
  };
}

async function main() {
  const trades = await executeQuery<Trade>(
    `SELECT signal_id,symbol,signal_timestamp,direction,score,entry_preferred,stop_loss,take_profit_1,
            execution_timestamp,executed_entry_price,exit_timestamp,exit_price,realized_pnl,outcome,mfe_pnl,mae_pnl
       FROM live_trade_research
      WHERE lifecycle_status='CLOSED'
        AND signal_timestamp>=0
        AND signal_timestamp<=?
      ORDER BY signal_timestamp ASC`, [Date.now()]
  );

  const coverage = await executeQuery<{symbol:string;timeframe:string;bars:number;oldest:number;newest:number}>(
    `SELECT symbol,timeframe,COUNT(*) bars,MIN(timestamp) oldest,MAX(timestamp) newest
       FROM candles
      WHERE symbol IN (SELECT DISTINCT symbol FROM live_trade_research WHERE lifecycle_status='CLOSED')
      GROUP BY symbol,timeframe
      ORDER BY symbol,timeframe`
  );

  const rows: any[] = [];
  let missing = 0, reconstructed = 0;
  for (const t of trades) {
    const signalTime = ms(t.signal_timestamp);
    const endTime = ms(n(t.exit_timestamp) || n(t.execution_timestamp) || t.signal_timestamp);
    const candleRows = await executeQuery<Candle>(
      `SELECT timeframe,timestamp,open,high,low,close
         FROM candles
        WHERE symbol=?
          AND timestamp>=?
          AND timestamp<=?
        ORDER BY timestamp ASC`,
      [t.symbol, signalTime, endTime]
    );
    const m = pathMetrics(t, candleRows);
    if (!m) missing++;
    else reconstructed++;
    rows.push({
      signalId:t.signal_id, symbol:t.symbol, signalTimestamp:t.signal_timestamp,
      direction:t.direction, score:t.score, outcome:t.outcome, realizedPnl:t.realized_pnl,
      signalToExecutionSeconds:t.execution_timestamp!=null ? (ms(t.execution_timestamp)-signalTime)/1000 : null,
      ...m
    });
  }

  const valid = rows.filter(r => r);
  const summary = {
    totalClosedTrades: trades.length,
    reconstructedTrades: reconstructed,
    missingCandlePath: missing,
    reconstructionCoveragePct: trades.length ? reconstructed/trades.length*100 : 0,
    targetReachedCount: valid.filter(r=>r.targetReached).length,
    stopReachedCount: valid.filter(r=>r.stopReached).length,
    neitherReachedCount: valid.filter(r=>r.firstExitEvent==='NEITHER_REACHED').length,
    bothHitUnresolvedCount: valid.filter(r=>r.firstExitEvent==='BOTH_HIT_ORDER_UNRESOLVED').length,
    targetReachedAmongLosses: valid.filter(r=>r.outcome==='LOSS'&&r.targetReached).length,
    stopReachedAmongWins: valid.filter(r=>r.outcome==='WIN'&&r.stopReached).length,
    avgAdverseBeforeExecution: valid.length ? valid.reduce((a,r)=>a+(r.adverseBeforeExecution||0),0)/valid.length : null,
    avgFavorableBeforeExecution: valid.length ? valid.reduce((a,r)=>a+(r.favorableBeforeExecution||0),0)/valid.length : null
  };

  const diagnostics:string[] = [];
  if (!trades.length) diagnostics.push('No CLOSED trades are available for reconstruction.');
  if (missing) diagnostics.push(`${missing} CLOSED trades have no candle path in the requested signal-to-exit interval; do not infer their path.`);
  if (summary.bothHitUnresolvedCount) diagnostics.push('Some candles contain both SL and TP within the same bar; without tick/order-of-touch data, first-hit ordering is indeterminate.');
  if (summary.targetReachedAmongLosses) diagnostics.push('Some realized losses also reached the configured target during the candle path; investigate exit timing, partial fills, or post-target handling before changing the predictor.');
  if (summary.stopReachedAmongWins) diagnostics.push('Some realized wins also crossed the configured stop in the candle path; candle OHLC cannot establish intrabar ordering, so this requires broker fill/event reconciliation.');
  if (summary.reconstructionCoveragePct < 80) diagnostics.push('Candle coverage is below 80%; path-based conclusions should remain provisional.');

  console.log(JSON.stringify({
    audit:'PHASE10_2_SIGNAL_TO_TRADE_PATH_RECONSTRUCTION_V1',
    scope:{lifecycle:'CLOSED', pathWindow:'signal_timestamp -> exit_timestamp (fallback execution_timestamp)'},
    summary,
    candleCoverage:coverage.map(r=>({...r,oldest:ms(r.oldest),newest:ms(r.newest)})),
    trades:rows,
    diagnostics,
    generatedAt:new Date().toISOString()
  },null,2));
}
main().catch(e=>{ console.error('Phase 10.2 signal-to-trade reconstruction failed:',e?.message||e); process.exitCode=1; });
