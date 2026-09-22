import { alphaVantageNewsService, AlphaVantageArticle } from './alphaVantageNewsService';
import { marketauxNewsService, MarketauxArticle } from './marketauxNewsService';

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

export type LiveNewsSource = 'FOREX_FACTORY' | 'ALPHA_VANTAGE' | 'MARKETAUX' | 'GDELT_DOC_2' | 'GOOGLE_NEWS_RSS' | 'NONE';
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
    ALPHA_VANTAGE?: LiveNewsProviderStatus;
    MARKETAUX?: LiveNewsProviderStatus;
    GDELT_DOC_2: LiveNewsProviderStatus;
    GOOGLE_NEWS_RSS: LiveNewsProviderStatus;
    FOREX_FACTORY: LiveNewsProviderStatus;
  };
  providerDiagnostics?: {
    ALPHA_VANTAGE: LiveNewsProviderDiagnostic;
    MARKETAUX: LiveNewsProviderDiagnostic;
    GDELT_DOC_2: LiveNewsProviderDiagnostic;
    GOOGLE_NEWS_RSS: LiveNewsProviderDiagnostic;
    FOREX_FACTORY: LiveNewsProviderDiagnostic;
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

const GDELT_ENDPOINT = process.env.GOLDCREST_GDELT_DOC_URL
  || 'https://api.gdeltproject.org/api/v2/doc/doc';

const GOOGLE_NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';
const FOREX_FACTORY_NEWS_ENDPOINT = process.env.GOLDCREST_FOREX_FACTORY_NEWS_URL
  || 'https://www.forexfactory.com/news';

const MACRO_NEWS_QUERY = [
  '"Federal Reserve"', 'FOMC', 'ECB', '"Bank of Japan"', 'BOJ',
  '"interest rate"', '"rate decision"', 'CPI', 'inflation', 'NFP',
  '"nonfarm payroll"', 'jobs report', 'tariff', 'sanctions', 'intervention',
  'war', 'conflict', 'emergency', '"central bank"', 'gold', '"precious metals"'
];

const HIGH_IMPACT_EVENT_PATTERNS: RegExp[] = [
  /\bfomc\b.*\b(rate decision|statement|minutes|rate|raises?|cuts?|hikes?|holds?)\b/i,
  /\bfederal reserve\b.*\b(rate|decision|meeting|cut|hike|hold)\b/i,
  /\b(rate decision|rate hike|rate cut|rate hold|interest rate decision)\b/i,
  /\b(cpi|consumer price index)\b.*\b(data|report|release|reading|print|rises?|falls?|beats?|misses?)\b/i,
  /\binflation (data|report|release|reading)\b/i,
  /\b(non[- ]?farm payrolls?|nfp|jobs report|employment report)\b.*\b(data|report|release|print|beats?|misses?|rises?|falls?)\b/i,
  /\b(ecb|european central bank|boe|bank of england|boj|bank of japan|rba|reserve bank of australia|rbnz|reserve bank of new zealand|bank of canada|boc|snb|swiss national bank)\b.*\b(rate|decision|meeting|cut|hike|hold|policy)\b/i,
  /\b(new|unexpected|surprise) tariffs?\b/i,
  /\bsanctions? (announced|imposed|expanded|eased)\b/i,
  /\b(currency|fx) intervention\b/i,
  /\b(emergency|unscheduled) (rate|central bank|policy)\b/i
];

const GLOBAL_HIGH_IMPACT_PATTERNS: RegExp[] = [
  /\bwar (breaks out|declared|erupts)\b/i,
  /\binvasion\b/i,
  /\bmilitary (attack|strike|conflict)\b/i,
  /\bmarket (halt|closure|circuit breaker)\b/i
];

const NEWS_HIGH_IMPACT_ACTIVE_WINDOW_MS = Math.max(
  5 * 60_000,
  Number(process.env.GOLDCREST_NEWS_HIGH_IMPACT_ACTIVE_WINDOW_MS || 45 * 60_000)
);

const CURRENCY_NEWS_ALIASES: Record<string, string[]> = {
  USD: ['usd', 'u.s. dollar', 'us dollar', 'federal reserve', 'fed', 'fomc', 'united states', 'u.s.'],
  EUR: ['eur', 'euro', 'eurozone', 'european central bank', 'ecb'],
  GBP: ['gbp', 'pound', 'sterling', 'bank of england', 'boe', 'united kingdom', 'uk'],
  JPY: ['jpy', 'yen', 'bank of japan', 'boj', 'japan'],
  CHF: ['chf', 'franc', 'swiss national bank', 'snb', 'switzerland'],
  AUD: ['aud', 'australian dollar', 'reserve bank of australia', 'rba', 'australia'],
  NZD: ['nzd', 'new zealand dollar', 'reserve bank of new zealand', 'rbnz', 'new zealand'],
  CAD: ['cad', 'canadian dollar', 'bank of canada', 'boc', 'canada'],
  XAU: ['xau', 'gold', 'gold prices', 'precious metals']
};

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
  3_000,
  Number(process.env.GOLDCREST_NEWS_TIMEOUT_MS || 8_000)
);
const GDELT_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_GDELT_TIMEOUT_MS || 12_000)
);
const GDELT_MIN_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_GDELT_MIN_INTERVAL_MS || 30_000)
);
const GOOGLE_NEWS_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_GOOGLE_TIMEOUT_MS || 8_000)
);
const FOREX_FACTORY_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GOLDCREST_NEWS_FOREX_FACTORY_TIMEOUT_MS || 8_000)
);
const MAX_ARTICLE_AGE_MS = Math.max(
  15 * 60_000,
  Number(process.env.GOLDCREST_NEWS_MAX_ARTICLE_AGE_MS || 24 * 60 * 60_000)
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

let gdeltNextAllowedAt = 0;

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

function buildNewsQuery(pairs: string[]): string {
  const terms = new Set<string>(MACRO_NEWS_QUERY);

  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    for (const currency of [base, quote]) {
      if (!currency) continue;
      terms.add(currency);
      const aliases = CURRENCY_NEWS_ALIASES[currency] || [];
      aliases.forEach(alias => terms.add(alias));
    }
  }

  return `(${[...terms]
    .map(term => term.includes(' ') ? `"${term}"` : term)
    .join(' OR ')})`;
}

function buildGdeltQuery(): string {
  // GDELT is the slowest and most rate-limited provider. Keep its query
  // deliberately small and stable; pair relevance is enforced after
  // retrieval by the Goldcrest classifier. This avoids expensive broad
  // currency-alias searches that can time out.
  return `(${MACRO_NEWS_QUERY
    .map(term => term.includes(' ') ? term : term)
    .join(' OR ')})`;
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
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return items
    .map(item => ({
      title: readXmlTag(item, 'title'),
      url: readXmlTag(item, 'link'),
      source: readXmlTag(item, 'source') || 'Google News',
      publishedAt: normalizePublishedAt(readXmlTag(item, 'pubDate'))
    }))
    .filter(article => Boolean(article.title && article.url));
}

function stripHtml(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<script\\b[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style\\b[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
  );
}

function parseRelativeAge(value: string, now: number): string | null {
  const text = value.toLowerCase();
  if (/\\bjust now\\b|\\ba few seconds? ago\\b/.test(text)) {
    return new Date(now).toISOString();
  }

  const match = text.match(/\\b(\\d+)\\s*(second|sec|minute|min|hour|hr|day|d)s?\\s+ago\\b/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = match[2];
  const multiplier = unit.startsWith('second') || unit === 'sec'
    ? 1_000
    : unit.startsWith('minute') || unit === 'min'
      ? 60_000
      : unit.startsWith('hour') || unit === 'hr'
        ? 60 * 60_000
        : 24 * 60 * 60_000;

  return new Date(now - amount * multiplier).toISOString();
}

function parseForexFactoryNews(html: string, now: number): LiveNewsArticle[] {
  const articles: LiveNewsArticle[] = [];
  const seenUrls = new Set<string>();
  const anchorPattern = /<a\\b[^>]*href=["'](https?:\\/\\/www\\.forexfactory\\.com)?(\\/news\\/\\d+[^"']*)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const path = match[2];
    const url = `https://www.forexfactory.com${path}`;
    if (seenUrls.has(url)) continue;

    const title = stripHtml(match[3]);
    if (!title || title.length < 8) continue;

    const start = match.index;
    const context = html.slice(start, Math.min(html.length, start + 2200));
    const contextText = stripHtml(context);

    const publishedAt = parseRelativeAge(contextText, now)
      || normalizePublishedAt(contextText.match(/\\b(20\\d{2}[-/]\\d{1,2}[-/]\\d{1,2}[ T]\\d{1,2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:?\\d{2})?)\\b/)?.[1] || '');

    const sourceMatch = contextText.match(/\\b(?:From|from)\\s+([^|]+?)\\s*\\|/);
    const handleMatch = contextText.match(/\\b(?:From|from)\\s+(@[A-Za-z0-9_.-]+)/);
    const source = (sourceMatch?.[1] || handleMatch?.[1] || 'Forex Factory').trim();

    const titleIndex = contextText.toLowerCase().indexOf(title.toLowerCase());
    const summary = titleIndex >= 0
      ? contextText.slice(titleIndex + title.length).split(/\\b(?:Top Comments|Comments)\\b/i)[0].trim().slice(0, 1200)
      : undefined;

    seenUrls.add(url);
    articles.push({
      title,
      url,
      source,
      publishedAt,
      summary
    });
  }

  return articles;
}

async function fetchFromForexFactory(): Promise<{ status: LiveNewsProviderStatus; articles: LiveNewsArticle[]; error?: string; latencyMs?: number }> {
  const startedAt = Date.now();
  try {
    const url = new URL(FOREX_FACTORY_NEWS_ENDPOINT);
    const html = await fetchText(url, FOREX_FACTORY_TIMEOUT_MS);
    const articles = parseForexFactoryNews(html, Date.now());

    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(error),
      latencyMs: Date.now() - startedAt
    };
  }
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
      .replace(/\/$/, '');

    const key = `${titleKey}|${urlKey}`;
    if (!byKey.has(key)) byKey.set(key, article);
  }

  return [...byKey.values()];
}

async function fetchText(url: URL, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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

async function fetchFromGdelt(query: string): Promise<{ status: LiveNewsProviderStatus; articles: LiveNewsArticle[]; error?: string; latencyMs?: number }> {
  const now = Date.now();
  if (now < gdeltNextAllowedAt) {
    return {
      status: 'RATE_LIMITED',
      articles: [],
      error: `GDELT provider backoff is active until ${new Date(gdeltNextAllowedAt).toISOString()}.`
    };
  }

  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', process.env.GOLDCREST_NEWS_TIMESPAN || '24h');
  const configuredMaxRecords = Number(process.env.GOLDCREST_NEWS_MAX_RECORDS || 50);
  url.searchParams.set('maxrecords', String(Math.min(75, Math.max(1, Number.isFinite(configuredMaxRecords) ? configuredMaxRecords : 50))));
  url.searchParams.set('sort', 'datedesc');

  const startedAt = Date.now();
  try {
    const text = await fetchText(url, GDELT_TIMEOUT_MS);
    let payload: any;

    try {
      payload = JSON.parse(text);
    } catch {
      const notice = text.replace(/\s+/g, ' ').trim().slice(0, 220);
      const lower = notice.toLowerCase();
      const rateLimited = lower.includes('please limit requests')
        || lower.includes('one every 5 seconds')
        || lower.includes('rate limit')
        || lower.includes('too many requests');
      if (rateLimited) {
        gdeltNextAllowedAt = Date.now() + GDELT_MIN_INTERVAL_MS;
        return {
          status: 'RATE_LIMITED',
          articles: [],
          error: `GDELT rate limited the request: ${notice || 'provider returned a non-JSON throttle response.'}`,
          latencyMs: Date.now() - startedAt
        };
      }
      return {
        status: 'ERROR',
        articles: [],
        error: `GDELT returned a non-JSON response: ${notice || 'empty response'}`,
        latencyMs: Date.now() - startedAt
      };
    }

    const articles = parseGdeltArticles(payload);
    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(error),
      latencyMs: Date.now() - startedAt
    };
  }
}

async function fetchFromGoogleNewsRss(query: string): Promise<{ status: LiveNewsProviderStatus; articles: LiveNewsArticle[]; error?: string; latencyMs?: number }> {
  const url = new URL(GOOGLE_NEWS_RSS_ENDPOINT);
  url.searchParams.set('q', `${query} when:24h`);
  url.searchParams.set('hl', process.env.GOLDCREST_NEWS_LANGUAGE || 'en-US');
  url.searchParams.set('gl', process.env.GOLDCREST_NEWS_COUNTRY || 'US');
  url.searchParams.set('ceid', `${process.env.GOLDCREST_NEWS_COUNTRY || 'US'}:${(process.env.GOLDCREST_NEWS_LANGUAGE || 'en').split('-')[0]}`);

  const startedAt = Date.now();
  try {
    const xml = await fetchText(url, GOOGLE_NEWS_TIMEOUT_MS);
    const articles = parseGoogleNewsRss(xml);
    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(error),
      latencyMs: Date.now() - startedAt
    };
  }
}

async function fetchFromMarketaux(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
}> {
  if (!marketauxNewsService.isConfigured()) {
    return { status: 'UNCONFIGURED', articles: [] };
  }
  try {
    const res = await marketauxNewsService.fetchForexNews(pairs.length > 0 ? pairs : undefined);
    if (res.status === 'RATE_LIMITED') {
      const articles: LiveNewsArticle[] = res.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        summary: a.summary,
        bannerImage: a.bannerImage,
        sentimentScore: a.sentimentScore,
        sentimentLabel: a.sentimentLabel,
        topics: a.keywords
      }));
      return { status: 'RATE_LIMITED', articles, error: res.error };
    }
    if (res.status === 'ERROR') {
      return { status: 'ERROR', articles: [], error: res.error };
    }
    const articles: LiveNewsArticle[] = res.articles.map(a => ({
      title: a.title,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt,
      summary: a.summary,
      bannerImage: a.bannerImage,
      sentimentScore: a.sentimentScore,
      sentimentLabel: a.sentimentLabel,
      topics: a.keywords
    }));
    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles
    };
  } catch (err: any) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(err)
    };
  }
}

async function fetchFromAlphaVantage(pairs: string[]): Promise<{
  status: LiveNewsProviderStatus;
  articles: LiveNewsArticle[];
  error?: string;
}> {
  if (!alphaVantageNewsService.isConfigured()) {
    return { status: 'UNCONFIGURED', articles: [] };
  }
  try {
    const res = await alphaVantageNewsService.fetchForexNews(pairs.length > 0 ? pairs : undefined);
    if (res.status === 'RATE_LIMITED') {
      const articles: LiveNewsArticle[] = res.articles.map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        summary: a.summary,
        bannerImage: a.bannerImage,
        sentimentScore: a.sentimentScore,
        sentimentLabel: a.sentimentLabel,
        topics: a.topics
      }));
      return { status: 'RATE_LIMITED', articles, error: res.error };
    }
    if (res.status === 'ERROR') {
      return { status: 'ERROR', articles: [], error: res.error };
    }
    const articles: LiveNewsArticle[] = res.articles.map(a => ({
      title: a.title,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt,
      summary: a.summary,
      bannerImage: a.bannerImage,
      sentimentScore: a.sentimentScore,
      sentimentLabel: a.sentimentLabel,
      topics: a.topics
    }));
    return {
      status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
      articles
    };
  } catch (err: any) {
    return {
      status: 'ERROR',
      articles: [],
      error: asErrorMessage(err)
    };
  }
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

  const newsQuery = buildNewsQuery(queryPairs);
  const gdeltQuery = buildGdeltQuery();

  const [forexFactoryRes, gdeltRes, googleRes, avRes, marketauxRes] = await Promise.all([
    fetchFromForexFactory(),
    fetchFromGdelt(gdeltQuery),
    fetchFromGoogleNewsRss(newsQuery),
    fetchFromAlphaVantage(queryPairs),
    fetchFromMarketaux(queryPairs)
  ]);

  const freshForexFactory = filterFreshArticles(forexFactoryRes.articles, now);
  const freshGdelt = filterFreshArticles(gdeltRes.articles, now);
  const freshGoogle = filterFreshArticles(googleRes.articles, now);
  const freshAv = filterFreshArticles(avRes.articles, now);
  const freshMarketaux = filterFreshArticles(marketauxRes.articles, now);

  const providerStatus: LiveNewsSnapshot['providerStatus'] = {
    FOREX_FACTORY: providerEffectiveStatus(forexFactoryRes.status, forexFactoryRes.articles.length, freshForexFactory.length),
    ALPHA_VANTAGE: providerEffectiveStatus(avRes.status, avRes.articles.length, freshAv.length),
    MARKETAUX: providerEffectiveStatus(marketauxRes.status, marketauxRes.articles.length, freshMarketaux.length),
    GDELT_DOC_2: providerEffectiveStatus(gdeltRes.status, gdeltRes.articles.length, freshGdelt.length),
    GOOGLE_NEWS_RSS: providerEffectiveStatus(googleRes.status, googleRes.articles.length, freshGoogle.length)
  };

  const errors = [forexFactoryRes.error, gdeltRes.error, googleRes.error, avRes.error, marketauxRes.error]
    .filter(Boolean) as string[];

  const providerDiagnostics: LiveNewsSnapshot['providerDiagnostics'] = {
    FOREX_FACTORY: {
      status: providerStatus.FOREX_FACTORY || 'ERROR',
      rawArticleCount: forexFactoryRes.articles.length,
      freshArticleCount: freshForexFactory.length,
      staleArticleCount: Math.max(0, forexFactoryRes.articles.length - freshForexFactory.length),
      configured: true,
      latencyMs: forexFactoryRes.latencyMs,
      latestRawArticleAt: latestArticleAt(forexFactoryRes.articles),
      latestFreshArticleAt: latestArticleAt(freshForexFactory),
      error: forexFactoryRes.error
    },
    ALPHA_VANTAGE: {
      status: providerStatus.ALPHA_VANTAGE || 'UNCONFIGURED',
      rawArticleCount: avRes.articles.length,
      freshArticleCount: freshAv.length,
      staleArticleCount: Math.max(0, avRes.articles.length - freshAv.length),
      configured: alphaVantageNewsService.isConfigured(),
      latencyMs: avRes.latencyMs,
      latestRawArticleAt: latestArticleAt(avRes.articles),
      latestFreshArticleAt: latestArticleAt(freshAv),
      error: avRes.error
    },
    MARKETAUX: {
      status: providerStatus.MARKETAUX || 'UNCONFIGURED',
      rawArticleCount: marketauxRes.articles.length,
      freshArticleCount: freshMarketaux.length,
      staleArticleCount: Math.max(0, marketauxRes.articles.length - freshMarketaux.length),
      configured: marketauxNewsService.isConfigured(),
      latencyMs: marketauxRes.latencyMs,
      latestRawArticleAt: latestArticleAt(marketauxRes.articles),
      latestFreshArticleAt: latestArticleAt(freshMarketaux),
      error: marketauxRes.error
    },
    GDELT_DOC_2: {
      status: providerStatus.GDELT_DOC_2,
      rawArticleCount: gdeltRes.articles.length,
      freshArticleCount: freshGdelt.length,
      staleArticleCount: Math.max(0, gdeltRes.articles.length - freshGdelt.length),
      configured: true,
      latencyMs: gdeltRes.latencyMs,
      latestRawArticleAt: latestArticleAt(gdeltRes.articles),
      latestFreshArticleAt: latestArticleAt(freshGdelt),
      error: gdeltRes.error
    },
    GOOGLE_NEWS_RSS: {
      status: providerStatus.GOOGLE_NEWS_RSS,
      rawArticleCount: googleRes.articles.length,
      freshArticleCount: freshGoogle.length,
      staleArticleCount: Math.max(0, googleRes.articles.length - freshGoogle.length),
      configured: true,
      latencyMs: googleRes.latencyMs,
      latestRawArticleAt: latestArticleAt(googleRes.articles),
      latestFreshArticleAt: latestArticleAt(freshGoogle),
      error: googleRes.error
    }
  };

  // Prioritize sentiment providers (Alpha Vantage, Marketaux), then broad aggregators
  const fetchedArticles = [...freshForexFactory, ...freshAv, ...freshMarketaux, ...freshGdelt, ...freshGoogle];
  const articles = deduplicateArticles(fetchedArticles).slice(0, 35);

  if (articles.length === 0) {
    const activeProviders = [forexFactoryRes, gdeltRes, googleRes];
    if (avRes.status !== 'UNCONFIGURED') activeProviders.push(avRes);
    if (marketauxRes.status !== 'UNCONFIGURED') activeProviders.push(marketauxRes);
    const allUnavailable = activeProviders.length > 0
      && activeProviders.every(result => ['ERROR', 'RATE_LIMITED'].includes(result.status));
    const hasRawArticles = activeProviders.some(result => result.articles.length > 0);

    const snapshot: LiveNewsSnapshot = allUnavailable
      ? unavailableSnapshot(
          errors.join(' | ') || 'All live news providers failed.',
          queryPairs,
          providerStatus
        )
      : {
          source: 'NONE',
          fetchedAt: new Date().toISOString(),
          status: hasRawArticles ? 'STALE' : 'NO_RESULTS',
          articleCount: 0,
          highImpactCount: 0,
          elevatedCount: 0,
          activeHighImpactCount: 0,
          riskLevel: 'LOW',
          articles: [],
          queryPairs,
          providerStatus,
          providerDiagnostics,
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

  const score = scoreArticles(articles, queryPairs, now);
  const latestArticleAt = articles[0]?.publishedAt || null;
  const sentimentSummary = computeAggregatedSentiment(articles);

  const source: LiveNewsSource = freshForexFactory.length > 0
    ? 'FOREX_FACTORY'
    : freshAv.length > 0
    ? 'ALPHA_VANTAGE'
    : freshMarketaux.length > 0
      ? 'MARKETAUX'
      : freshGdelt.length > 0
        ? 'GDELT_DOC_2'
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
    sentimentSummary,
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
  gdeltNextAllowedAt = 0;
}
