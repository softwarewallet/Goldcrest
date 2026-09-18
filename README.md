# Goldcrest — AI Trading Analyst

Goldcrest is an AI-assisted trading analysis platform with broker connectivity, quantitative analytics, model-driven signals, risk controls, reconciliation, and operational monitoring.

## Current Architecture

- **Trading mode:** `LIVE_ONLY`
- **LIVE broker connectivity:** supported for account, balance, positions, orders, and market-data observation where authoritative broker data is available.
- **Autonomous live-money execution:** permanently disabled.
- **Authoritative data only:** fabricated balances, quotes, OHLC, volume, and synthetic `FRESH` market-data fallbacks are not permitted.
- **Research program:** closed. No further research experiment is part of the active production workflow unless explicitly reopened.
- **Firestore:** client access is restricted to authenticated owner-scoped user data; sensitive operational, audit, reconciliation, system, and ML collections are server-only.

## Safety Invariant

The absolute safety invariant:

`LIVE_AUTO_EXECUTION_ALLOWED === false`

is permanently enforced. Goldcrest may validate and present orders and may support explicit operator workflows where permitted by the application, but it must not autonomously submit live-money orders.

## Account Selection

cTrader account selection must use an explicitly selected/validated account when multiple accounts are available. The system must never silently fall back to the first account or fabricate financial values when authoritative account details cannot be retrieved.

## Market Data Integrity

Market-data adapters must distinguish between authoritative `FRESH`, delayed/stale, and unavailable data. When an upstream provider does not supply a valid snapshot, the system reports unavailable data rather than manufacturing prices or marking synthetic values as fresh.

## Runbooks & Recovery

See `RUNBOOK.md` for disaster-recovery procedures, database restoration, broker-disconnection reconciliation, and incident response.

## Disclaimer

Trading in Forex and derivatives involves substantial risk of loss. Model outputs, signals, probabilities and technical analysis are estimates for informational and analytical purposes only and are not financial advice, guarantees, or assurances of future performance.