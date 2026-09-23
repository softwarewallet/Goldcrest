      errors.push(error?.name === 'AbortError'
        ? 'JBlanked news request timed out.'
        : error?.message || String(error));
    }
  }

  // The MQL5 and Forex Factory endpoints can expose the same economic
  // event with slightly different timestamps. Use the normalized event title
  // as the cross-endpoint identity so the same event is not counted twice.
  const uniqueEvents = new Map<string, LiveNewsArticle>();
  for (const article of articles) {
    const eventKey = article.title.trim().toLowerCase();
    if (!uniqueEvents.has(eventKey)) {
      uniqueEvents.set(eventKey, article);
    }
  }
  const normalized = deduplicateArticles([...uniqueEvents.values()]);
  return {
    status: normalized.length > 0
      ? 'LIVE'
      : errors.length === endpoints.length ? 'ERROR' : 'NO_RESULTS',
    articles: normalized,