/**
 * Marketaux News & Sentiment Service
 *
 * Provides real-time financial market news, entity-level sentiment analytics,
 * and macroeconomic intelligence via Marketaux API (https://www.marketaux.com).
 * Includes in-memory caching with rate-limit backoff, multi-symbol/keyword normalization,
 * and seamless fallback for automated execution and operator analytics.
 */

import fs from 'fs';
import path from 'path';

export interface MarketauxEntity {
  symbol: string;
  name?: string;
  exchange?: string;
  exchange_long?: string;
  country?: string;
  type?: string;
  industry?: string;
  match_score?: number;
  sentiment_score?: number; // -1 to 1
  highlights?: Array<{
    highlight: string;
    sentiment: number;
    highlighted_in: string;
  }>;
}

export interface MarketauxRawArticle {
  uuid: string;
  title: string;
  description?: string;
  snippet?: string;
  url: string;
  image_url?: string | null;
  language?: string;
  published_at?: string;
  source?: string;
  keywords?: string[] | null;
  entities?: MarketauxEntity[];
  similar?: any[];
}

export interface MarketauxRawResponse {
  meta?: {
    found: number;
    returned: number;
    limit: number;
    page: number;
  };
  data?: MarketauxRawArticle[];
  error?: {
    code: string;
    message: string;
  };
  message?: string;
}

export interface MarketauxArticle {
  uuid: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  bannerImage: string | null;
  sentimentScore: number;
  sentimentLabel: string;
  keywords: string[];
  entities: Array<{
    symbol: string;
    name: string;
    sentimentScore: number;
    matchScore: number;
  }>;
  impactLevel: 'HIGH' | 'ELEVATED' | 'LOW';
}

export interface MarketauxNewsOptions {
  symbols?: string | string[];
  search?: string;
  countries?: string | string[];
  publishedAfter?: string; // ISO 8601
  publishedBefore?: string; // ISO 8601
  sentimentGte?: number;
  sentimentLte?: number;
  mustHaveEntities?: boolean;
  groupSimilar?: boolean;
  limit?: number;
  page?: number;
  forceRefresh?: boolean;
}

export interface MarketauxSentimentSummary {
  averageScore: number;
  overallLabel: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

export interface MarketauxNewsSnapshot {
  status: 'LIVE' | 'NO_RESULTS' | 'RATE_LIMITED' | 'UNCONFIGURED' | 'ERROR';
  source: 'MARKETAUX';
  fetchedAt: string;
  articleCount: number;
  articles: MarketauxArticle[];
  sentimentSummary: MarketauxSentimentSummary;
  highImpactCount: number;
  elevatedCount: number;
  riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' | 'UNAVAILABLE';
  error?: string;
  rateLimited?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.marketaux.com/v1/news/all';
const DEFAULT_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 120_000; // 2 minutes cache
const RATE_LIMIT_BACKOFF_MS = 60_000; // 1 minute backoff when rate limited

// High impact keywords for macroeconomic classification
const HIGH_IMPACT_KEYWORDS = [
  'fomc', 'federal reserve', 'rate decision', 'interest rate', 'rate hike',
  'rate cut', 'rate hold', 'cpi', 'inflation', 'nonfarm payroll',
  'nfp', 'jobs report', 'tariff', 'sanction', 'intervention',
  'war', 'conflict', 'emergency', 'bank of japan', 'boj', 'ecb'
];

const ELEVATED_KEYWORDS = [
  'central bank', 'pmi', 'retail sales', 'gdp', 'employment', 'yield',
  'treasury', 'dollar', 'euro', 'pound', 'yen', 'franc', 'forex', 'currency'
];

export class MarketauxNewsService {
  private cache = new Map<string, { snapshot: MarketauxNewsSnapshot; expiresAt: number }>();
  private inFlight = new Map<string, Promise<MarketauxNewsSnapshot>>();
  private rateLimitedUntil = 0;

  /**
   * Gets the API key from environment variables or .env / .env.example fallback.
   */
  public getApiKey(): string | null {
    if (process.env.MARKETAUX_API_KEY?.trim()) {
      return process.env.MARKETAUX_API_KEY.trim();
    }
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^MARKETAUX_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]?.trim()) return match[1].trim();
      }
      const envExPath = path.join(process.cwd(), '.env.example');
      if (fs.existsSync(envExPath)) {
        const content = fs.readFileSync(envExPath, 'utf8');
        const match = content.match(/^MARKETAUX_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]?.trim()) return match[1].trim();
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Checks if Marketaux is configured with a non-empty API key.
   */
  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.length >= 8);
  }

  /**
   * Gets the base URL for Marketaux API.
   */
  public getBaseUrl(): string {
    return process.env.MARKETAUX_BASE_URL?.trim() || DEFAULT_BASE_URL;
  }

  /**
   * Clears internal cache.
   */
  public clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.rateLimitedUntil = 0;
  }

  /**
   * Normalizes ISO date string.
   */
  public parsePublishedAt(raw?: string): string | null {
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  /**
   * Evaluates article sentiment score and label from Marketaux entities or text analysis.
   */
  public evaluateArticleSentiment(
    article: MarketauxRawArticle
  ): { score: number; label: string } {
    const entities = Array.isArray(article.entities) ? article.entities : [];
    const validScores = entities
      .map(e => (typeof e.sentiment_score === 'number' ? e.sentiment_score : null))
      .filter((s): s is number => s !== null);

    let score = 0;
    if (validScores.length > 0) {
      score = Number((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(4));
    }

    let label = 'Neutral';
    if (score >= 0.35) label = 'Bullish';
    else if (score >= 0.15) label = 'Somewhat-Bullish';
    else if (score <= -0.35) label = 'Bearish';
    else if (score <= -0.15) label = 'Somewhat-Bearish';

    return { score, label };
  }

  /**
   * Classifies macroeconomic and volatility impact level of an article.
   */
  public classifyImpact(
    title: string,
    summary: string,
    sentimentScore: number
  ): 'HIGH' | 'ELEVATED' | 'LOW' {
    const text = `${title} ${summary}`.toLowerCase();

    if (Math.abs(sentimentScore) >= 0.45) return 'HIGH';
    if (HIGH_IMPACT_KEYWORDS.some(kw => text.includes(kw))) return 'HIGH';
    if (Math.abs(sentimentScore) >= 0.25) return 'ELEVATED';
    if (ELEVATED_KEYWORDS.some(kw => text.includes(kw))) return 'ELEVATED';

    return 'LOW';
  }

  /**
   * Calculates aggregated sentiment metrics for a list of articles.
   */
  public calculateSentimentSummary(
    articles: MarketauxArticle[]
  ): MarketauxSentimentSummary {
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
      if (a.sentimentScore >= 0.15 || a.sentimentLabel.includes('Bullish')) {
        bullishCount += 1;
      } else if (a.sentimentScore <= -0.15 || a.sentimentLabel.includes('Bearish')) {
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
   * Fetches news and sentiment from Marketaux API.
   */
  public async fetchNewsSentiment(
    options: MarketauxNewsOptions = {}
  ): Promise<MarketauxNewsSnapshot> {
    const now = Date.now();
    const apiKey = this.getApiKey();

    if (!apiKey) {
      return {
        status: 'UNCONFIGURED',
        source: 'MARKETAUX',
        fetchedAt: new Date(now).toISOString(),
        articleCount: 0,
        articles: [],
        sentimentSummary: {
          averageScore: 0,
          overallLabel: 'Neutral',
          bullishCount: 0,
          bearishCount: 0,
          neutralCount: 0
        },
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'UNAVAILABLE',
        error: 'MARKETAUX_API_KEY is not configured in server environment.'
      };
    }

    // Check rate limit backoff
    if (now < this.rateLimitedUntil && !options.forceRefresh) {
      return {
        status: 'RATE_LIMITED',
        source: 'MARKETAUX',
        fetchedAt: new Date(now).toISOString(),
        articleCount: 0,
        articles: [],
        sentimentSummary: {
          averageScore: 0,
          overallLabel: 'Neutral',
          bullishCount: 0,
          bearishCount: 0,
          neutralCount: 0
        },
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'LOW',
        error: `Marketaux API is currently in rate-limit backoff until ${new Date(this.rateLimitedUntil).toISOString()}`,
        rateLimited: true
      };
    }

    const cacheKey = JSON.stringify({
      symbols: options.symbols,
      search: options.search,
      countries: options.countries,
      limit: options.limit
    });

    if (!options.forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        return cached.snapshot;
      }
    }

    const existingPromise = this.inFlight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = this.performFetch(apiKey, options, cacheKey, now);
    this.inFlight.set(cacheKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async performFetch(
    apiKey: string,
    options: MarketauxNewsOptions,
    cacheKey: string,
    now: number
  ): Promise<MarketauxNewsSnapshot> {
    const url = new URL(this.getBaseUrl());
    url.searchParams.set('api_token', apiKey);
    url.searchParams.set('language', 'en');

    if (options.symbols) {
      const symList = Array.isArray(options.symbols) ? options.symbols.join(',') : options.symbols;
      if (symList.trim()) {
        url.searchParams.set('symbols', symList.trim());
      }
    }

    if (options.search) {
      url.searchParams.set('search', options.search.trim());
    }

    if (options.countries) {
      const cList = Array.isArray(options.countries) ? options.countries.join(',') : options.countries;
      if (cList.trim()) {
        url.searchParams.set('countries', cList.trim());
      }
    }

    if (options.publishedAfter) {
      url.searchParams.set('published_after', options.publishedAfter);
    }

    if (options.publishedBefore) {
      url.searchParams.set('published_before', options.publishedBefore);
    }

    if (typeof options.sentimentGte === 'number') {
      url.searchParams.set('sentiment_gte', String(options.sentimentGte));
    }

    if (typeof options.sentimentLte === 'number') {
      url.searchParams.set('sentiment_lte', String(options.sentimentLte));
    }

    if (options.mustHaveEntities !== undefined) {
      url.searchParams.set('must_have_entities', options.mustHaveEntities ? 'true' : 'false');
    }

    if (options.groupSimilar !== undefined) {
      url.searchParams.set('group_similar', options.groupSimilar ? 'true' : 'false');
    } else {
      url.searchParams.set('group_similar', 'true');
    }

    const limit = Math.min(50, Math.max(1, options.limit || 20));
    url.searchParams.set('limit', String(limit));

    if (options.page && options.page > 1) {
      url.searchParams.set('page', String(options.page));
    }

    const timeoutMs = Number(process.env.GOLDCREST_NEWS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Goldcrest/2.0 Marketaux-News-Integration'
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          this.rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
          return {
            status: 'RATE_LIMITED',
            source: 'MARKETAUX',
            fetchedAt: new Date(now).toISOString(),
            articleCount: 0,
            articles: [],
            sentimentSummary: {
              averageScore: 0,
              overallLabel: 'Neutral',
              bullishCount: 0,
              bearishCount: 0,
              neutralCount: 0
            },
            highImpactCount: 0,
            elevatedCount: 0,
            riskLevel: 'LOW',
            error: `Marketaux rate limit reached (HTTP 429). Backing off for ${RATE_LIMIT_BACKOFF_MS / 1000}s.`,
            rateLimited: true
          };
        }
        throw new Error(`Marketaux returned HTTP ${response.status}: ${response.statusText}`);
      }

      const payload: MarketauxRawResponse = await response.json();

      if (payload.error) {
        const isLimit = payload.error.code?.includes('limit') || payload.error.message?.includes('limit');
        if (isLimit) {
          this.rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
          return {
            status: 'RATE_LIMITED',
            source: 'MARKETAUX',
            fetchedAt: new Date(now).toISOString(),
            articleCount: 0,
            articles: [],
            sentimentSummary: {
              averageScore: 0,
              overallLabel: 'Neutral',
              bullishCount: 0,
              bearishCount: 0,
              neutralCount: 0
            },
            highImpactCount: 0,
            elevatedCount: 0,
            riskLevel: 'LOW',
            error: payload.error.message || 'Marketaux rate limit reached.',
            rateLimited: true
          };
        }
        throw new Error(`Marketaux API error: ${payload.error.message || payload.error.code}`);
      }

      const rawArticles = Array.isArray(payload.data) ? payload.data : [];
      const articles: MarketauxArticle[] = [];

      for (const raw of rawArticles) {
        if (!raw.title || !raw.url) continue;

        const summary = raw.snippet || raw.description || '';
        const publishedAt = this.parsePublishedAt(raw.published_at);
        const sentiment = this.evaluateArticleSentiment(raw);
        const impactLevel = this.classifyImpact(raw.title, summary, sentiment.score);

        const entities = Array.isArray(raw.entities)
          ? raw.entities.map(e => ({
              symbol: e.symbol || '',
              name: e.name || '',
              sentimentScore: typeof e.sentiment_score === 'number' ? e.sentiment_score : 0,
              matchScore: typeof e.match_score === 'number' ? e.match_score : 0
            })).filter(e => Boolean(e.symbol))
          : [];

        articles.push({
          uuid: raw.uuid || raw.url,
          title: raw.title.trim(),
          url: raw.url.trim(),
          source: raw.source || 'Marketaux',
          publishedAt,
          summary,
          bannerImage: raw.image_url || null,
          sentimentScore: sentiment.score,
          sentimentLabel: sentiment.label,
          keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
          entities,
          impactLevel
        });
      }

      const sentimentSummary = this.calculateSentimentSummary(articles);
      const highImpactCount = articles.filter(a => a.impactLevel === 'HIGH').length;
      const elevatedCount = articles.filter(a => a.impactLevel === 'ELEVATED').length;
      const riskLevel: 'HIGH' | 'ELEVATED' | 'LOW' = highImpactCount > 0
        ? 'HIGH'
        : elevatedCount >= 4
          ? 'ELEVATED'
          : 'LOW';

      const snapshot: MarketauxNewsSnapshot = {
        status: articles.length > 0 ? 'LIVE' : 'NO_RESULTS',
        source: 'MARKETAUX',
        fetchedAt: new Date(now).toISOString(),
        articleCount: articles.length,
        articles,
        sentimentSummary,
        highImpactCount,
        elevatedCount,
        riskLevel
      };

      this.cache.set(cacheKey, {
        snapshot,
        expiresAt: now + CACHE_TTL_MS
      });

      return snapshot;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          status: 'ERROR',
          source: 'MARKETAUX',
          fetchedAt: new Date(now).toISOString(),
          articleCount: 0,
          articles: [],
          sentimentSummary: {
            averageScore: 0,
            overallLabel: 'Neutral',
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0
          },
          highImpactCount: 0,
          elevatedCount: 0,
          riskLevel: 'LOW',
          error: `Marketaux request timed out after ${timeoutMs}ms.`
        };
      }

      return {
        status: 'ERROR',
        source: 'MARKETAUX',
        fetchedAt: new Date(now).toISOString(),
        articleCount: 0,
        articles: [],
        sentimentSummary: {
          averageScore: 0,
          overallLabel: 'Neutral',
          bullishCount: 0,
          bearishCount: 0,
          neutralCount: 0
        },
        highImpactCount: 0,
        elevatedCount: 0,
        riskLevel: 'LOW',
        error: err?.message || 'Unknown Marketaux error occurred.'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetches Forex-tailored news and sentiment from Marketaux.
   */
  public async fetchForexNews(
    pairs: string[] = ['EUR/USD', 'GBP/USD', 'USD/JPY'],
    options: Omit<MarketauxNewsOptions, 'symbols' | 'search'> = {}
  ): Promise<MarketauxNewsSnapshot> {
    // Extract currency codes and symbols
    const symbols: string[] = [];
    for (const pair of pairs) {
      const clean = pair.toUpperCase().replace(/[^A-Z]/g, '');
      if (clean.length === 6) {
        symbols.push(clean); // e.g. EURUSD
      }
    }

    const search = 'Federal Reserve OR ECB OR Bank of Japan OR interest rate OR inflation OR forex OR currency';

    return this.fetchNewsSentiment({
      ...options,
      symbols: symbols.length > 0 ? symbols : undefined,
      search,
      countries: ['us', 'gb', 'eu', 'jp', 'ch', 'au', 'ca']
    });
  }
}

export const marketauxNewsService = new MarketauxNewsService();
