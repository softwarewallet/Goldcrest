export interface LiveNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  language?: string;
  sourceCountry?: string;
}

export type LiveNewsSource = 'GDELT_DOC_2' | 'GOOGLE_NEWS_RSS' | 'NONE';

export interface LiveNewsSnapshot {
  source: LiveNewsSource;
  fetchedAt: string;
  status: 'LIVE' | 'NO_RESULTS' | 'UNAVAILABLE';
  articleCount: number;
  highImpactCount: number;
  elevatedCount: number;
  riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' | 'UNAVAILABLE';
  articles: LiveNewsArticle[];
  error?: string;
}

const GDELT_ENDPOINT = process.env.GOLDCREST_GDELT_DOC_URL
  || 'https://api.gdeltproject.org/api/v2/doc/doc';

const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';

const NEWS_QUERIES = [
  '(forex OR currency OR "foreign exchange" OR USD OR EUR OR GBP OR JPY OR "Federal Reserve" OR ECB OR "Bank of Japan" OR inflation OR CPI OR NFP)',
  '("interest rate" OR "rate decision" OR tariff OR sanctions OR intervention OR "central bank") (USD OR EUR OR GBP OR JPY OR forex OR currency)'
];

const HIGH_IMPACT_TERMS = [
  'federal reserve', 'fed', 'ecb', 'bank of japan', 'boj', 'interest rate',
  'rate decision', 'cpi', 'inflation', 'nonfarm payroll', 'nfp', 'jobs report',
  'tariff', 'sanction', 'intervention', 'war', 'conflict', 'emergency'
];

const ELEVATED_TERMS = [
  'central bank', 'pmi', 'retail sales', 'gdp', 'employment', 'yield',
  'treasury', 'dollar', 'euro', 'pound', 'yen', 'currency'
];

const CACHE_TTL_MS = Math.max(60_000, Number(process.env.GOLDCREST_NEWS_CACHE_TTL_MS || 120_000));
const FAILURE_BACKOFF_MS = Math.max(60_000, Number(process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS || 300_000));
const REQUEST_TIMEOUT_MS = Math.max(8_000, Number(process.env.GOLDCREST_NEWS_TIMEOUT_MS || 15_000));

let newsCache: { snapshot: LiveNewsSnapshot; expiresAt: number } | null = null;
let unavailableBackoffUntil = 0;

function classifyArticle(title: string): 'HIGH' | 'ELEVATED' | 'LOW' {
  const normalized = title.toLowerCase();
  if (HIGH_IMPACT_TERMS.some(term => normalized.includes(term))) return 'HIGH';
  if (ELEVATED_TERMS.some(term => normalized.includes(term))) return 'ELEVATED';
  return 'LOW';
}

function scoreArticles(articles: LiveNewsArticle[]): Pick<LiveNewsSnapshot, 'highImpactCount' | 'elevatedCount' | 'riskLevel'> {
  let highImpactCount = 0;
  let elevatedCount = 0;

  for (const article of articles) {
    const classification = classifyArticle(article.title);
    if (classification === 'HIGH') highImpactCount += 1;
    else if (classification === 'ELEVATED') elevatedCount += 1;
  }

  return {
    highImpactCount,
    elevatedCount,
    riskLevel: highImpactCount >= 3
      ? 'HIGH'
      : (highImpactCount > 0 || elevatedCount >= 4)
        ? 'ELEVATED'
        : 'LOW'
  };
}

function parseGdeltArticles(payload: any): LiveNewsArticle[] {
  const rows = Array.isArray(payload?.articles) ? payload.articles : [];
  return rows
    .map((row: any) => ({
      title: String(row?.title || '').trim(),
      url: String(row?.url || row?.urlMobile || '').trim(),
      source: String(row?.domain || row?.sourceCountry || 'GDELT').trim(),
      publishedAt: row?.seendate ? String(row.seendate) : null,
      language: row?.language ? String(row.language) : undefined,
      sourceCountry: row?.sourcecountry ? String(row.sourcecountry) : undefined
    }))
    .filter((article: LiveNewsArticle) => Boolean(article.title && article.url));
}

function parseGoogleNewsRss(xml: string): LiveNewsArticle[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.map(item => {
    const readTag = (tag: string) => {
      const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };

    const title = readTag('title');
    const url = readTag('link');
    const source = readTag('source') || 'Google News';
    const publishedAt = readTag('pubDate') || null;

    return { title, url, source, publishedAt };
  }).filter(article => Boolean(article.title && article.url));
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Goldcrest/2.0 live-market-news',
        'Accept': 'application/json, application/rss+xml, application/xml, text/xml, text/plain, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`News request failed with HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromGdelt(): Promise<LiveNewsArticle[]> {
  for (const query of NEWS_QUERIES) {
    const url = new URL(GDELT_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('mode', 'artlist');
    url.searchParams.set('format', 'json');
    url.searchParams.set('timespan', process.env.GOLDCREST_NEWS_TIMESPAN || '24h');
    url.searchParams.set('maxrecords', process.env.GOLDCREST_NEWS_MAX_RECORDS || '30');
    url.searchParams.set('sort', 'datedesc');

    try {
      const text = await fetchText(url);
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('GDELT returned a non-JSON response.');
      }

      const articles = parseGdeltArticles(payload);
      if (articles.length > 0) return articles;
    } catch (error: any) {
      // Try the next narrower query before failing the provider.
      if (query === NEWS_QUERIES[NEWS_QUERIES.length - 1]) {
        throw error;
      }
    }
  }

  return [];
}

async function fetchFromGoogleNewsRss(): Promise<LiveNewsArticle[]> {
  const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
  url.searchParams.set('q', 'forex OR currency OR "Federal Reserve" OR ECB OR inflation OR CPI OR NFP');
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');

  const xml = await fetchText(url);
  return parseGoogleNewsRss(xml);
}

function unavailableSnapshot(error: unknown, source: LiveNewsSource = 'NONE'): LiveNewsSnapshot {
  return {
    source,
    fetchedAt: new Date().toISOString(),
    status: 'UNAVAILABLE',
    articleCount: 0,
    highImpactCount: 0,
    elevatedCount: 0,
    riskLevel: 'UNAVAILABLE',
    articles: [],
    error: error instanceof Error ? error.message : String(error)
  };
}

export async function fetchLiveForexNews(): Promise<LiveNewsSnapshot> {
  const now = Date.now();

  if (newsCache && now < newsCache.expiresAt) {
    return newsCache.snapshot;
  }

  if (now < unavailableBackoffUntil && newsCache?.snapshot.status === 'UNAVAILABLE') {
    return newsCache.snapshot;
  }

  try {
    let articles: LiveNewsArticle[] = [];
    let source: LiveNewsSource = 'GDELT_DOC_2';
    let primaryError: string | undefined;

    try {
      articles = await fetchFromGdelt();
    } catch (error: any) {
      primaryError = error?.message || String(error);
    }

    if (articles.length === 0) {
      try {
        articles = await fetchFromGoogleNewsRss();
        source = 'GOOGLE_NEWS_RSS';
      } catch (error: any) {
        const secondaryError = error?.message || String(error);
        const combinedError = primaryError
          ? `GDELT: ${primaryError}; Google News RSS: ${secondaryError}`
          : `Google News RSS: ${secondaryError}`;

        const snapshot = unavailableSnapshot(combinedError, 'NONE');
        newsCache = { snapshot, expiresAt: now + Math.min(CACHE_TTL_MS, FAILURE_BACKOFF_MS) };
        unavailableBackoffUntil = now + FAILURE_BACKOFF_MS;
        return snapshot;
      }
    }

    if (articles.length === 0) {
      const snapshot: LiveNewsSnapshot = {
        source,
        fetchedAt: new Date().toISOString(),
        status: 'NO_RESULTS',
        articleCount: 0,
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'LOW',
        articles: []
      };
      newsCache = { snapshot, expiresAt: now + CACHE_TTL_MS };
      return snapshot;
    }

    const deduped = Array.from(new Map(articles.map(article => [article.url, article])).values()).slice(0, 30);
    const score = scoreArticles(deduped);

    const snapshot: LiveNewsSnapshot = {
      source,
      fetchedAt: new Date().toISOString(),
      status: 'LIVE',
      articleCount: deduped.length,
      highImpactCount: score.highImpactCount,
      elevatedCount: score.elevatedCount,
      riskLevel: score.riskLevel,
      articles: deduped.slice(0, 20)
    };

    newsCache = { snapshot, expiresAt: now + CACHE_TTL_MS };
    unavailableBackoffUntil = 0;
    return snapshot;
  } catch (error: any) {
    const snapshot = unavailableSnapshot(error, 'NONE');
    newsCache = { snapshot, expiresAt: now + Math.min(CACHE_TTL_MS, FAILURE_BACKOFF_MS) };
    unavailableBackoffUntil = now + FAILURE_BACKOFF_MS;
    return snapshot;
  }
}
