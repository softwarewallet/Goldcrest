import { executeQuery } from '../src/database/db';

type T={signal_id:string;symbol:string;signal_timestamp:number;direction:string;execution_timestamp:number|null;executed_entry_price:number|null;exit_timestamp:number|null;realized_pnl:number|null;outcome:string|null};
type P={timestamp:number;price:number;source:string};
const ms=(v:any)=>{const n=Number(v);return Number.isFinite(n)&&n>0?(n<1e10?n*1000:n):null};
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:null};
const json=(v:any)=>{try{return typeof v==='string'?JSON.parse(v):null}catch{return null}};
function collect(v:any,o:P[],source:string,d=0){if(d>6||v==null)return;if(Array.isArray(v)){v.forEach(x=>collect(x,o,source,d+1));return}if(typeof v!=='object')return;
 const tv=v.timestamp??v.time??v.at??v.observedAt??v.observed_at??v.executedAt??v.executed_at??v.createdAt??v.created_at;
 const pv=v.price??v.mid??v.midPrice??v.marketPrice??v.quote??v.bid??v.ask??v.close;
 const t=ms(tv),p=num(pv);if(t&&p&&p>0)o.push({timestamp:t,price:p,source});
 for(const [k,x] of Object.entries(v))if(/payload|trace|event|quote|price|market|snapshot|node|data|request|response|observation/i.test(k))collect(x,o,source,d+1);
}
const uniq=(a:P[])=>{const s=new Set<string>();return a.filter(x=>{const k=x.timestamp+':'+x.price+':'+x.source;if(s.has(k))return false;s.add(k);return true}).sort((a,b)=>a.timestamp-b.timestamp)};
const side=(d:string)=>/SELL/i.test(d)?'SELL':/BUY/i.test(d)?'BUY':null;
function path(t:T,points:P[]){const s=ms(t.signal_timestamp),e=ms(t.exit_timestamp)??ms(t.execution_timestamp),entry=num(t.executed_entry_price),d=side(t.direction);if(!s||!e||entry==null||!d)return null;const p=points.filter(x=>x.timestamp>=s&&x.timestamp<=e);if(!p.length)return null;let mf=0,ma=0;for(const x of p){const m=d==='BUY'?x.price-entry:entry-x.price;mf=Math.max(mf,m);ma=Math.min(ma,m)};return {evidencePoints:p.length,sources:[...new Set(p.map(x=>x.source))],maxFavorableMove:mf,maxAdverseMove:ma,signalToExecutionSeconds:ms(t.execution_timestamp)?(ms(t.execution_timestamp)!-s)/1000:null}};
async function main(){
 const trades=await executeQuery<T>(`SELECT signal_id,symbol,signal_timestamp,direction,execution_timestamp,executed_entry_price,exit_timestamp,realized_pnl,outcome FROM live_trade_research WHERE lifecycle_status='CLOSED' ORDER BY signal_timestamp`);
 const market=await executeQuery<{symbol:string;timestamp:number;price:number}>(`SELECT symbol,timestamp,price FROM market_data WHERE symbol IN (SELECT DISTINCT symbol FROM live_trade_research WHERE lifecycle_status='CLOSED') ORDER BY symbol,timestamp`);
 const roots=await executeQuery<{trade_trace_id:string;payload_json:string}>(`SELECT trade_trace_id,payload_json FROM trade_traces`);
 const nodes=await executeQuery<{trade_trace_id:string;payload_json:string}>(`SELECT trade_trace_id,payload_json FROM trade_trace_nodes`);
 const fills=await executeQuery<any>(`SELECT idempotency_key,broker_order_id,broker_fill_id,price,executed_at,observed_at FROM execution_fill_events ORDER BY executed_at`);
 const bySym=new Map<string,P[]>();for(const r of market){const t=ms(r.timestamp),p=num(r.price);if(t&&p){const a=bySym.get(r.symbol)||[];a.push({timestamp:t,price:p,source:'market_data'});bySym.set(r.symbol,a)}}
 const trace:P[]=[];roots.forEach(r=>collect(json(r.payload_json),trace,'trade_traces'));nodes.forEach(r=>collect(json(r.payload_json),trace,'trade_trace_nodes'));const tp=uniq(trace);
 const rows=trades.map(t=>{const s=ms(t.signal_timestamp),e=ms(t.exit_timestamp)??ms(t.execution_timestamp)??s;const mp=uniq(bySym.get(t.symbol)||[]).filter(x=>x.timestamp>=s!&&x.timestamp<=e!);const rp=tp.filter(x=>x.timestamp>=s!&&x.timestamp<=e!);const all=uniq([...mp,...rp]);const p=path(t,all);const fill=fills.filter(f=>{const ft=ms(f.executed_at);return ft&&s&&e&&ft>=s-120000&&ft<=e+120000});return {signalId:t.signal_id,symbol:t.symbol,direction:t.direction,outcome:t.outcome,realizedPnl:t.realized_pnl,marketDataPoints:mp.length,tradeTracePoints:rp.length,executionFillCandidates:fill.length,...p}});
 const high=rows.filter(r=>Number(r.evidencePoints)>0).length;
 console.log(JSON.stringify({audit:'PHASE10_3_HIGH_RESOLUTION_TRADE_RECONSTRUCTION_V1',scope:{lifecycle:'CLOSED',sources:['market_data','trade_traces','trade_trace_nodes','execution_fill_events'],candleFallback:'not used'},sourceCounts:{closedTrades:trades.length,marketDataRows:market.length,tradeTraceRoots:roots.length,tradeTraceNodes:nodes.length,executionFillEvents:fills.length},coverage:{tradesWithMarketData:rows.filter(r=>r.marketDataPoints>0).length,tradesWithTradeTraceEvidence:rows.filter(r=>r.tradeTracePoints>0).length,tradesWithHighResolutionEvidence:high,highResolutionCoveragePct:trades.length?high/trades.length*100:0},trades:rows,diagnostics:[...(market.length?[]:['market_data has no rows for closed-trade symbols.'] ),...((roots.length||nodes.length)?[]:['trade trace tables have no rows.']),...(fills.length?[]:['execution_fill_events has no rows.']),(high<trades.length*.8?'High-resolution evidence is below 80%; do not change prediction thresholds from this audit alone.': 'High-resolution evidence meets the 80% coverage threshold.'),'Read-only audit; no database or execution changes.'],generatedAt:new Date().toISOString()},null,2));
}
main().catch(e=>{console.error('Phase 10.3 failed:',e?.message||e);process.exitCode=1});
