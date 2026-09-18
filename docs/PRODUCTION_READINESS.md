# Goldcrest Production Readiness

## Current operating model

- User-facing trading mode: LIVE_ONLY.
- FOREX routes to cTrader LIVE.
- Indian equity, futures and options route to 5paisa LIVE.
- SQLite is the application persistence layer.
- Broker APIs are authoritative for live account and market state.
- Autonomous live-money order submission is permanently disabled by `LIVE_AUTO_EXECUTION_ALLOWED === false`.
- PAPER/DEMO HTTP workflows are retired and return HTTP 410.

## Production hardening completed

- HTTP security headers.
- `X-Powered-By` disabled.
- Request IDs.
- JSON request-size limit.
- In-process API rate limiting.
- Configurable trusted-proxy handling.
- Liveness and readiness endpoints.
- Production runtime target pinned to Node 24 LTS.
- GitHub Actions typecheck + production-build verification.
- Synthetic cTrader Forex quote/candle fallbacks removed from the main server path.
- Synthetic 5paisa option-chain generation removed.
- Unknown 5paisa option scrip codes no longer use deterministic fake IDs.

## Remaining production blockers

### 1. cTrader authoritative market-data adapter
The current cTrader adapter still needs a production implementation for:
- live bid/ask subscription;
- historical trendbars;
- authoritative symbol-id mapping;
- stale-quote detection and reconnect handling.

Until that is implemented, Forex analytical endpoints that require historical/quote data fail closed instead of displaying fabricated values.

### 2. API authentication / authorization
The server currently does not have a complete user/admin authentication layer. Before exposing Goldcrest to an untrusted network, protect:
- broker credential/configuration mutation;
- kill-switch resume;
- broker cancel/close operations;
- account-selection/configuration changes;
- audit/operational endpoints.

A reverse proxy or application-level authentication layer should be used; rate limiting alone is not authorization.

### 3. SQLite deployment topology
SQLite is appropriate for the current single-instance architecture. A multi-instance deployment should not be introduced without changing the persistence/concurrency strategy.

### 4. Broker reconciliation
Before any operational use, live positions/orders should be reconciled from broker APIs after startup, reconnect, and periodically. Local in-memory state must never be treated as broker truth.

## Required release gates

1. `npm run lint`
2. `npm run build`
3. CI green on the production branch.
4. cTrader live quote + historical-data certification.
5. 5paisa live market-data and account reconciliation certification.
6. Authentication/authorization certification.
7. Kill-switch and autonomous-execution safety regression tests.
8. Backup/restore test for SQLite.
9. Production reverse-proxy/TLS deployment test.
