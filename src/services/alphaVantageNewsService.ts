/**
 * Alpha Vantage News & Sentiment Service
 *
 * Provides real-time financial market news, macroeconomic developments, and
 * algorithmic sentiment scoring via Alpha Vantage's NEWS_SENTIMENT API.
 * Includes in-memory caching with rate-limit backoff, multi-ticker/topic normalization,
 * and seamless fallback for automated execution and operator analytics.
 */

import fs from 'fs';
import path from 'path';

export interface AlphaVantageRawArticle {
  title: string;
  url: string;
  time_published: string;
  authors?: string[];
  summary?: string;
  banner_image?: string | null;
  source?: string;
  category_within_source?: string;
  source_domain?: string;
  topics?: Array<{
    topic: string;
    relevance_score: string;
  }>;
  overall_sentiment_score?: number;
  overall_sentiment_label?: string;
  ticker_sentiment?: Array<{
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: string;
  }>;
}

export interface AlphaVantageRawResponse {
  items?: string;
  sentiment_score_definition?: string;
  relevance_score_definition?: string;
  feed?: AlphaVantageRawArticle[];
  Note?: string;
  Information?: string;
  'Error Message'?: string;
}

export interface AlphaVantageArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  bannerImage: string | null;
  sentimentScore: number;
  sentimentLabel: string;
  topics: string[];
  tickerSentiment: Array<{
    ticker: string;
    relevanceScore: number;
    sentimentScore: number;
    sentimentLabel: string;
  }>;
  impactLevel: 'HIGH' | 'ELEVATED' | 'LOW';
}

export interface AlphaVantageNewsOptions {
  tickers?: string | string[];
  topics?: string | string[];
  timeFrom?: string; // YYYYMMDDTHHMM
  timeTo?: string;   // YYYYMMDDTHHMM
  sort?: 'LATEST' | 'EARLIEST' | 'RELEVANCE';
  limit?: number;
  forceRefresh?: boolean;
}

export interface AlphaVantageSentimentSummary {
  averageScore: number;
  overallLabel: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

export interface AlphaVantageNewsSnapshot {
  status: 'LIVE' | 'NO_RESULTS' | 'RATE_LIMITED' | 'UNCONFIGURED' | 'ERROR';
  source: 'ALPHA_VANTAGE';
  fetchedAt: string;
  articleCount: number;
  articles: AlphaVantageArticle[];
  sentimentSummary: AlphaVantageSentimentSummary;
  highImpactCount: number;
  elevatedCount: number;
  riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' | 'UNAVAILABLE';
  error?: string;
  rateLimited?: boolean;
}

const DEFAULT_BASE_URL = 'https://www.alphavantage.co/query';
const DEFAULT_TIMEOUT_MS = 9_000;
const CACHE_TTL_MS = 120_000; // 2 minutes cache to stay well within free/standard tier limits
const RATE_LIMIT_BACKOFF_MS = 60_000; // 1 minute backoff when API call frequency is exceeded

// Standard financial topics recognized by Alpha Vantage NEWS_SENTIMENT
export const ALPHA_VANTAGE_TOPICS = [
  'financial_markets',
  'economy_macro',
  'economy_monetary',
  'economy_fiscal',
  'finance',
  'technology',
  'energy_transportation',
  'manufacturing',
  'real_estate',
  'blockchain'
] as const;

const HIGH_IMPACT_KEYWORDS = [
  'fomc', 'federal reserve', 'rate decision', 'interest rate', 'rate hike',
  'rate cut', 'cpi', 'inflation', 'nonfarm payroll', 'nfp', 'jobs report',
  'tariff', 'sanctions', 'intervention', 'emergency', 'bank of japan',
  'boj', 'ecb', 'war', 'escalation', 'geopolitical'
];

const ELEVATED_KEYWORDS = [
  'central bank', 'pmi', 'gdp', 'retail sales', 'employment', 'treasury',
  'yield', 'dollar', 'euro', 'pound', 'yen', 'recession', 'debt ceiling'
];

export class AlphaVantageNewsService {
  private cache: Map<string, { snapshot: AlphaVantageNewsSnapshot; expiresAt: number }> = new Map();
  private inFlight: Map<string, Promise<AlphaVantageNewsSnapshot>> = new Map();
  private rateLimitedUntil = 0;

  /**
   * Lazily checks whether an Alpha Vantage API key is configured.
   */
  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 0);
  }

  /**
   * Gets the API key from environment variables or .env/.env.example.
   */
  public getApiKey(): string | null {
    if (process.env.ALPHA_VANTAGE_API_KEY?.trim()) {
      return process.env.ALPHA_VANTAGE_API_KEY.trim();
    }
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^ALPHA_VANTAGE_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]?.trim()) return match[1].trim();
      }
      const envExPath = path.join(process.cwd(), '.env.example');
      if (fs.existsSync(envExPath)) {
        const content = fs.readFileSync(envExPath, 'utf8');
        const match = content.match(/^ALPHA_VANTAGE_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]?.trim()) return match[1].trim();
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Converts a date or date string into Alpha Vantage's time format (YYYYMMDDTHHMM).
   */
  public formatTime(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const h = pad(d.getUTCHours());
    const min = pad(d.getUTCMinutes());
    return `${y}${m}${day}T${h}${min}`;
  }

  /**
   * Normalizes Alpha Vantage published timestamp (e.g. '20260920T211844') into standard ISO 8601 string.
   */
  public parsePublishedAt(raw: string | undefined): string | null {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      const iso = `${y}-${m}-${d}T${h}:${min}:${s || '00'}Z`;
      const parsed = Date.parse(iso);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    }
    const standard = Date.parse(trimmed);
    return Number.isFinite(standard) ? new Date(standard).toISOString() : null;
  }

  /**
   * Evaluates macro risk level based on headline text and sentiment score.
   */
  private classifyImpact(
    title: string,
    sentimentScore: number
  ): 'HIGH' | 'ELEVATED' | 'LOW' {
    const lower = title.toLowerCase();

    // Explicit high-impact macro terms
    if (HIGH_IMPACT_KEYWORDS.some(kw => lower.includes(kw))) {
      return 'HIGH';
    }

    // Extreme sentiment spikes (bearish panic or euphoria)
    if (Math.abs(sentimentScore) >= 0.45) {
      return 'HIGH';
    }

    if (ELEVATED_KEYWORDS.some(kw => lower.includes(kw)) || Math.abs(sentimentScore) >= 0.25) {
      return 'ELEVATED';
    }

    return 'LOW';
  }

  /**
   * Computes sentiment summary from a list of normalized articles.
   */
  private computeSentimentSummary(articles: AlphaVantageArticle[]): AlphaVantageSentimentSummary {
    if (articles.length === 0) {
      return {
        averageScore: 0,
        overallLabel: 'Neutral',
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0
      };
    }

    let totalScore = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;

    for (const a of articles) {
      totalScore += a.sentimentScore;
      if (a.sentimentScore >= 0.15 || a.sentimentLabel.toLowerCase().includes('bullish')) {
        bullishCount += 1;
      } else if (a.sentimentScore <= -0.15 || a.sentimentLabel.toLowerCase().includes('bearish')) {
        bearishCount += 1;
      } else {
        neutralCount += 1;
      }
    }

    const averageScore = Number((totalScore / articles.length).toFixed(4));
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

  /**
   * Fetches news and sentiment scores from Alpha Vantage.
   */
  public async fetchNewsSentiment(
    options: AlphaVantageNewsOptions = {}
  ): Promise<AlphaVantageNewsSnapshot> {
    const apiKey = this.getApiKey();
    const now = Date.now();

    // Normalize parameters for query and cache key
    const tickersArr = Array.isArray(options.tickers)
      ? options.tickers
      : typeof options.tickers === 'string'
        ? options.tickers.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    const tickersParam = tickersArr.join(',');

    const topicsArr = Array.isArray(options.topics)
      ? options.topics
      : typeof options.topics === 'string'
        ? options.topics.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    const topicsParam = topicsArr.join(',');

    const limit = Math.max(1, Math.min(1000, Number(options.limit || 50)));
    const sort = options.sort || 'LATEST';
    const timeFrom = options.timeFrom || '';
    const timeTo = options.timeTo || '';

    const cacheKey = `${tickersParam}|${topicsParam}|${sort}|${limit}|${timeFrom}|${timeTo}`;

    // Return cached entry if fresh
    if (!options.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        return cached.snapshot;
      }
    }

    // Rate-limit backoff guard
    if (!options.forceRefresh && now < this.rateLimitedUntil) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached.snapshot;
      }
      return {
        status: 'RATE_LIMITED',
        source: 'ALPHA_VANTAGE',
        fetchedAt: new Date().toISOString(),
        articleCount: 0,
        articles: [],
        sentimentSummary: { averageScore: 0, overallLabel: 'Neutral', bullishCount: 0, bearishCount: 0, neutralCount: 0 },
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'LOW',
        error: 'Alpha Vantage API call frequency exceeded. Backing off.',
        rateLimited: true
      };
    }

    // Deduplicate in-flight requests
    const running = this.inFlight.get(cacheKey);
    if (running) {
      return running;
    }

    const fetchPromise = this.performFetch({
      apiKey,
      tickers: tickersParam,
      topics: topicsParam,
      limit,
      sort,
      timeFrom,
      timeTo,
      cacheKey
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Internal fetch logic with HTTP timeout and parsing
   */
  private async performFetch(params: {
    apiKey: string | null;
    tickers: string;
    topics: string;
    limit: number;
    sort: string;
    timeFrom: string;
    timeTo: string;
    cacheKey: string;
  }): Promise<AlphaVantageNewsSnapshot> {
    const now = Date.now();
    const fetchedAt = new Date().toISOString();

    // Check if key is present
    if (!params.apiKey) {
      const snapshot: AlphaVantageNewsSnapshot = {
        status: 'UNCONFIGURED',
        source: 'ALPHA_VANTAGE',
        fetchedAt,
        articleCount: 0,
        articles: [],
        sentimentSummary: { averageScore: 0, overallLabel: 'Neutral', bullishCount: 0, bearishCount: 0, neutralCount: 0 },
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'LOW',
        error: 'ALPHA_VANTAGE_API_KEY is not configured in server environment.'
      };
      this.cache.set(params.cacheKey, { snapshot, expiresAt: now + CACHE_TTL_MS });
      return snapshot;
    }

    const url = new URL(process.env.ALPHA_VANTAGE_BASE_URL || DEFAULT_BASE_URL);
    url.searchParams.set('function', 'NEWS_SENTIMENT');
    url.searchParams.set('apikey', params.apiKey);
    if (params.tickers) url.searchParams.set('tickers', params.tickers);
    if (params.topics) url.searchParams.set('topics', params.topics);
    if (params.timeFrom) url.searchParams.set('time_from', params.timeFrom);
    if (params.timeTo) url.searchParams.set('time_to', params.timeTo);
    url.searchParams.set('sort', params.sort);
    url.searchParams.set('limit', String(params.limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Goldcrest/2.0 alpha-vantage-news'
        }
      });

      if (!res.ok) {
        throw new Error(`Alpha Vantage HTTP ${res.status}: ${res.statusText}`);
      }

      const data: AlphaVantageRawResponse = await res.json();

      // Check for Alpha Vantage rate-limiting message
      if (data.Note && data.Note.includes('call frequency')) {
        this.rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
        const cached = this.cache.get(params.cacheKey);
        if (cached && cached.snapshot.articles.length > 0) {
          return {
            ...cached.snapshot,
            status: 'RATE_LIMITED',
            rateLimited: true,
            error: data.Note
          };
        }
        const snapshot: AlphaVantageNewsSnapshot = {
          status: 'RATE_LIMITED',
          source: 'ALPHA_VANTAGE',
          fetchedAt,
          articleCount: 0,
          articles: [],
          sentimentSummary: { averageScore: 0, overallLabel: 'Neutral', bullishCount: 0, bearishCount: 0, neutralCount: 0 },
          highImpactCount: 0,
          elevatedCount: 0,
          riskLevel: 'LOW',
          error: data.Note,
          rateLimited: true
        };
        this.cache.set(params.cacheKey, { snapshot, expiresAt: now + RATE_LIMIT_BACKOFF_MS });
        return snapshot;
      }

      // Check for API Error Message
      if (data['Error Message']) {
        throw new Error(`Alpha Vantage API error: ${data['Error Message']}`);
      }

      // Check for provider Information messages returned alongside API responses
      if (data.Information && (!data.feed || data.feed.length === 0)) {
        const snapshot: AlphaVantageNewsSnapshot = {
          status: 'NO_RESULTS',
          source: 'ALPHA_VANTAGE',
          fetchedAt,
          articleCount: 0,
          articles: [],
          sentimentSummary: { averageScore: 0, overallLabel: 'Neutral', bullishCount: 0, bearishCount: 0, neutralCount: 0 },
          highImpactCount: 0,
          elevatedCount: 0,
          riskLevel: 'LOW',
          error: data.Information
        };
        this.cache.set(params.cacheKey, { snapshot, expiresAt: now + CACHE_TTL_MS });
        return snapshot;
      }

      const feed = Array.isArray(data.feed) ? data.feed : [];
      if (feed.length === 0) {
        const snapshot: AlphaVantageNewsSnapshot = {
          status: 'NO_RESULTS',
          source: 'ALPHA_VANTAGE',
          fetchedAt,
          articleCount: 0,
          articles: [],
          sentimentSummary: { averageScore: 0, overallLabel: 'Neutral', bullishCount: 0, bearishCount: 0, neutralCount: 0 },
          highImpactCount: 0,
          elevatedCount: 0,
          riskLevel: 'LOW'
        };
        this.cache.set(params.cacheKey, { snapshot, expiresAt: now + CACHE_TTL_MS });
        return snapshot;
      }

      // Normalize feed articles
      const articles: AlphaVantageArticle[] = feed
        .filter(item => Boolean(item.title && item.url))
        .map(item => {
          const sentimentScore = typeof item.overall_sentiment_score === 'number'
            ? item.overall_sentiment_score
            : Number(item.overall_sentiment_score || 0);

          const sentimentLabel = item.overall_sentiment_label || 'Neutral';
          const impactLevel = this.classifyImpact(item.title, sentimentScore);

          const topics = Array.isArray(item.topics)
            ? item.topics.map(t => t.topic).filter(Boolean)
            : [];

          const tickerSentiment = Array.isArray(item.ticker_sentiment)
            ? item.ticker_sentiment.map(ts => ({
                ticker: ts.ticker,
                relevanceScore: Number(ts.relevance_score || 0),
                sentimentScore: Number(ts.ticker_sentiment_score || 0),
                sentimentLabel: ts.ticker_sentiment_label || 'Neutral'
              }))
            : [];

          return {
            title: item.title.trim(),
            url: item.url.trim(),
            source: item.source || item.source_domain || 'Alpha Vantage',
            publishedAt: this.parsePublishedAt(item.time_published),
            summary: item.summary?.trim() || '',
            bannerImage: item.banner_image || null,
            sentimentScore,
            sentimentLabel,
            topics,
            tickerSentiment,
            impactLevel
          };
        });

      const sentimentSummary = this.computeSentimentSummary(articles);
      const highImpactCount = articles.filter(a => a.impactLevel === 'HIGH').length;
      const elevatedCount = articles.filter(a => a.impactLevel === 'ELEVATED').length;

      const riskLevel: AlphaVantageNewsSnapshot['riskLevel'] = highImpactCount > 0
        ? 'HIGH'
        : elevatedCount >= 4 || sentimentSummary.averageScore <= -0.35
          ? 'ELEVATED'
          : 'LOW';

      const snapshot: AlphaVantageNewsSnapshot = {
        status: 'LIVE',
        source: 'ALPHA_VANTAGE',
        fetchedAt,
        articleCount: articles.length,
        articles,
        sentimentSummary,
        highImpactCount,
        elevatedCount,
        riskLevel
      };

      this.cache.set(params.cacheKey, { snapshot, expiresAt: now + CACHE_TTL_MS });
      return snapshot;
    } catch (err: any) {
      const message = err.name === 'AbortError'
        ? 'Alpha Vantage news request timed out.'
        : err.message || String(err);

      // If cached data is available, return it with error annotation
      const cached = this.cache.get(params.cacheKey);
      if (cached) {
        return {
          ...cached.snapshot,
          error: message
        };
      }

      return {
        status: 'ERROR',
        source: 'ALPHA_VANTAGE',
        fetchedAt,
        articleCount: 0,
        articles: [],
        sentimentSummary: { averageScore: 0, overallLabel: 'Neutral', bullishCount: 0, bearishCount: 0, neutralCount: 0 },
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'UNAVAILABLE',
        error: message
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetches Forex-specific news by converting currency pairs into relevant macroeconomic
   * topics and financial market themes.
   */
  public async fetchForexNews(
    _pairs: string[] = ['EUR/USD', 'GBP/USD', 'USD/JPY'],
    options: Omit<AlphaVantageNewsOptions, 'tickers' | 'topics'> = {}
  ): Promise<AlphaVantageNewsSnapshot> {
    // High relevance macroeconomic & monetary topics for global currency markets
    const topics = ['economy_monetary', 'economy_macro', 'financial_markets'];

    return this.fetchNewsSentiment({
      ...options,
      topics
    });
  }

  /**
   * Fetches general financial markets & macroeconomic news.
   */
  public async fetchMarketNews(
    options: AlphaVantageNewsOptions = {}
  ): Promise<AlphaVantageNewsSnapshot> {
    return this.fetchNewsSentiment({
      topics: options.topics || ['financial_markets', 'economy_macro'],
      ...options
    });
  }

  /**
   * Clears internal cache (useful for testing or manual operator resets).
   */
  public clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.rateLimitedUntil = 0;
  }
}

// Singleton export
export const alphaVantageNewsService = new AlphaVantageNewsService();
