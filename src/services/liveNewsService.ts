export interface LiveNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  language?: string;
  sourceCountry?: string;
}

export type LiveNewsSource = 'GDELT_DOC_2' | 'GOOGLE_NEWS_RSS' | 'NONE';
export type LiveNewsProviderStatus = 'LIVE' | 'NO_RESULTS' | 'ERROR';

export interface LiveNewsSnapshot {
  source: LiveNewsSource;
  fetchedAt: string;
  status: 'LIVE' | 'NO_RESULTS' | 'UNAVAILABLE';
  articleCount: number;
  highImpactCount: number;
  elevatedCount: number;
  riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' | 'UNAVAILABLE';
  articles: LiveNewsArticle[];
  queryPairs?: string[];
  providerStatus?: {
    GDELT_DOC_2: LiveNewsProviderStatus;
    GOOGLE_NEWS_RSS: LiveNewsProviderStatus;
  };
  latestArticleAt?: string | null;
  error?: string;
}

export interface LiveNewsFetchOptions {
  pairs?: string[];
  forceRefresh?: boolean;
}

const GDELT_ENDPOINT = process.env.GOLDCREST_GDELT_DOC_URL
  || 'https://api.gdeltproject.org/api/v2/doc/doc';

const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';

const MACRO_NEWS_QUERY = [
  '"Federal Reserve"', 'FOMC', 'ECB', '"Bank of Japan"', 'BOJ',
  '"interest rate"', '"rate decision"', 'CPI', 'inflation', 'NFP',
  '"nonfarm payroll"', 'jobs report', tariff, sanctions, intervention,
  war, conflict, emergency, "central bank"
];

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'dollar',
  EUR: 'euro',
  GBP: 'pound',
  JPY: 'yen',
  CHF: 'franc',
  AUD: 'australian dollar',
  NZD: 'new zealand dollar',
  CAD: 'canadian dollar'
};

const HIGH_IMPACT_TERMS = [
  'fomc', 'federal reserve', 'rate decision', 'interest rate', 'rate hike',
  'rate cut', 'rate hold', 'cpi', 'inflation', 'nonfarm payroll',
  'nfp', 'jobs report', 'tariff', 'sanction', 'intervention',
  'war', 'conflict', 'emergency', 'bank of japan', 'boj', 'ecb'
];

const ELEVATED_TERMS = [
  'central bank', 'pmi', 'retail sales', 'gdp', 'employment', 'yield',
  'treasury', 'dollar', 'euro', 'pound', 'yen', 'franc', 'currency'
];

const CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.GOLDCREST_NEWS_CACHE_TTL_MS || 90_000)
);
const FAILURE_BACKOFF_MS = Math.max(
  60_000,
  Number(process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS || 180_000)
);
const REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_TIMEOUT_MS || 8_000)
);
const MAX_ARTICLE_AGE_MS = Math.max(
  15 * 60_000,
  Number(process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS || 8 * 60 * 60_000)
);

let newsCache: {
  key: string;
  snapshot: LiveNewsSnapshot;
  expiresAt: number;
} | null = null;

let unavailableBackoff: {
  key: string;
  until: number;
} | null = null;

let inFlight: {
  key: string;
  promise: Promise<LiveNewsSnapshot>;
} | null = null;

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Live news request timed out.';
    return error.message;
  }
  return String(error);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code: string) => {
      const numeric = code.toLowerCase().startsWith('x')
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
    })
    .trim();
}

function normalizePublishedAt(value: unknown): string | null {
  const raw = decodeXmlEntities(String(value ?? '').trim());
  if (!raw) return null;

  const gdeltMatch = raw.match(/^(\d{8})T?(\d{6})Z?$/i);
  if (gdeltMatch) {
    const [, date, time] = gdeltMatch;
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizePair(pair: string): string {
  const normalized = pair.toUpperCase().trim().replace(/\\/g, '/');
  if (normalized.includes('/')) {
    const [base, quote] = normalized.split('/');
    return base && quote ? `${base}/${quote}` : normalized;
  }
  if (normalized.length === 6) return `${normalized.slice(0, 3)}/${normalized.slice(3)}`;
  return normalized;
}

function normalizePairs(pairs: string[] | undefined): string[] {
  if (!Array.isArray(pairs)) return [];
  return [...new Set(
    pairs
      .map(value => normalizePair(String(value)))
      .filter(pair => /^[A-Z]{3}\/[A-Z]{3}$/.test(pair))
  )].sort();
}

function buildPairQuery(pairs: string[]): string {
  if (pairs.length === 0) return '';

  const pairClauses = pairs.map(pair => {
    const [base, quote] = pair.split('/');
    const baseName = CURRENCY_NAMES[base] || base;
    const quoteName = CURRENCY_NAMES[quote] || quote;
    return `((${base} OR "${baseName}") (${quote} OR "${quoteName}"))`;
  });

  return pairClauses.join(' OR ');
}

function buildNewsQuery(pairs: string[]): string {
  const macro = `(${MACRO_NEWS_QUERY.join(' OR ')})`;
  const pairQuery = buildPairQuery(pairs);
  return pairQuery ? `(${macro}) OR (${pairQuery})` : macro;
}

function classifyArticle(title: string): 'HIGH' | 'ELEVATED' | 'LOW' {
  const normalized = title.toLowerCase();

  // A generic mention of the Fed/ECB/etc. is not by itself a high-risk event.
  // Require an explicit rate/macro/event term before classifying a headline HIGH.
  const highImpact = HIGH_IMPACT_TERMS.some(term => normalized.includes(term));
  if (highImpact) return 'HIGH';

  if (ELEVATED_TERMS.some(term => normalized.includes(term))) return 'ELEVATED';
  return 'LOW';
}

function scoreArticles(
  articles: LiveNewsArticle[]
): Pick<LiveNewsSnapshot, 'highImpactCount' | 'elevatedCount' | 'riskLevel'> {
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
    // A single fresh, explicitly high-impact macro headline is sufficient to
    // pause autonomous entries. This keeps the safety gate conservative.
    riskLevel: highImpactCount > 0
      ? 'HIGH'
      : elevatedCount >= 4
        ? 'ELEVATED'
        : 'LOW'
  };
}

function parseGdeltArticles(payload: any): LiveNewsArticle[] {
  const rows = Array.isArray(payload?.articles) ? payload.articles : [];

  return rows
    .map((row: any) => ({
      title: decodeXmlEntities(String(row?.title || '')),
      url: decodeXmlEntities(String(row?.url || row?.urlMobile || '')),
      source: decodeXmlEntities(String(row?.domain || row?.sourceCountry || 'GDELT')),
      publishedAt: normalizePublishedAt(row?.seendate),
      language: row?.language ? decodeXmlEntities(String(row.language)) : undefined,
      sourceCountry: row?.sourcecountry
        ? decodeXmlEntities(String(row.sourcecountry))
        : undefined
    }))
    .filter((article: LiveNewsArticle) => Boolean(article.title && article.url));
}

function readXmlTag(block: string, tag: string): string {
  const match = block.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  );
  return match ? decodeXmlEntities(match[1]) : '';
}

function parseGoogleNewsRss(xml: string): LiveNewsArticle[] {
  const items = xml.match(/<item\\b[\\s\\S]*?<\\/item>/gi) || [];

  return items
    .map(item => ({
      title: readXmlTag(item, 'title'),
      url: readXmlTag(item, 'link'),
      source: readXmlTag(item, 'source') || 'Google News',
      publishedAt: normalizePublishedAt(readXmlTag(item, 'pubDate'))
    }))
    .filter(article => Boolean(article.title && article.url));
}

function filterFreshArticles(articles: LiveNewsArticle[], now: number): LiveNewsArticle[] {
  return articles.filter(article => {
    if (!article.publishedAt) return false;
    const timestamp = Date.parse(article.publishedAt);
    if (!Number.isFinite(timestamp)) return false;

    const age = now - timestamp;
    return age >= -5 * 60_000 && age <= MAX_ARTICLE_AGE_MS;
  });
}

function deduplicateArticles(articles: LiveNewsArticle[]): LiveNewsArticle[] {
  const ranked = [...articles].sort((a, b) => {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bTime - aTime;
  });

  const byKey = new Map<string, LiveNewsArticle>();
  for (const article of ranked) {
    const titleKey = article.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    const urlKey = article.url
      .toLowerCase()
      .replace(/[?#].*$/, '')
      .replace(/\\/$/, '');

    const key = `${titleKey}|${urlKey}`;
    if (!byKey.has(key)) byKey.set(key, article);
  }

  return [...byKey.values()];
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Goldcrest/2.0 live-market-news',
        'Accept': 'application/json, application/rss+xml, application/xml, text/xml, text/plain, */*',
        'Cache-Control': 'no-cache'
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

async function fetchFromGdelt(query: string): Promise<{ status: LiveNewsProviderStatus; articles: LiveNewsArticle[]; error?: string }> {
  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', process.env.GOLDCREST_NEWS_TIMESPAN || '6h');
  url.searchParams.set('maxrecords', process.env.GOLDCREST_NEWS_MAX_RECORDS || '50');
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
    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles
    };
  } catch (error) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(error)
    };
  }
}

async function fetchFromGoogleNewsRss(query: string): Promise<{ status: LiveNewsProviderStatus; articles: LiveNewsArticle[]; error?: string }> {
  const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
  url.searchParams.set('q', `${query} when:12h`);
  url.searchParams.set('hl', process.env.GOLDCREST_NEWS_LANGUAGE || 'en-US');
  url.searchParams.set('gl', process.env.GOLDCREST_NEWS_COUNTRY || 'US');
  url.searchParams.set('ceid', `${process.env.GOLDCREST_NEWS_COUNTRY || 'US'}:${(process.env.GOLDCREST_NEWS_LANGUAGE || 'en').split('-')[0]}`);

  try {
    const xml = await fetchText(url);
    const articles = parseGoogleNewsRss(xml);
    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles
    };
  } catch (error) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(error)
    };
  }
}

function unavailableSnapshot(
  error: unknown,
  queryPairs: string[],
  providerStatus: LiveNewsSnapshot['providerStatus']
): LiveNewsSnapshot {
  return {
    source: 'NONE',
    fetchedAt: new Date().toISOString(),
    status: 'UNAVAILABLE',
    articleCount: 0,
    highImpactCount: 0,
    elevatedCount: 0,
    riskLevel: 'UNAVAILABLE',
    articles: [],
    queryPairs,
    providerStatus,
    error: asErrorMessage(error)
  };
}

async function fetchLiveForexNewsInternal(
  options: LiveNewsFetchOptions
): Promise<LiveNewsSnapshot> {
  const now = Date.now();
  const queryPairs = normalizePairs(options.pairs);
  const queryKey = queryPairs.join(',');

  const newsQuery = buildNewsQuery(queryPairs);

  const results = await Promise.all([
    fetchFromGdelt(newsQuery),
    fetchFromGoogleNewsRss(newsQuery)
  ]);

  const freshByProvider = results.map(result => filterFreshArticles(result.articles, now));
  const providerStatus = {
    GDELT_DOC_2: results[0].status === 'ERROR'
      ? 'ERROR' as const
      : freshByProvider[0].length > 0
        ? 'LIVE' as const
        : 'NO_RESULTS' as const,
    GOOGLE_NEWS_RSS: results[1].status === 'ERROR'
      ? 'ERROR' as const
      : freshByProvider[1].length > 0
        ? 'LIVE' as const
        : 'NO_RESULTS' as const
  };

  const errors = results
    .map(result => result.error)
    .filter(Boolean) as string[];

  const fetchedArticles = freshByProvider.flat();
  const articles = deduplicateArticles(fetchedArticles).slice(0, 30);

  if (articles.length === 0) {
    const allErrored = results.every(result => result.status === 'ERROR');

    const snapshot: LiveNewsSnapshot = allErrored
      ? unavailableSnapshot(
          errors.join(' | ') || 'All live news providers failed.',
          queryPairs,
          providerStatus
        )
      : {
          source: 'NONE',
          fetchedAt: new Date().toISOString(),
          status: 'NO_RESULTS',
          articleCount: 0,
          highImpactCount: 0,
          elevatedCount: 0,
          riskLevel: 'LOW',
          articles: [],
          queryPairs,
          providerStatus,
          error: errors.length ? errors.join(' | ') : undefined
        };

    newsCache = {
      key: queryKey,
      snapshot,
      expiresAt: now + (snapshot.status === 'UNAVAILABLE'
        ? Math.min(CACHE_TTL_MS, FAILURE_BACKOFF_MS)
        : CACHE_TTL_MS)
    };

    if (snapshot.status === 'UNAVAILABLE') {
      unavailableBackoff = {
        key: queryKey,
        until: now + FAILURE_BACKOFF_MS
      };
    } else {
      unavailableBackoff = null;
    }

    return snapshot;
  }

  const score = scoreArticles(articles);
  const latestArticleAt = articles[0]?.publishedAt || null;

  const source: LiveNewsSource = freshByProvider[0].length > 0
    ? 'GDELT_DOC_2'
    : 'GOOGLE_NEWS_RSS';

  const snapshot: LiveNewsSnapshot = {
    source,
    fetchedAt: new Date().toISOString(),
    status: 'LIVE',
    articleCount: articles.length,
    highImpactCount: score.highImpactCount,
    elevatedCount: score.elevatedCount,
    riskLevel: score.riskLevel,
    articles,
    queryPairs,
    providerStatus,
    latestArticleAt,
    error: errors.length ? errors.join(' | ') : undefined
  };

  newsCache = {
    key: queryKey,
    snapshot,
    expiresAt: now + CACHE_TTL_MS
  };
  unavailableBackoff = null;
  return snapshot;
}

export async function fetchLiveForexNews(
  options: LiveNewsFetchOptions = {}
): Promise<LiveNewsSnapshot> {
  const queryPairs = normalizePairs(options.pairs);
  const key = queryPairs.join(',');
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && newsCache && newsCache.key === key && now < newsCache.expiresAt) {
    return newsCache.snapshot;
  }

  if (
    !forceRefresh
    && unavailableBackoff
    && unavailableBackoff.key === key
    && now < unavailableBackoff.until
    && newsCache?.key === key
    && newsCache.snapshot.status === 'UNAVAILABLE'
  ) {
    return newsCache.snapshot;
  }

  // Never start overlapping provider requests for the same working universe.
  // A forced refresh shares an already-running fetch rather than creating a duplicate load.
  if (inFlight?.key === key) {
    return inFlight.promise;
  }

  const promise = fetchLiveForexNewsInternal(options)
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });

  inFlight = { key, promise };
  return promise;
}

/**
 * Test-only cache reset used by deterministic provider/parser tests.
 * It is harmless in production and avoids global fetch state leaking between tests.
 */
export function resetLiveForexNewsCacheForTest(): void {
  newsCache = null;
  unavailableBackoff = null;
  inFlight = null;
}
