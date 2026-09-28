import { calculateEMA, calculateRSI, calculateSMA, calculateVWAP } from '../src/markets/common/indicators';
import { getForexSessionState } from '../src/markets/common/session';
import { calculatePipDistance, getForexPairConfig, FOREX_PAIRS } from '../src/markets/forex/instruments';
import { getDatabase, executeQuery } from '../src/database/db';
import { evaluateForexSetup } from '../src/markets/forex/forexEngine';
import { generateDemoCandles } from '../src/services/providers';

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING GOLDCREST FOREX TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, testName: string) {
    if (condition) { console.log('  PASS: ' + testName); passed++; }
    else { console.error('  FAIL: ' + testName); failed++; }
  }

  console.log('[Test Suite 1: Quantitative Indicators]');
  const testCloses = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const sma5 = calculateSMA(testCloses, 5);
  assert(sma5[4] === 12, 'SMA 5 computes the initial average');
  const ema5 = calculateEMA(testCloses, 5);
  assert(ema5.length === testCloses.length, 'EMA returns matching length');
  const rsi = calculateRSI(testCloses, 14);
  const lastRsi = rsi[rsi.length - 1];
  assert(lastRsi > 50 && lastRsi <= 100, 'RSI reflects bullish momentum');
  const vwap = calculateVWAP([
    { timestamp: 1, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
    { timestamp: 2, open: 102, high: 108, low: 101, close: 106, volume: 2000 }
  ]);
  assert(vwap.length === 2 && vwap[1] > 100, 'VWAP uses volume weighting');

  console.log('\n[Test Suite 2: Forex Instruments & Sessions]');
  assert(FOREX_PAIRS.length >= 13, 'Supported Forex universe contains at least 13 pairs');
  const eurUsd = getForexPairConfig('EUR/USD');
  assert(eurUsd.pipSize === 0.0001, 'EUR/USD pip size is 0.0001');
  const usdjpy = getForexPairConfig('USD/JPY');
  assert(usdjpy.pipSize === 0.01, 'USD/JPY pip size is 0.01');
  assert(Math.round(calculatePipDistance(1.0850, 1.0800, 0.0001)) === 50, 'EUR/USD pip distance is 50 pips');
  const fxSessions = getForexSessionState(new Date('2026-09-15T14:30:00Z'));
  assert(fxSessions.isLondonNyOverlap === true, 'London/NY overlap is detected at 14:30 UTC');

  console.log('\n[Test Suite 3: Forex Signal Engine]');
  const flatCandles = generateDemoCandles(1.0850, 40, 0.0001, 0.0);
  const flatSignal = evaluateForexSetup('EUR/USD', flatCandles);
  assert(flatSignal.direction === 'NO_TRADE' || flatSignal.direction === 'WAIT', 'Flat market does not force a trade');

  console.log('\n[Test Suite 4: SQLite Database Layer]');
  const db = await getDatabase();
  assert(db !== null, 'SQLite database initializes');
  const markets = await executeQuery('SELECT * FROM markets');
  assert(markets.length >= 1, 'At least one market row exists');
  assert(markets.every((row: any) => row.code === 'FOREX'), 'Only Forex market is seeded');
  const settings = await executeQuery('SELECT * FROM system_settings WHERE key = "TRADING_MODE"');
  assert(settings[0]?.value === 'LIVE_ONLY', 'Trading mode persists as LIVE_ONLY');

  console.log('====================================================');
  console.log('TEST RESULTS: ' + passed + ' PASSED, ' + failed + ' FAILED');
  console.log('====================================================\n');
  if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error('Test execution error:', err); process.exit(1); });
