import assert from 'node:assert/strict';

process.env.GOLDCREST_NEWS_TIMEOUT_MS = '5000';
process.env.GOLDCREST_NEWS_CACHE_TTL_MS = '30000';
process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS = '60000';
process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS = String(2 * 60 * 60_000);

const { fetchLiveForexNews, resetLiveForexNewsCacheForTest } = await import('../src/services/liveNewsService');

const originalFetch = globalThis.fetch;

function gdeltDate(timestamp = Date.now() - 60_000): string {
  const value = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
}

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as Response;
}

try {
  resetLiveForexNewsCacheForTest();

  const requestedUrls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes('api.gdeltproject.org')) {
      return response(JSON.stringify({
        articles: [{
          title: 'EUR/USD moves after ECB rate decision &amp; inflation update',
          url: 'https://example.com/ecb-news',
          domain: 'example.com',
          seendate: gdeltDate(),
          language: 'English',
          sourcecountry: 'US'
        }]
      }));
    }

    return response('<rss><channel></channel></rss>');
  };

  const live = await fetchLiveForexNews({ pairs: ['EUR/USD', 'GBP/USD'] });
  assert.equal(live.status, 'LIVE');
  assert.equal(live.source, 'GDELT_DOC_2');
  assert.equal(live.articleCount, 1);
  assert.equal(live.highImpactCount, 1);
  assert.equal(live.riskLevel, 'HIGH');
  assert.equal(live.articles[0].title.includes('&amp;'), false);
  assert.match(live.articles[0].publishedAt || '', /^20\d\d-\d\d-\d\dT/);
  assert.deepEqual(live.queryPairs, ['EUR/USD', 'GBP/USD']);
  assert.equal(live.providerStatus?.GDELT_DOC_2, 'LIVE');
  assert.equal(live.providerDiagnostics?.GDELT_DOC_2?.staleArticleCount, 0);
  const gdeltQueryUrl = requestedUrls.find(url => url.includes('api.gdeltproject.org')) || '';
  const gdeltQuery = new URL(gdeltQueryUrl).searchParams.get('query') || '';
  assert.match(gdeltQuery, /Federal Reserve/);
  assert.equal(gdeltQuery.includes('(('), false);
  assert.match(requestedUrls.find(url => url.includes('news.google.com')) || '', /when%3A24h|when:24h/);

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) return response('rate limited', 429);

    return response(`<rss><channel>
      <item>
        <title><![CDATA[GBP/USD rises on central bank update]]></title>
        <link>https://news.google.com/rss/articles/example</link>
        <source url="https://example.com">Example News</source>
        <pubDate>${new Date(Date.now() - 2 * 60_000).toUTCString()}</pubDate>
      </item>
    </channel></rss>`);
  };

  const fallback = await fetchLiveForexNews({ pairs: ['GBP/USD'], forceRefresh: true });
  assert.equal(fallback.status, 'LIVE');
  assert.equal(fallback.source, 'GOOGLE_NEWS_RSS');
  assert.equal(fallback.articleCount, 1);
  assert.equal(fallback.providerStatus?.GDELT_DOC_2, 'ERROR');
  assert.equal(fallback.providerStatus?.GOOGLE_NEWS_RSS, 'LIVE');
  assert.equal(fallback.articles[0].source, 'Example News');

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) {
      return response('Please limit requests to one every 5 seconds.');
    }
    return response('<rss><channel></channel></rss>');
  };

  const rateLimited = await fetchLiveForexNews({ pairs: ['EUR/USD'], forceRefresh: true });
  assert.equal(rateLimited.providerStatus?.GDELT_DOC_2, 'RATE_LIMITED');
  assert.match(rateLimited.providerDiagnostics?.GDELT_DOC_2.error || '', /rate limited/i);

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) {
      return response(JSON.stringify({
        articles: [
          {
            title: 'USD outlook remains volatile as investors debate interest rates',
            url: 'https://example.com/routine-rate-commentary',
            domain: 'example.com',
            seendate: gdeltDate(),
            language: 'English',
            sourcecountry: 'US'
          },
          {
            title: 'RBA rate decision released; Australian dollar volatility jumps',
            url: 'https://example.com/rba-fresh-irrelevant',
            domain: 'example.com',
            seendate: gdeltDate(),
            language: 'English',
            sourcecountry: 'AU'
          },
          {
            title: 'FOMC rate decision released; dollar volatility jumps',
            url: 'https://example.com/fomc-old',
            domain: 'example.com',
            seendate: gdeltDate(Date.now() - 2 * 60 * 60_000),
            language: 'English',
            sourcecountry: 'US'
          }
        ]
      }));
    }
    return response('<rss><channel></channel></rss>');
  };

  const falsePositiveCheck = await fetchLiveForexNews({ pairs: ['EUR/USD'], forceRefresh: true });
  assert.equal(falsePositiveCheck.status, 'LIVE');
  assert.equal(falsePositiveCheck.highImpactCount, 0);
  assert.equal(falsePositiveCheck.activeHighImpactCount, 0);
  assert.notEqual(falsePositiveCheck.riskLevel, 'HIGH');

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) {
      return response(JSON.stringify({
        articles: [{
          title: 'FOMC rate decision surprises markets as the Federal Reserve cuts rates',
          url: 'https://example.com/fomc-fresh',
          domain: 'example.com',
          seendate: gdeltDate(),
          language: 'English',
          sourcecountry: 'US'
        }]
      }));
    }
    return response('<rss><channel></channel></rss>');
  };

  const activeHighCheck = await fetchLiveForexNews({ pairs: ['EUR/USD'], forceRefresh: true });
  assert.equal(activeHighCheck.highImpactCount, 1);
  assert.equal(activeHighCheck.activeHighImpactCount, 1);
  assert.equal(activeHighCheck.riskLevel, 'HIGH');

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) {
      return response(JSON.stringify({
        articles: [{
          title: 'Old FOMC rate decision remains in search results',
          url: 'https://example.com/stale-fomc',
          domain: 'example.com',
          seendate: gdeltDate(Date.now() - 26 * 60 * 60_000),
          language: 'English',
          sourcecountry: 'US'
        }]
      }));
    }
    return response('<rss><channel></channel></rss>');
  };

  const stale = await fetchLiveForexNews({ pairs: ['EUR/USD'], forceRefresh: true });
  assert.equal(stale.status, 'STALE');
  assert.equal(stale.articleCount, 0);
  assert.equal(stale.providerStatus?.GDELT_DOC_2, 'STALE');
  assert.equal(stale.providerDiagnostics?.GDELT_DOC_2?.rawArticleCount, 1);
  assert.equal(stale.providerDiagnostics?.GDELT_DOC_2?.freshArticleCount, 0);
  assert.equal(stale.providerDiagnostics?.GDELT_DOC_2?.staleArticleCount, 1);

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) {
      return response(JSON.stringify({
        articles: [{
          title: 'RBA rate decision released; Australian dollar volatility jumps',
          url: 'https://example.com/rba-fresh',
          domain: 'example.com',
          seendate: gdeltDate(),
          language: 'English',
          sourcecountry: 'AU'
        }]
      }));
    }
    return response('<rss><channel></channel></rss>');
  };

  const pairSpecificRisk = await fetchLiveForexNews({
    pairs: ['EUR/USD', 'AUD/USD'],
    forceRefresh: true
  });
  assert.equal(pairSpecificRisk.pairRisk?.['EUR/USD']?.riskLevel, 'LOW');
  assert.equal(pairSpecificRisk.pairRisk?.['AUD/USD']?.riskLevel, 'HIGH');

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async () => response('', 503);
  const unavailable = await fetchLiveForexNews({ pairs: ['USD/JPY'], forceRefresh: true });
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.riskLevel, 'UNAVAILABLE');
  assert.equal(unavailable.articleCount, 0);
  assert.equal(unavailable.providerStatus?.GDELT_DOC_2, 'ERROR');
  assert.equal(unavailable.providerStatus?.GOOGLE_NEWS_RSS, 'ERROR');

  resetLiveForexNewsCacheForTest();

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('www.forexfactory.com/news')) {
      return response(`
        <html><body>
          <a href="/news/1234567-rba-governor-speaks">RBA Governor Bullock: Supply shocks pose challenges for monetary policy</a>
          <span>From @FirstSquawk | 5 min ago | 4 comments</span>
          <p>RBA Governor Bullock discusses inflation and monetary policy.</p>
          <a href="/news/1234566-us-dollar-holds-firm">US Dollar Holds Firm as Oil Eases</a>
          <span>From forex.com | 12 min ago | 2 comments</span>
          <p>US dollar and oil markets react to the latest Federal Reserve outlook.</p>
        </body></html>
      `);
    }
    if (url.includes('api.gdeltproject.org')) return response('<rss></rss>');
    return response('<rss><channel></channel></rss>');
  };

  const forexFactory = await fetchLiveForexNews({ pairs: ['AUD/USD'], forceRefresh: true });
  assert.equal(forexFactory.status, 'LIVE');
  assert.equal(forexFactory.source, 'FOREX_FACTORY');
  assert.equal(forexFactory.articleCount, 2);
  assert.equal(forexFactory.providerStatus?.FOREX_FACTORY, 'LIVE');
  assert.equal(forexFactory.providerDiagnostics?.FOREX_FACTORY?.rawArticleCount, 2);
  assert.equal(forexFactory.providerDiagnostics?.FOREX_FACTORY?.freshArticleCount, 2);
  assert.match(forexFactory.articles[0].url, /^https:\/\/www\.forexfactory\.com\/news\//);
  assert.match(forexFactory.articles[0].publishedAt || '', /^20\d\d-/);

  resetLiveForexNewsCacheForTest();
  console.log('LIVE NEWS SERVICE TEST PASSED');
} finally {
  globalThis.fetch = originalFetch;
}
