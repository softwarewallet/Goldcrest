# Goldcrest — AI Trading Analyst

Goldcrest is an AI-assisted trading analysis platform with broker connectivity, quantitative analytics, model-driven signals, risk controls, reconciliation, and operational monitoring.

## Current Architecture

- **Trading mode:** `LIVE_ONLY`
- **LIVE broker connectivity:** supported for account, balance, positions, orders, and market-data observation where authoritative broker data is available.
- **Autonomous live-money execution:** permanently disabled.
- **Authoritative data only:** fabricated balances, quotes, OHLC, volume, and synthetic `FRESH` market-data fallbacks are not permitted.
- **Research program:** active and observational. The research pipeline captures live-trade outcomes, builds features/training labels, and evaluates directional baselines; research outputs do not modify live execution.
- **Persistence:** SQLite is the sole application persistence layer. Firestore/Firebase application storage has been removed.
- **Research AI gateway:** optional single `LLAMA_GATEWAY` connection. Llama is the gateway/orchestrator and may run Qwen internally through the same network connection. The gateway is used only by the research prediction layer; it has no broker credentials and cannot place or modify trades.
- **Prediction modes:** the research prediction API supports the deterministic `BASELINE` model and an opt-in `AI_GATEWAY` model. AI inference receives only pre-outcome features; realized P&L, outcome, and holding duration are excluded to prevent label leakage.

## Safety Invariant

The absolute safety invariant:

`LIVE_AUTO_EXECUTION_ALLOWED === false`

is permanently enforced. Goldcrest may validate and execute explicit operator-controlled LIVE orders through the broker routes after the server-side safety gates pass, but it must not autonomously submit live-money orders.

## Account Selection

cTrader account selection must use an explicitly selected/validated account when multiple accounts are available. The system must never silently fall back to the first account or fabricate financial values when authoritative account details cannot be retrieved.

## Market Data Integrity

Market-data adapters must distinguish between authoritative `FRESH`, delayed/stale, and unavailable data. When an upstream provider does not supply a valid snapshot, the system reports unavailable data rather than manufacturing prices or marking synthetic values as fresh.

## Runbooks & Recovery

See `RUNBOOK.md` for disaster-recovery procedures, database restoration, broker-disconnection reconciliation, and incident response.

## Disclaimer

Trading in Forex and derivatives involves substantial risk of loss. Model outputs, signals, probabilities and technical analysis are estimates for informational and analytical purposes only and are not financial advice, guarantees, or assurances of future performance.

## Multi-Broker Routing

Both LIVE broker adapters remain active simultaneously. Goldcrest routes automatically by market: **FOREX → cTrader** and **Indian equity/futures/options → 5paisa**. No broker selection is required for normal operation. The header displays separate LIVE balance cards for cTrader and 5paisa.

## Persistence

Goldcrest uses the local SQLite database at `data/trading_analyst.sqlite` as the authoritative application persistence layer for settings, signals, trades, positions, orders, reconciliation traces, notes, and ML records. Broker APIs remain authoritative for live account and market state. Firestore/Firebase is not required for application operation.


## Operator API authentication

Operational broker, governance, configuration, notes, and database-statistics endpoints require the `GOLDCREST_OPERATOR_API_KEY` environment variable. Clients authenticate with the `X-Goldcrest-Operator-Key` header or an `Authorization: Bearer <key>` header. The key is never stored in SQLite or returned by the API.

If the operator key is not configured, protected endpoints fail closed with `OPERATOR_AUTH_NOT_CONFIGURED`.

## Production deployment

Goldcrest production startup performs a fail-closed preflight. Production will not start unless GOLDCREST_OPERATOR_API_KEY is configured, at least one LIVE broker credential set is configured, the trading mode is LIVE_ONLY, and autonomous execution is disabled. The runtime exposes /api/health for liveness and /api/health/ready for readiness.

Install dependencies with npm install, build with npm run build, and run with NODE_ENV=production npm start. Production startup also validates the compiled server bundle, SPA entry artifact, and writable data directory before accepting traffic. Put the Node process behind a TLS reverse proxy and persist data/trading_analyst.sqlite on durable storage.
