export interface LiveNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  language?: string;
  sourceCountry?: string;
}

export interface LiveNewsSnapshot {
  source: 'GDELT_DOC_2';
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

const QUERY = [
  '("Federal Reserve" OR ECB OR "Bank of Japan" OR "interest rate" OR CPI OR inflation OR NFP OR tariffs OR sanctions OR currency OR dollar OR euro OR pound OR yen)',
  '(forex OR FX OR currency OR USD OR EUR OR GBP OR JPY)'
].join(' ');

const HIGH_IMPACT_TERMS = [
  'federal reserve', 'fed', 'ecb', 'bank of japan', 'boj', 'interest rate',
  'rate decision', 'cpi', 'inflation', 'nonfarm payroll', 'nfp', 'jobs report',
  'tariff', 'sanction', 'intervention', 'war', 'conflict', 'emergency'
];

const ELEVATED_TERMS = [
  'central bank', 'pmi', 'retail sales', 'gdp', 'employment', 'yield',
  'treasury', 'dollar', 'euro', 'pound', 'yen', 'currency'
];

function classifyArticle(title: string): 'HIGH' | 'ELEVATED' | 'LOW' {
  const normalized = title.toLowerCase();
  if (HIGH_IMPACT_TERMS.some(term => normalized.includes(term))) return 'HIGH';
  if (ELEVATED_TERMS.some(term => normalized.includes(term))) return 'ELEVATED';
  return 'LOW';
}

function parseArticles(payload: any): LiveNewsArticle[] {
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

export async function fetchLiveForexNews(): Promise<LiveNewsSnapshot> {
  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set('query', QUERY);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', process.env.GOLDCREST_NEWS_TIMESPAN || '6h');
  url.searchParams.set('maxrecords', process.env.GOLDCREST_NEWS_MAX_RECORDS || '30');
  url.searchParams.set('sort', 'datedesc');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Goldcrest/2.0 live-market-preparation' }
    });
    if (!response.ok) {
      throw new Error(`GDELT news request failed with HTTP ${response.status}`);
    }

    const payload = await response.json();
    const articles = parseArticles(payload);
    let highImpactCount = 0;
    let elevatedCount = 0;

    for (const article of articles) {
      const classification = classifyArticle(article.title);
      if (classification === 'HIGH') highImpactCount += 1;
      else if (classification === 'ELEVATED') elevatedCount += 1;
    }

    const riskLevel = highImpactCount >= 3
      ? 'HIGH'
      : (highImpactCount > 0 || elevatedCount >= 4)
        ? 'ELEVATED'
        : 'LOW';

    return {
      source: 'GDELT_DOC_2',
      fetchedAt: new Date().toISOString(),
      status: articles.length ? 'LIVE' : 'NO_RESULTS',
      articleCount: articles.length,
      highImpactCount,
      elevatedCount,
      riskLevel: articles.length ? riskLevel : 'LOW',
      articles: articles.slice(0, 20)
    };
  } catch (error: any) {
    return {
      source: 'GDELT_DOC_2',
      fetchedAt: new Date().toISOString(),
      status: 'UNAVAILABLE',
      articleCount: 0,
      highImpactCount: 0,
      elevatedCount: 0,
      riskLevel: 'UNAVAILABLE',
      articles: [],
      error: error?.name === 'AbortError' ? 'Live news request timed out.' : String(error?.message || error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
