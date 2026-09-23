import { getCTraderRequestHosts } from '../src/brokers/adapters/cTrader/cTraderApiClient';
import { getCTraderApiMode, getSystemConfig, updateSystemConfig } from '../src/services/configService';

function runCTraderTransportSelectionRegressionTest() {
  const previousLiveHost = process.env.CTRADER_LIVE_API_HOST;
  const previousDemoHost = process.env.CTRADER_DEMO_API_HOST;
  const previousMode = getSystemConfig().cTraderApiMode;

  try {
    delete process.env.CTRADER_LIVE_API_HOST;
    delete process.env.CTRADER_DEMO_API_HOST;

    updateSystemConfig({ cTraderApiMode: 'LIVE' });
    const liveHosts = getCTraderRequestHosts(true);
    const liveHost = getCTraderRequestHosts(false);

    if (getCTraderApiMode() !== 'LIVE' || liveHosts.length !== 1 || liveHosts[0] !== 'wss://live.ctraderapi.com:5036') {
      throw new Error(`LIVE cTrader API routing is incorrect: ${JSON.stringify(liveHosts)}`);
    }

    if (liveHost.length !== 1 || liveHost[0] !== 'wss://live.ctraderapi.com:5036') {
      throw new Error(`LIVE cTrader API routing is incorrect for account flag: ${JSON.stringify(liveHost)}`);
    }

    updateSystemConfig({ cTraderApiMode: 'DEMO' });
    const demoHosts = getCTraderRequestHosts(true);
    if (getCTraderApiMode() !== 'DEMO' || demoHosts.length !== 1 || demoHosts[0] !== 'wss://demo.ctraderapi.com:5036') {
      throw new Error(`DEMO cTrader API routing is incorrect: ${JSON.stringify(demoHosts)}`);
    }

    process.env.CTRADER_DEMO_API_HOST = 'wss://custom-demo.ctrader.example:5036';
    const configuredDemoHosts = getCTraderRequestHosts(false);
    if (configuredDemoHosts.length !== 1 || configuredDemoHosts[0] !== 'wss://custom-demo.ctrader.example:5036') {
      throw new Error(`Explicit cTrader DEMO endpoint override was not preserved: ${JSON.stringify(configuredDemoHosts)}`);
    }

    updateSystemConfig({ cTraderApiMode: previousMode });

    console.log('cTrader transport selection regression test: PASSED');
  } finally {
    if (previousLiveHost === undefined) delete process.env.CTRADER_LIVE_API_HOST;
    else process.env.CTRADER_LIVE_API_HOST = previousLiveHost;
    if (previousDemoHost === undefined) delete process.env.CTRADER_DEMO_API_HOST;
    else process.env.CTRADER_DEMO_API_HOST = previousDemoHost;
    updateSystemConfig({ cTraderApiMode: previousMode });
  }
}

runCTraderTransportSelectionRegressionTest();
