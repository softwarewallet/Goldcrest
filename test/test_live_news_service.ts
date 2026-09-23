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
  assert.match(requestedUrls.find(url => url.includes('api.gdeltproject.org')) || '', /EUR/);
  assert.match(requestedUrls.find(url => url.includes('news.google.com')) || '', /when%3A12h|when:12h/);

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

  globalThis.fetch = async () => response('', 503);
  const unavailable = await fetchLiveForexNews({ pairs: ['USD/JPY'], forceRefresh: true });
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.riskLevel, 'UNAVAILABLE');
  assert.equal(unavailable.articleCount, 0);
  assert.equal(unavailable.providerStatus?.GDELT_DOC_2, 'ERROR');
  assert.equal(unavailable.providerStatus?.GOOGLE_NEWS_RSS, 'ERROR');

  resetLiveForexNewsCacheForTest();
  console.log('LIVE NEWS SERVICE TEST PASSED');
} finally {
  globalThis.fetch = originalFetch;
}
