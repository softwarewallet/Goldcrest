import { getCTraderRequestHosts } from '../src/brokers/adapters/cTrader/cTraderApiClient';

function runCTraderTransportSelectionRegressionTest() {
  const previous = process.env.CTRADER_LIVE_API_HOST;

  try {
    delete process.env.CTRADER_LIVE_API_HOST;

    const liveHosts = getCTraderRequestHosts(true);
    const testHosts = getCTraderRequestHosts(false);

    if (liveHosts.length !== 1 || liveHosts[0] !== 'wss://live.ctraderapi.com:5036') {
      throw new Error(`LIVE account routing is incorrect: ${JSON.stringify(liveHosts)}`);
    }

    if (testHosts.length !== 1 || testHosts[0] !== 'wss://demo.ctraderapi.com:5036') {
      throw new Error(`cTrader test-account routing is incorrect: ${JSON.stringify(testHosts)}`);
    }

    process.env.CTRADER_LIVE_API_HOST = 'wss://custom.ctrader.example:5036';
    const configuredHosts = getCTraderRequestHosts(false);

    if (configuredHosts.length !== 1 || configuredHosts[0] !== 'wss://custom.ctrader.example:5036') {
      throw new Error(`Explicit cTrader endpoint override was not preserved: ${JSON.stringify(configuredHosts)}`);
    }

    console.log('cTrader transport selection regression test: PASSED');
  } finally {
    if (previous === undefined) {
      delete process.env.CTRADER_LIVE_API_HOST;
    } else {
      process.env.CTRADER_LIVE_API_HOST = previous;
    }
  }
}

runCTraderTransportSelectionRegressionTest();
