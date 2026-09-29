import { executeQuery } from '../src/database/db';

type Row = {
  signal_id:string; symbol:string; signal_timestamp:number; direction:string; score:number;
  market_regime:string; session:string; strategy_version:string; news_status:string|null;
  entry_preferred:number|null; stop_loss:number|null; take_profit_1:number|null;
  risk_reward:number|null; quote_spread:number|null; quote_timestamp:number|null;
  execution_timestamp:number|null; executed_entry_price:number|null; exit_price:number|null;
  realized_pnl:number|null; outcome:string|null; mfe_pnl:number|null; mae_pnl:number|null;
  holding_duration_ms:number|null; execution_status:string|null; execution_reason:string|null;
};
const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0};
function band(s:number){if(s<60)return'<60';if(s<65)return'60-64';if(s<70)return'65-69';if(s<75)return'70-74';if(s<80)return'75-79';if(s<85)return'80-84';if(s<90)return'85-89';return'90+'}
function agg(rows:Row[]){const w=rows.filter(r=>num(r.realized_pnl)>0),l=rows.filter(r=>num(r.realized_pnl)<0),p=rows.reduce((a,r)=>a+num(r.realized_pnl),0),gp=w.reduce((a,r)=>a+num(r.realized_pnl),0),gl=Math.abs(l.reduce((a,r)=>a+num(r.realized_pnl),0));return{count:rows.length,wins:w.length,losses:l.length,breakeven:rows.length-w.length-l.length,pnl:p,grossProfit:gp,grossLoss:gl,avgWin:w.length?gp/w.length:0,avgLoss:l.length?-gl/l.length:0,expectancy:rows.length?p/rows.length:0,profitFactor:gl?gp/gl:null,winRate:rows.length?w.length/rows.length:0}}
function groups(rows:Row[],key:(r:Row)=>string){const m=new Map<string,Row[]>();for(const r of rows){const k=key(r)||'UNKNOWN';m.set(k,[...(m.get(k)||[]),r])}return[...m].map(([group,v])=>({group,...agg(v)})).sort((a,b)=>b.count-a.count||b.pnl-a.pnl)}
function median(v:number[]){const a=v.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2}
function streak(rows:Row[]){let c=0,m=0;for(const r of rows){if(num(r.realized_pnl)<0){c++;m=Math.max(m,c)}else c=0}return m}
async function main(){
 const rows=await executeQuery<Row>(`SELECT signal_id,symbol,signal_timestamp,direction,score,market_regime,session,strategy_version,news_status,entry_preferred,stop_loss,take_profit_1,risk_reward,quote_spread,quote_timestamp,execution_timestamp,executed_entry_price,exit_price,realized_pnl,outcome,mfe_pnl,mae_pnl,holding_duration_ms,execution_status,execution_reason FROM live_trade_research WHERE lifecycle_status='CLOSED' AND signal_timestamp>=0 AND signal_timestamp<=? ORDER BY signal_timestamp ASC`,[Date.now()]);
 const all=agg(rows), hold=rows.map(r=>num(r.holding_duration_ms)/60000).filter(x=>x>0);
 const latency=rows.map(r=>(num(r.execution_timestamp)-num(r.signal_timestamp))/1000).filter(x=>x>=0);
 const quoteAge=rows.map(r=>(num(r.execution_timestamp)-num(r.quote_timestamp))/1000).filter(x=>x>=0);
 const slip=rows.filter(r=>r.entry_preferred!=null&&r.executed_entry_price!=null).map(r=>num(r.executed_entry_price)-num(r.entry_preferred));
 const stop=rows.map(r=>Math.abs(num(r.executed_entry_price)-num(r.stop_loss))).filter(x=>x>0);
 const target=rows.map(r=>Math.abs(num(r.take_profit_1)-num(r.executed_entry_price))).filter(x=>x>0);
 const d:string[]=[];
 if(rows.length<100)d.push(`Only ${rows.length} CLOSED trades are available; grouped results are exploratory, not statistically stable.`);
 if(all.wins<20)d.push(`Only ${all.wins} profitable CLOSED trades are available; supervised model training should remain conservative.`);
 if(all.losses>all.wins)d.push('Losses exceed wins; investigate trade selection, entry timing, exits, and regime/news conditioning before changing prediction thresholds.');
 console.log(JSON.stringify({
 audit:'PHASE10_1_REALIZED_TRADE_FORENSICS_V1',
 scope:{lifecycle:'CLOSED',rows:rows.length,oldestSignalTimestamp:rows[0]?.signal_timestamp??null,newestSignalTimestamp:rows.at(-1)?.signal_timestamp??null},
 overall:{...all,maxLosingStreak:streak(rows),medianHoldingMinutes:median(hold),medianSignalToExecutionSeconds:median(latency),medianQuoteAgeAtExecutionSeconds:median(quoteAge),medianEntryDeviationFromPreferred:median(slip),medianRiskReward:median(rows.map(r=>num(r.risk_reward)).filter(x=>x>0)),medianSpread:median(rows.map(r=>num(r.quote_spread)).filter(x=>x>0)),medianMfePnl:median(rows.map(r=>num(r.mfe_pnl))),medianMaePnl:median(rows.map(r=>num(r.mae_pnl)))},
 breakdowns:{pair:groups(rows,r=>r.symbol),direction:groups(rows,r=>r.direction),scoreBand:groups(rows,r=>band(num(r.score))),marketRegime:groups(rows,r=>r.market_regime),session:groups(rows,r=>r.session),strategy:groups(rows,r=>r.strategy_version),newsStatus:groups(rows,r=>r.news_status||'UNKNOWN'),executionStatus:groups(rows,r=>r.execution_status||'UNKNOWN'),outcome:groups(rows,r=>r.outcome||'NULL')},
 execution:{medianSignalToExecutionSeconds:median(latency),medianQuoteAgeAtExecutionSeconds:median(quoteAge),medianEntryDeviationFromPreferred:median(slip),rowsWithExecutionReason:rows.filter(r=>String(r.execution_reason||'').trim()).length},
 entryQuality:{rows:rows.length,medianStopDistance:median(stop),medianTargetDistance:median(target),medianEntryDeviationFromPreferred:median(slip),rowsWithValidStopAndTarget:stop.length},
 diagnostics:d,generatedAt:new Date().toISOString()
 },null,2));
}
main().catch(e=>{console.error('Phase 10.1 realized-trade forensics failed:',e?.message||e);process.exitCode=1});