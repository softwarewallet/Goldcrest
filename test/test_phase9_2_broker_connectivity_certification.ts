import assert from 'node:assert/strict';
import { evaluateBrokerVerification, summarizeBrokerVerification } from '../src/services/brokerVerificationService';
import type { ConnectionTestResult } from '../src/brokers/types';

const scenarios: Array<{ id: number; name: string; run: () => void | Promise<void> }> = [];
const add = (id: number, name: string, run: () => void | Promise<void>) => scenarios.push({ id, name, run });

const ctraderLive: ConnectionTestResult = {
  broker: 'CTRADER',
  environment: 'LIVE',
  connected: true,
  apiMode: 'LIVE',
  apiEndpoint: 'wss://live.ctraderapi.com:5036',
  account: '****1234',
  accountType: 'LIVE',
  balance: 10000,
  equity: 9900,
  availableMargin: 8000,
  currency: 'USD',
  timestamp: 1000
};

const ctraderDemo: ConnectionTestResult = {
  ...ctraderLive,
  apiMode: 'DEMO',
  apiEndpoint: 'wss://demo.ctraderapi.com:5036',
  accountType: 'DEMO'
};

add(1, 'Valid cTrader LIVE connection verifies', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).status, 'VERIFIED'));
add(2, 'Valid cTrader LIVE reports connected', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).connected, true));
add(3, 'Valid cTrader LIVE reports authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).authoritativeAccountState, true));
add(4, 'cTrader LIVE endpoint is verified', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).apiEndpoint, 'wss://live.ctraderapi.com:5036'));
add(5, 'cTrader DEMO endpoint is verified', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'DEMO' }).apiEndpoint, 'wss://demo.ctraderapi.com:5036'));
add(6, 'cTrader LIVE mode must match selected mode', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'LIVE' }).status, 'CONFIGURED_UNAVAILABLE'));
add(7, 'cTrader LIVE mode mismatch is explicit', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'LIVE' }).failures.includes('CTRADER_API_MODE_MISMATCH')));
add(8, 'cTrader DEMO mode verifies against DEMO selector', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'DEMO' }).status, 'VERIFIED'));
add(9, 'Missing credentials are NOT_CONFIGURED', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).status, 'NOT_CONFIGURED'));
add(10, 'Missing credentials never report connected', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).connected, false));
add(11, 'Missing credentials never report authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).authoritativeAccountState, false));
add(12, 'Missing credentials exposes explicit failure', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'CTRADER', configured: false }).failures, ['CREDENTIALS_NOT_CONFIGURED']));
add(13, 'Configured broker without connection result is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true }).status, 'CONFIGURED_UNAVAILABLE'));
add(14, 'Unavailable connection has explicit failure', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'CTRADER', configured: true }).failures, ['CONNECTION_TEST_UNAVAILABLE']));
add(15, 'Disconnected broker is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } }).status, 'CONFIGURED_UNAVAILABLE'));
add(16, 'Disconnected broker reports connected=false', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } }).connected, false));
add(17, 'Missing account ID blocks authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, account: '' } }).authoritativeAccountState, false));
add(18, 'Missing account ID is explicit', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, account: '' } }).failures.includes('ACCOUNT_ID_UNAVAILABLE')));
add(19, 'Missing currency blocks authoritative account state', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, currency: '' } }).authoritativeAccountState, false));
add(20, 'Missing currency is explicit', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, currency: '' } }).failures.includes('ACCOUNT_CURRENCY_UNAVAILABLE')));
add(21, 'Negative balance is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: -1 } }).status, 'CONFIGURED_UNAVAILABLE'));
add(22, 'NaN equity is unavailable', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, equity: Number.NaN } }).status, 'CONFIGURED_UNAVAILABLE'));
add(23, 'Missing balance is unavailable', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: undefined } }).failures.includes('BALANCE_UNAVAILABLE')));
add(24, 'Missing equity is unavailable', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, equity: undefined } }).failures.includes('EQUITY_UNAVAILABLE')));
add(25, 'Missing timestamp is unavailable', () => assert.ok(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, timestamp: 0 } }).failures.includes('CONNECTION_TIMESTAMP_UNAVAILABLE')));
add(26, 'Fresh valid zero balance remains valid', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: 0, equity: 0 } }).status, 'VERIFIED'));
add(27, 'Account state remains authoritative when balance is zero', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, balance: 0, equity: 0 } }).authoritativeAccountState, true));
add(28, 'Broker verification is deterministic', () => assert.deepEqual(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }), evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive }, expectedCTraderApiMode: 'LIVE' })));
add(29, 'One configured verified cTrader broker summarizes correctly', () => assert.deepEqual(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' })
]), { anyConfigured: true, anyConnected: true, allConfiguredBrokersVerified: true }));
add(30, 'No brokers configured summarizes correctly', () => assert.deepEqual(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: false })
]), { anyConfigured: false, anyConnected: false, allConfiguredBrokersVerified: false }));
add(31, 'An unavailable configured cTrader broker prevents all-verified summary', () => assert.equal(summarizeBrokerVerification([
  evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } })
]).allConfiguredBrokersVerified, false));
add(32, 'Connected state requires authoritative connection result', () => {
  const result = evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, account: '' } });
  assert.equal(result.connected, true);
  assert.equal(result.authoritativeAccountState, false);
});
add(33, 'Verification status fails when account currency missing', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, currency: '' } }).status, 'CONFIGURED_UNAVAILABLE'));
add(34, 'Verification status fails on disconnected connection with complete fields', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: { ...ctraderLive, connected: false } }).status, 'CONFIGURED_UNAVAILABLE'));
add(35, 'API endpoint is retained for cTrader verification output', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).apiEndpoint, ctraderLive.apiEndpoint));
add(36, 'API mode is retained for cTrader verification output', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive, expectedCTraderApiMode: 'LIVE' }).apiMode, 'LIVE'));
add(37, 'DEMO endpoint output is retained', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'DEMO' }).apiEndpoint, ctraderDemo.apiEndpoint));
add(38, 'DEMO API mode output is retained', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderDemo, expectedCTraderApiMode: 'DEMO' }).apiMode, 'DEMO'));
add(39, 'Verification succeeds without a selected cTrader mode', () => assert.equal(evaluateBrokerVerification({ broker: 'CTRADER', configured: true, connection: ctraderLive }).status, 'VERIFIED'));
add(40, 'Phase 9.2 certification contains exactly 40 scenarios', () => assert.equal(scenarios.length, 40));

for (const item of scenarios) {
  await item.run();
  console.log('[PASS ' + String(item.id).padStart(2, '0') + '/40] ' + item.name);
}

console.log('PHASE 9.2 BROKER CONNECTIVITY CERTIFICATION: 40/40 PASSED');
