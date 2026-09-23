import assert from 'node:assert/strict';

process.env.FINNHUB_API_KEY = 'test-finnhub';
process.env.NEWSAPI_API_KEY = 'test-newsapi';
process.env.JBLANKED_API_KEY = 'test-jblanked';
process.env.GOLDCREST_NEWS_TIMEOUT_MS = '5000';
process.env.GOLDCREST_NEWS_CACHE_TTL_MS = '30000';
process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS = '60000';
process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS = String(2 * 60 * 60_000);
process.env.JBLANKED_MIN_INTERVAL_MS = '1000';

const { fetchLiveForexNews, resetLiveForexNewsCacheForTest } =
  await import('../src/services/liveNewsService');

const originalFetch = globalThis.fetch;

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as Response;
}

function finnhubArticle(title: string, minutesAgo = 1) {
  return JSON.stringify([{
    id: 1,
    headline: title,
    url: 'https://finnhub.example/article',
    source: 'Finnhub Test',
    datetime: Math.floor((Date.now() - minutesAgo * 60_000) / 1000),
    summary: 'Fresh Forex market headline.'
  }]);
}

try {
  resetLiveForexNewsCacheForTest();

  const requestedUrls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('finnhub.io')) {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['X-Finnhub-Token'], 'test-finnhub');
      return response(finnhubArticle('EUR/USD rises after ECB rate decision'));
    }

    if (url.includes('newsapi.org')) {
      assert.equal(init?.headers && (init.headers as Record<string, string>)['X-Api-Key'], 'test-newsapi');
      return response(JSON.stringify({
        status: 'ok',
        articles: [{
          title: 'GBP/USD reacts to Bank of England update',
          url: 'https://newsapi.example/gbp',
          source: { name: 'NewsAPI Test' },
          publishedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
          description: 'Fresh supplementary article.'
        }]
      }));
    }

    if (url.includes('jblanked.com')) {
      return response(JSON.stringify([{
        Name: 'Core CPI m/m',
        Currency: 'USD',
        Category: 'Consumer Inflation Report',
        Impact: 'High',
        Date: new Date(Date.now() - 3 * 60_000).toISOString(),
        Actual: 0.4,
        Forecast: 0.4,
        Previous: 0.2,
        Outcome: 'Actual = Forecast > Previous',
        Strength: 'Strong Data',
        Quality: 'Bad Data'
      }]));
    }

    return response('', 404);
  };

  const live = await fetchLiveForexNews({
    pairs: ['EUR/USD', 'GBP/USD'],
    forceRefresh: true
  });

  assert.equal(live.status, 'LIVE');
  assert.equal(live.source, 'FINNHUB');
  assert.ok(live.articleCount >= 3);
  assert.equal(live.providerStatus?.FINNHUB, 'LIVE');
  assert.equal(live.providerStatus?.NEWSAPI, 'LIVE');
  assert.equal(live.providerStatus?.JBLANKED, 'LIVE');
  assert.equal(live.providerDiagnostics?.FINNHUB?.freshArticleCount, 1);
  assert.equal(live.providerDiagnostics?.NEWSAPI?.freshArticleCount, 1);
  assert.equal(live.providerDiagnostics?.JBLANKED?.freshArticleCount, 1);
  assert.equal(live.highImpactCount, 2);
  assert.equal(live.pairRisk?.['EUR/USD']?.riskLevel, 'HIGH');
  assert.deepEqual(live.queryPairs, ['EUR/USD', 'GBP/USD']);

  const finnhubUrls = requestedUrls.filter(url => url.includes('finnhub.io'));
  assert.equal(finnhubUrls.length, 1);

  resetLiveForexNewsCacheForTest();
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('finnhub.io')) {
      return response(JSON.stringify([{
        headline: 'Old EUR/USD commentary',
        url: 'https://finnhub.example/old',
        source: 'Finnhub',
        datetime: Math.floor((Date.now() - 26 * 60 * 60_000) / 1000),
        summary: 'Stale article'
      }]));
    }

    if (url.includes('newsapi.org')) {
      return response(JSON.stringify({
        status: 'ok',
        articles: [{
          title: 'Delayed article',
          url: 'https://newsapi.example/old',
          source: { name: 'NewsAPI' },
          publishedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString()
        }]
      }));
    }

    if (url.includes('jblanked.com')) {
      return response(JSON.stringify([{
        Name: 'FOMC Rate Decision',
        Currency: 'USD',
        Impact: 'High',
        Date: new Date(Date.now() - 30 * 60_000).toISOString(),
        Quality: 'Good Data'
      }]));
    }

    return response('', 404);
  };

  const staleCheck = await fetchLiveForexNews({
    pairs: ['EUR/USD'],
    forceRefresh: true
  });

  assert.equal(staleCheck.status, 'LIVE');
  assert.equal(staleCheck.providerStatus?.FINNHUB, 'STALE');
  assert.equal(staleCheck.providerStatus?.NEWSAPI, 'STALE');
  assert.equal(staleCheck.providerStatus?.JBLANKED, 'LIVE');
  assert.equal(staleCheck.articleCount, 1);

  resetLiveForexNewsCacheForTest();
  globalThis.fetch = async () => response('', 503);

  const unavailable = await fetchLiveForexNews({
    pairs: ['USD/JPY'],
    forceRefresh: true
  });

  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.riskLevel, 'UNAVAILABLE');
  assert.equal(unavailable.articleCount, 0);
  assert.equal(unavailable.providerStatus?.FINNHUB, 'ERROR');
  assert.equal(unavailable.providerStatus?.NEWSAPI, 'ERROR');
  assert.equal(unavailable.providerStatus?.JBLANKED, 'ERROR');

  resetLiveForexNewsCacheForTest();
  console.log('LIVE NEWS SERVICE TEST PASSED');
} finally {
  globalThis.fetch = originalFetch;
}
