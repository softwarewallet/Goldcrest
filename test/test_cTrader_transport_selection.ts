import { getCTraderRequestHosts } from '../src/brokers/adapters/cTrader/cTraderApiClient';
import { getCTraderApiMode, getSystemConfig, updateSystemConfig } from '../src/services/configService';

function runCTraderTransportSelectionRegressionTest() {
  const previousLiveHost = process.env.CTRADER_LIVE_API_HOST;
  const previousMode = getSystemConfig().cTraderApiMode;

  try {
    delete process.env.CTRADER_LIVE_API_HOST;

    updateSystemConfig({ cTraderApiMode: 'LIVE' });
    const liveHosts = getCTraderRequestHosts(true);
    const liveHost = getCTraderRequestHosts(false);

    if (getCTraderApiMode() !== 'LIVE' || liveHosts.length !== 1 || liveHosts[0] !== 'wss://live.ctraderapi.com:5036') {
      throw new Error(`LIVE cTrader API routing is incorrect: ${JSON.stringify(liveHosts)}`);
    }

    if (liveHost.length !== 1 || liveHost[0] !== 'wss://live.ctraderapi.com:5036') {
      throw new Error(`LIVE cTrader API routing is incorrect for account flag: ${JSON.stringify(liveHost)}`);
    }

    updateSystemConfig({ cTraderApiMode: 'LIVE' });
    const liveHostsAfterReset = getCTraderRequestHosts(true);
    if (getCTraderApiMode() !== 'LIVE' || liveHostsAfterReset.length !== 1 || liveHostsAfterReset[0] !== 'wss://live.ctraderapi.com:5036') {
      throw new Error(`LIVE-only cTrader API routing regressed: ${JSON.stringify(liveHostsAfterReset)}`);
    }

    updateSystemConfig({ cTraderApiMode: previousMode });

    console.log('cTrader transport selection regression test: PASSED');
  } finally {
    if (previousLiveHost === undefined) delete process.env.CTRADER_LIVE_API_HOST;
    else process.env.CTRADER_LIVE_API_HOST = previousLiveHost;
    updateSystemConfig({ cTraderApiMode: previousMode });
  }
}

runCTraderTransportSelectionRegressionTest();
