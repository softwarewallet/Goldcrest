export interface LiveNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  language?: string;
  sourceCountry?: string;
  summary?: string;
  bannerImage?: string | null;
  sentimentScore?: number;
  sentimentLabel?: string;
  topics?: string[];
}

export type LiveNewsSource = 'FINNHUB' | 'NEWSAPI' | 'JBLANKED' | 'GOOGLE_NEWS_RSS' | 'NONE';
export type LiveNewsProviderStatus = 'LIVE' | 'NO_RESULTS' | 'STALE' | 'RATE_LIMITED' | 'UNCONFIGURED' | 'ERROR';

export interface LiveNewsProviderDiagnostic {
  status: LiveNewsProviderStatus;
  rawArticleCount: number;
  freshArticleCount: number;
  staleArticleCount: number;
  configured: boolean;
  latencyMs?: number;
  latestRawArticleAt?: string | null;
  latestFreshArticleAt?: string | null;
  error?: string;
}

export interface LiveNewsSentimentSummary {
  averageScore: number;
  overallLabel: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

export interface LiveNewsSnapshot {
  source: LiveNewsSource;
  fetchedAt: string;
  status: 'LIVE' | 'NO_RESULTS' | 'STALE' | 'UNAVAILABLE';
  articleCount: number;
  highImpactCount: number;
  elevatedCount: number;
  /** Number of currently-active high-impact events relevant to the configured FX universe. */
  activeHighImpactCount?: number;
  riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' | 'UNAVAILABLE';
  articles: LiveNewsArticle[];
  queryPairs?: string[];
  providerStatus?: {
    FINNHUB: LiveNewsProviderStatus;
    NEWSAPI: LiveNewsProviderStatus;
    JBLANKED: LiveNewsProviderStatus;
    GOOGLE_NEWS_RSS: LiveNewsProviderStatus;
  };
  providerDiagnostics?: {
    FINNHUB: LiveNewsProviderDiagnostic;
    NEWSAPI: LiveNewsProviderDiagnostic;
    JBLANKED: LiveNewsProviderDiagnostic;
    GOOGLE_NEWS_RSS: LiveNewsProviderDiagnostic;
  };
  pairRisk?: Record<string, {
    highImpactCount: number;
    elevatedCount: number;
    riskLevel: 'HIGH' | 'ELEVATED' | 'LOW';
  }>;
  sentimentSummary?: LiveNewsSentimentSummary;
  latestArticleAt?: string | null;
  error?: string;
}

export interface LiveNewsFetchOptions {
  pairs?: string[];
  forceRefresh?: boolean;
}

const FINNHUB_ENDPOINT = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1/news';
const NEWSAPI_ENDPOINT = process.env.NEWSAPI_BASE_URL || 'https://newsapi.org/v2/everything';
const JBLANKED_BASE_URL = process.env.JBLANKED_BASE_URL || 'https://www.jblanked.com/news/api';
const GOOGLE_NEWS_RSS_ENDPOINT = process.env.GOOGLE_NEWS_RSS_BASE_URL || 'https://news.google.com/rss/search';

const REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_TIMEOUT_MS || 10_000)
);
const CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.GOLDCREST_NEWS_CACHE_TTL_MS || 60_000)
);
const FAILURE_BACKOFF_MS = Math.max(
  60_000,
  Number(process.env.GOLDCREST_NEWS_FAILURE_BACKOFF_MS || 180_000)
);
const MAX_ARTICLE_AGE_MS = Math.max(
  15 * 60_000,
  Number(process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS || 6 * 60 * 60_000)
);
const NEWSAPI_MAX_QUERIES = Math.max(
  1,
  Math.min(4, Number(process.env.NEWSAPI_MAX_QUERIES || 2))
);
const JBLANKED_MIN_INTERVAL_MS = Math.max(
  1_000,
  Number(process.env.JBLANKED_MIN_INTERVAL_MS || 1_100)
);
const GOOGLE_NEWS_RSS_MAX_QUERIES = Math.max(
  1,
  Math.min(4, Number(process.env.GOOGLE_NEWS_RSS_MAX_QUERIES || 2))
);
const GOOGLE_NEWS_RSS_MIN_PRIMARY_ARTICLES = Math.max(
  0,
  Number(process.env.GOOGLE_NEWS_RSS_MIN_PRIMARY_ARTICLES || 3)
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

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


function buildGdeltQuery(pairs: string[]): string {
  // Keep GDELT narrow enough to answer quickly. The previous universe-wide OR
  // query was prone to provider timeouts and mixed unrelated currencies.
  const eventTerms = [
    '"Federal Reserve"', 'FOMC', 'ECB', 'BOJ', '"Bank of England"',
    'RBA', 'RBNZ', '"Bank of Canada"', 'SNB', 'CPI',
    '"rate decision"', '"nonfarm payrolls"'
  ];
  const currencies = [...getRelevantCurrencies(pairs)]
    .flatMap(currency => CURRENCY_NEWS_ALIASES[currency] || [currency.toLowerCase()])
    .slice(0, 8);

  const eventQuery = `(${eventTerms.join(' OR ')})`;
  const currencyQuery = currencies.length > 0
    ? `(${[...new Set(currencies)].map(term => term.includes(' ') ? `"${term}"` : term).join(' OR ')})`
    : '';

  return currencyQuery ? `${eventQuery} AND ${currencyQuery}` : eventQuery;
}

function articleText(article: LiveNewsArticle): string {
  return [article.title, article.summary].filter(Boolean).join(' ').toLowerCase();
}

function getRelevantCurrencies(pairs: string[]): Set<string> {
  const currencies = new Set<string>();
  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    if (base) currencies.add(base);
    if (quote) currencies.add(quote);
  }
  return currencies;
}

function articleMentionsRelevantCurrency(article: LiveNewsArticle, relevantCurrencies: Set<string>): boolean {
  const text = articleText(article).replace(/[^a-z0-9.]+/g, ' ');
  for (const currency of relevantCurrencies) {
    const aliases = CURRENCY_NEWS_ALIASES[currency] || [currency.toLowerCase()];
    if (aliases.some(alias => {
      const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
      return ` ${text} `.includes(` ${normalizedAlias} `);
    })) return true;
  }
  return false;
}

function hasHighImpactEvent(article: LiveNewsArticle): boolean {
  const text = articleText(article);
  return HIGH_IMPACT_EVENT_PATTERNS.some(pattern => pattern.test(text))
    || GLOBAL_HIGH_IMPACT_PATTERNS.some(pattern => pattern.test(text));
}

function isArticleInsideHighImpactWindow(article: LiveNewsArticle, now: number): boolean {
  if (!article.publishedAt) return false;
  const timestamp = Date.parse(article.publishedAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= -5 * 60_000 && age <= NEWS_HIGH_IMPACT_ACTIVE_WINDOW_MS;
}

function classifyArticle(
  article: LiveNewsArticle,
  relevantCurrencies: Set<string>,
  now: number
): 'HIGH' | 'ELEVATED' | 'LOW' {
  const highImpactEvent = hasHighImpactEvent(article);
  const currencyRelevant = articleMentionsRelevantCurrency(article, relevantCurrencies);
  const globalEvent = GLOBAL_HIGH_IMPACT_PATTERNS.some(pattern => pattern.test(articleText(article)));

  // IMPORTANT: sentiment is never sufficient to classify a headline as HIGH.
  // A strongly bullish/bearish article is market information, not an economic
  // calendar event. HIGH is reserved for a specific event-type headline that
  // is both relevant to the FX universe and inside the short active window.
  if (highImpactEvent
    && (currencyRelevant || globalEvent)
    && isArticleInsideHighImpactWindow(article, now)) {
    return 'HIGH';
  }

  // FX risk must never be raised by an unrelated article. Sentiment or a
  // generic word such as "dollar" is only meaningful after the article has
  // been tied to at least one configured currency, or is an explicitly global
  // market shock.
  if (!currencyRelevant && !globalEvent) return 'LOW';

  if (typeof article.sentimentScore === 'number' && Math.abs(article.sentimentScore) >= 0.25) {
    return 'ELEVATED';
  }
  if (ELEVATED_TERMS.some(term => articleText(article).includes(term))) return 'ELEVATED';
  return 'LOW';
}

function scoreArticles(
  articles: LiveNewsArticle[],
  pairs: string[],
  now: number
): Pick<LiveNewsSnapshot, 'highImpactCount' | 'elevatedCount' | 'riskLevel' | 'activeHighImpactCount' | 'pairRisk'> {
  const relevantCurrencies = getRelevantCurrencies(pairs);
  let highImpactCount = 0;
  let elevatedCount = 0;

  for (const article of articles) {
    const classification = classifyArticle(article, relevantCurrencies, now);
    if (classification === 'HIGH') highImpactCount += 1;
    else if (classification === 'ELEVATED') elevatedCount += 1;
  }

  const pairRisk: NonNullable<LiveNewsSnapshot['pairRisk']> = {};
  for (const pair of pairs) {
    const pairCurrencies = getRelevantCurrencies([pair]);
    let pairHigh = 0;
    let pairElevated = 0;
    for (const article of articles) {
      const classification = classifyArticle(article, pairCurrencies, now);
      if (classification === 'HIGH') pairHigh += 1;
      else if (classification === 'ELEVATED') pairElevated += 1;
    }
    pairRisk[pair] = {
      highImpactCount: pairHigh,
      elevatedCount: pairElevated,
      riskLevel: pairHigh > 0 ? 'HIGH' : pairElevated >= 4 ? 'ELEVATED' : 'LOW'
    };
  }

  return {
    highImpactCount,
    elevatedCount,
    activeHighImpactCount: highImpactCount,
    riskLevel: highImpactCount > 0
      ? 'HIGH'
      : elevatedCount >= 4
        ? 'ELEVATED'
        : 'LOW',
    pairRisk
  };
}

function computeAggregatedSentiment(
  articles: LiveNewsArticle[]
): LiveNewsSentimentSummary | undefined {
  const scored = articles.filter(a => typeof a.sentimentScore === 'number');
  if (scored.length === 0) return undefined;

  let totalScore = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const a of scored) {
    const s = a.sentimentScore!;
    totalScore += s;
    if (s >= 0.15 || (a.sentimentLabel && a.sentimentLabel.toLowerCase().includes('bullish'))) {
      bullishCount += 1;
    } else if (s <= -0.15 || (a.sentimentLabel && a.sentimentLabel.toLowerCase().includes('bearish'))) {
      bearishCount += 1;
    } else {
      neutralCount += 1;
    }
  }

  const averageScore = Number((totalScore / scored.length).toFixed(4));
  let overallLabel = 'Neutral';
  if (averageScore >= 0.35) overallLabel = 'Bullish';
  else if (averageScore >= 0.15) overallLabel = 'Somewhat-Bullish';
  else if (averageScore <= -0.35) overallLabel = 'Bearish';
  else if (averageScore <= -0.15) overallLabel = 'Somewhat-Bearish';

  return {
    averageScore,
    overallLabel,
    bullishCount,
    bearishCount,
    neutralCount
  };
}


async function fetchText(
  url: URL,
  headers: Record<string, string> = {}
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, text/plain',
        'User-Agent': 'Goldcrest/2.0 live-forex-news',
        ...headers
      }
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error('HTTP ' + response.status + ': ' + (text.slice(0, 250) || response.statusText));
      (error as any).status = response.status;
      throw error;
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(
  url: URL,
  headers: Record<string, string> = {}
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Goldcrest/2.0 live-forex-news',
        ...headers
      }
    });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || text.slice(0, 250) || response.statusText;
      const error = new Error(`HTTP ${response.status}: ${message}`);
      (error as any).status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFromFinnhub(): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) return { status: 'UNCONFIGURED', articles: [] };

  const startedAt = Date.now();
  try {
    const url = new URL(FINNHUB_ENDPOINT);
    url.searchParams.set('category', 'forex');
    const payload = await fetchJson(url, { 'X-Finnhub-Token': token });
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.news) ? payload.news : [];

    const articles: LiveNewsArticle[] = rows
      .map((row: any) => ({
        title: decodeXmlEntities(String(row?.headline || row?.title || '')),
        url: decodeXmlEntities(String(row?.url || '')),
        source: decodeXmlEntities(String(row?.source || row?.publisher || 'Finnhub')),
        publishedAt: normalizePublishedAt(
          Number.isFinite(Number(row?.datetime)) ? Number(row.datetime) * 1000 : row?.datetime
        ),
        summary: decodeXmlEntities(String(row?.summary || row?.description || '')),
        bannerImage: decodeXmlEntities(String(row?.image || '')) || null
      }))
      .filter((article: LiveNewsArticle) => Boolean(article.title && article.url));

    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - startedAt
    };
  } catch (error: any) {
    return {
      status: Number(error?.status) === 429 ? 'RATE_LIMITED' : 'ERROR',
      articles: [],
      error: error?.name === 'AbortError'
        ? 'Finnhub news request timed out.'
        : error?.message || String(error),
      latencyMs: Date.now() - startedAt
    };
  }
}

function buildNewsApiQueries(pairs: string[]): string[] {
  const queries: string[] = [];

  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    const baseAliases = (CURRENCY_NEWS_ALIASES[base] || [base.toLowerCase()])
      .slice(0, 3)
      .map(alias => `"${alias}"`);
    const quoteAliases = (CURRENCY_NEWS_ALIASES[quote] || [quote.toLowerCase()])
      .slice(0, 3)
      .map(alias => `"${alias}"`);

    queries.push(
      `("${pair}" OR ${baseAliases.join(' OR ')} OR ${quoteAliases.join(' OR ')}) AND (forex OR "exchange rate" OR "interest rate" OR inflation OR "central bank")`
    );
  }

  if (queries.length === 0) {
    queries.push('forex OR "foreign exchange" OR "central bank" OR FOMC OR ECB OR BOJ');
  }

  return [...new Set(queries)].slice(0, NEWSAPI_MAX_QUERIES);
}

async function fetchFromNewsApi(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const apiKey = process.env.NEWSAPI_API_KEY?.trim();
  if (!apiKey) return { status: 'UNCONFIGURED', articles: [] };

  const startedAt = Date.now();
  const results: LiveNewsArticle[] = [];
  const errors: string[] = [];

  for (const query of buildNewsApiQueries(pairs)) {
    try {
      const url = new URL(NEWSAPI_ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('language', 'en');
      url.searchParams.set('sortBy', 'publishedAt');
      url.searchParams.set('pageSize', '100');
      // NewsAPI's free Developer plan can deliver articles with a delay.
      // Pull a wider window for diagnostics, then the normal freshness gate
      // decides whether the article is eligible for live Forex analysis.
      url.searchParams.set(
        'from',
        new Date(Date.now() - 48 * 60 * 60_000).toISOString()
      );

      const payload = await fetchJson(url, { 'X-Api-Key': apiKey });
      if (payload?.status === 'error') {
        throw new Error(payload.message || 'NewsAPI returned an error.');
      }

      const rows = Array.isArray(payload?.articles) ? payload.articles : [];
      results.push(...rows.map((row: any) => ({
        title: decodeXmlEntities(String(row?.title || '')),
        url: decodeXmlEntities(String(row?.url || '')),
        source: decodeXmlEntities(String(row?.source?.name || 'NewsAPI')),
        publishedAt: normalizePublishedAt(row?.publishedAt),
        summary: decodeXmlEntities(String(row?.description || row?.content || '')),
        bannerImage: decodeXmlEntities(String(row?.urlToImage || '')) || null
      })).filter((article: LiveNewsArticle) => Boolean(article.title && article.url)));
    } catch (error: any) {
      errors.push(error?.name === 'AbortError'
        ? 'NewsAPI request timed out.'
        : error?.message || String(error));
    }
  }

  const articles = deduplicateArticles(results);
  return {
    status: articles.length > 0
      ? 'LIVE'
      : errors.length === buildNewsApiQueries(pairs).length ? 'ERROR' : 'NO_RESULTS',
    articles,
    error: errors.length ? errors.join(' | ') : undefined,
    latencyMs: Date.now() - startedAt
  };
}

function buildGoogleNewsRssQueries(pairs: string[]): string[] {
  const queries: string[] = [];
  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    const baseAliases = (CURRENCY_NEWS_ALIASES[base] || [base.toLowerCase()]).slice(0, 2);
    const quoteAliases = (CURRENCY_NEWS_ALIASES[quote] || [quote.toLowerCase()]).slice(0, 2);
    queries.push(
      '(' + [
        '"' + pair + '"',
        '"' + base + '"',
        '"' + quote + '"',
        ...baseAliases.map(alias => '"' + alias + '"'),
        ...quoteAliases.map(alias => '"' + alias + '"')
      ].join(' OR ') + ') AND (forex OR "foreign exchange" OR "central bank" OR inflation OR "interest rate")'
    );
  }
  if (queries.length === 0) {
    queries.push('forex OR "foreign exchange" OR "central bank" OR FOMC OR ECB OR BOJ');
  }
  return [...new Set(queries)].slice(0, GOOGLE_NEWS_RSS_MAX_QUERIES);
}

function xmlTagValue(item: string, tag: string): string {
  const match = item.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' ')) : '';
}

async function fetchFromGoogleNewsRss(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const startedAt = Date.now();
  const results: LiveNewsArticle[] = [];
  const errors: string[] = [];

  for (const query of buildGoogleNewsRssQueries(pairs)) {
    try {
      const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('hl', 'en-US');
      url.searchParams.set('gl', 'US');
      url.searchParams.set('ceid', 'US:en');

      const xml = await fetchText(url);
      const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
      for (const item of items) {
        const title = xmlTagValue(item, 'title');
        const link = xmlTagValue(item, 'link');
        const publishedAt = normalizePublishedAt(xmlTagValue(item, 'pubDate'));
        const source = xmlTagValue(item, 'source') || 'Google News RSS';
        const summary = xmlTagValue(item, 'description');
        if (!title || !link || !publishedAt) continue;
        results.push({ title, url: link, source, publishedAt, summary });
      }
    } catch (error: any) {
      errors.push(error?.name === 'AbortError'
        ? 'Google News RSS request timed out.'
        : error?.message || String(error));
    }
  }

  const articles = deduplicateArticles(results);
  return {
    status: articles.length > 0
      ? 'LIVE'
      : errors.length === buildGoogleNewsRssQueries(pairs).length ? 'ERROR' : 'NO_RESULTS',
    articles,
    error: errors.length ? errors.join(' | ') : undefined,
    latencyMs: Date.now() - startedAt
  };
}

function normalizeJBlankedEvent(row: any, endpoint: string): LiveNewsArticle | null {
  const name = decodeXmlEntities(String(row?.Name || row?.name || row?.event || row?.title || ''));
  const currency = decodeXmlEntities(String(row?.Currency || row?.currency || ''));
  const impact = decodeXmlEntities(String(row?.Impact || row?.impact || ''));
  const category = decodeXmlEntities(String(row?.Category || row?.category || ''));
  const date = normalizePublishedAt(row?.Date || row?.date || row?.time);
  const actual = row?.Actual ?? row?.actual;
  const forecast = row?.Forecast ?? row?.forecast;
  const previous = row?.Previous ?? row?.previous;
  const outcome = decodeXmlEntities(String(row?.Outcome || row?.outcome || ''));
  const strength = decodeXmlEntities(String(row?.Strength || row?.strength || ''));
  const quality = decodeXmlEntities(String(row?.Quality || row?.quality || ''));

  if (!name || !date) return null;

  const summary = [
    currency ? `Currency: ${currency}` : '',
    category ? `Category: ${category}` : '',
    impact ? `Impact: ${impact}` : '',
    actual !== undefined && actual !== null ? `Actual: ${actual}` : '',
    forecast !== undefined && forecast !== null ? `Forecast: ${forecast}` : '',
    previous !== undefined && previous !== null ? `Previous: ${previous}` : '',
    outcome ? `Outcome: ${outcome}` : '',
    strength ? `Strength: ${strength}` : '',
    quality ? `Quality: ${quality}` : ''
  ].filter(Boolean).join(' | ');

  const sentimentScore = /good|bullish|positive/i.test(quality)
    ? 0.5
    : /bad|bearish|negative/i.test(quality)
      ? -0.5
      : undefined;

  return {
    title: `${currency ? `[${currency}] ` : ''}${name}${impact ? ` [${impact}]` : ''}`,
    url: `${JBLANKED_BASE_URL}${endpoint}`,
    source: 'JBlanked Forex Calendar',
    publishedAt: date,
    summary,
    sentimentScore,
    sentimentLabel: sentimentScore === undefined ? undefined : sentimentScore > 0 ? 'Bullish' : 'Bearish',
    topics: [category, impact, strength, quality].filter(Boolean)
  };
}

let jblankedNextAllowedAt = 0;

async function fetchFromJBlanked(): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
  latencyMs?: number;
}> {
  const apiKey = process.env.JBLANKED_API_KEY?.trim();
  if (!apiKey) return { status: 'UNCONFIGURED', articles: [] };

  const startedAt = Date.now();
  const endpoints = [
    '/mql5/calendar/today/',
    '/forex-factory/calendar/today/'
  ];
  const articles: LiveNewsArticle[] = [];
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    const waitMs = jblankedNextAllowedAt - Date.now();
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    jblankedNextAllowedAt = Date.now() + JBLANKED_MIN_INTERVAL_MS;

    try {
      const url = new URL(`${JBLANKED_BASE_URL}${endpoint}`);
      const payload = await fetchJson(url, {
        Authorization: `Api-Key ${apiKey}`,
        'Content-Type': 'application/json'
      });
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.results) ? payload.results : [];
      for (const row of rows) {
        const article = normalizeJBlankedEvent(row, endpoint);
        if (article) articles.push(article);
      }
    } catch (error: any) {
      errors.push(error?.name === 'AbortError'
        ? 'JBlanked news request timed out.'
        : error?.message || String(error));
    }
  }

  const normalized = deduplicateArticles(articles);
  return {
    status: normalized.length > 0
      ? 'LIVE'
      : errors.length === endpoints.length ? 'ERROR' : 'NO_RESULTS',
    articles: normalized,
    error: errors.length ? errors.join(' | ') : undefined,
    latencyMs: Date.now() - startedAt
  };
}

function latestArticleAt(articles: LiveNewsArticle[]): string | null {
  return articles.reduce<string | null>((latest, article) => {
    if (!article.publishedAt) return latest;
    if (!latest) return article.publishedAt;
    return Date.parse(article.publishedAt) > Date.parse(latest) ? article.publishedAt : latest;
  }, null);
}

function providerEffectiveStatus(
  rawStatus: LiveNewsProviderStatus,
  rawCount: number,
  freshCount: number
): LiveNewsProviderStatus {
  if (rawStatus === 'UNCONFIGURED' || rawStatus === 'ERROR' || rawStatus === 'RATE_LIMITED') {
    return rawStatus;
  }
  if (freshCount > 0) return 'LIVE';
  if (rawCount > 0) return 'STALE';
  return 'NO_RESULTS';
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
    activeHighImpactCount: 0,
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

  const [finnhubRes, newsApiRes, jblankedRes, googleNewsRssRes] = await Promise.all([
    fetchFromFinnhub(),
    fetchFromNewsApi(queryPairs),
    fetchFromJBlanked(),
    fetchFromGoogleNewsRss(queryPairs)
  ]);

  const freshFinnhub = filterFreshArticles(finnhubRes.articles, now);
  const freshNewsApi = filterFreshArticles(newsApiRes.articles, now);
  const freshJBlanked = filterFreshArticles(jblankedRes.articles, now);
  const freshGoogleNewsRss = filterFreshArticles(googleNewsRssRes.articles, now);

  const providerStatus: LiveNewsSnapshot['providerStatus'] = {
    FINNHUB: providerEffectiveStatus(
      finnhubRes.status,
      finnhubRes.articles.length,
      freshFinnhub.length
    ),
    NEWSAPI: providerEffectiveStatus(
      newsApiRes.status,
      newsApiRes.articles.length,
      freshNewsApi.length
    ),
    JBLANKED: providerEffectiveStatus(
      jblankedRes.status,
      jblankedRes.articles.length,
      freshJBlanked.length
    ),
    GOOGLE_NEWS_RSS: providerEffectiveStatus(
      googleNewsRssRes.status,
      googleNewsRssRes.articles.length,
      freshGoogleNewsRss.length
    )
  };

  const errors = [
    finnhubRes.error,
    newsApiRes.error,
    jblankedRes.error,
    googleNewsRssRes.error
  ].filter(Boolean) as string[];

  const providerDiagnostics: LiveNewsSnapshot['providerDiagnostics'] = {
    FINNHUB: {
      status: providerStatus.FINNHUB,
      rawArticleCount: finnhubRes.articles.length,
      freshArticleCount: freshFinnhub.length,
      staleArticleCount: Math.max(0, finnhubRes.articles.length - freshFinnhub.length),
      configured: finnhubRes.status !== 'UNCONFIGURED',
      latencyMs: finnhubRes.latencyMs,
      latestRawArticleAt: latestArticleAt(finnhubRes.articles),
      latestFreshArticleAt: latestArticleAt(freshFinnhub),
      error: finnhubRes.error
    },
    NEWSAPI: {
      status: providerStatus.NEWSAPI,
      rawArticleCount: newsApiRes.articles.length,
      freshArticleCount: freshNewsApi.length,
      staleArticleCount: Math.max(0, newsApiRes.articles.length - freshNewsApi.length),
      configured: newsApiRes.status !== 'UNCONFIGURED',
      latencyMs: newsApiRes.latencyMs,
      latestRawArticleAt: latestArticleAt(newsApiRes.articles),
      latestFreshArticleAt: latestArticleAt(freshNewsApi),
      error: newsApiRes.error
    },
    JBLANKED: {
      status: providerStatus.JBLANKED,
      rawArticleCount: jblankedRes.articles.length,
      freshArticleCount: freshJBlanked.length,
      staleArticleCount: Math.max(0, jblankedRes.articles.length - freshJBlanked.length),
      configured: jblankedRes.status !== 'UNCONFIGURED',
      latencyMs: jblankedRes.latencyMs,
      latestRawArticleAt: latestArticleAt(jblankedRes.articles),
      latestFreshArticleAt: latestArticleAt(freshJBlanked),
      error: jblankedRes.error
    }
,
    GOOGLE_NEWS_RSS: {
      status: providerStatus.GOOGLE_NEWS_RSS,
      rawArticleCount: googleNewsRssRes.articles.length,
      freshArticleCount: freshGoogleNewsRss.length,
      staleArticleCount: Math.max(0, googleNewsRssRes.articles.length - freshGoogleNewsRss.length),
      configured: true,
      latencyMs: googleNewsRssRes.latencyMs,
      latestRawArticleAt: latestArticleAt(googleNewsRssRes.articles),
      latestFreshArticleAt: latestArticleAt(freshGoogleNewsRss),
      error: googleNewsRssRes.error
    }  };

  // Finnhub provides live market headlines, JBlanked provides structured
  // macro/Forex calendar events, and NewsAPI is supplementary. Google News RSS
  // is retained as a no-key backup when primary fresh coverage is thin.
  const primaryFreshArticles = deduplicateArticles([
    ...freshFinnhub,
    ...freshJBlanked,
    ...freshNewsApi
  ]);
  const useGoogleNewsBackup = primaryFreshArticles.length < GOOGLE_NEWS_RSS_MIN_PRIMARY_ARTICLES;
  const fetchedArticles = useGoogleNewsBackup
    ? [...primaryFreshArticles, ...freshGoogleNewsRss]
    : primaryFreshArticles;
  const articles = deduplicateArticles(fetchedArticles).slice(0, 100);

  if (articles.length === 0) {
    const configuredProviders = [finnhubRes, newsApiRes, jblankedRes, googleNewsRssRes]
      .filter(result => result.status !== 'UNCONFIGURED');
    const allUnavailable = configuredProviders.length > 0
      && configuredProviders.every(result => ['ERROR', 'RATE_LIMITED'].includes(result.status));

    const snapshot: LiveNewsSnapshot = {
      source: 'NONE',
      fetchedAt: new Date().toISOString(),
      status: allUnavailable ? 'UNAVAILABLE' : 'STALE',
      articleCount: 0,
      highImpactCount: 0,
      elevatedCount: 0,
      activeHighImpactCount: 0,
      riskLevel: allUnavailable ? 'UNAVAILABLE' : 'LOW',
      articles: [],
      queryPairs,
      providerStatus,
      providerDiagnostics,
      error: errors.length
        ? errors.join(' | ')
        : 'No fresh Forex news/events are currently available.'
    };

    newsCache = {
      key: queryKey,
      snapshot,
      expiresAt: now + (
        snapshot.status === 'UNAVAILABLE'
          ? Math.min(CACHE_TTL_MS, FAILURE_BACKOFF_MS)
          : CACHE_TTL_MS
      )
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

  const score = scoreArticles(articles, queryPairs, now);
  const sentiment = computeAggregatedSentiment(articles);

  const source: LiveNewsSource = freshFinnhub.length > 0
    ? 'FINNHUB'
    : freshJBlanked.length > 0
      ? 'JBLANKED'
      : freshNewsApi.length > 0
        ? 'NEWSAPI'
        : 'GOOGLE_NEWS_RSS';

  const snapshot: LiveNewsSnapshot = {
    source,
    fetchedAt: new Date().toISOString(),
    status: 'LIVE',
    articleCount: articles.length,
    highImpactCount: score.highImpactCount,
    elevatedCount: score.elevatedCount,
    activeHighImpactCount: score.activeHighImpactCount,
    riskLevel: score.riskLevel,
    articles,
    queryPairs,
    providerStatus,
    providerDiagnostics,
    pairRisk: score.pairRisk,
    sentimentSummary: sentiment,
    latestArticleAt: latestArticleAt(articles),
    error: undefined
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
