# Goldcrest Forex Operations Center

## Overview
The Operations Center is the operational control surface for Goldcrest's Forex-only production terminal. It provides runtime health telemetry, cTrader connectivity monitoring, Forex market-data quality checks, risk-gate verification, execution-quality tracking, reconciliation, audit visibility, and operator alerts.

## Safety and Execution Invariants
```typescript
LIVE_AUTO_EXECUTION_ALLOWED === false
```

This is the startup/locked-state invariant. Goldcrest operates with `LIVE_ONLY` as its application trading environment. Autonomous live-money execution can be enabled only through the authenticated operator execution gate after the production activation preflight succeeds.

### cTrader Open API modes
The cTrader Open API transport selector supports:
- `LIVE` — production cTrader endpoint.
- `DEMO` — cTrader functional/testing endpoint.

The API selector is independent of the application's `LIVE_ONLY` trading-environment contract. DEMO is an authoritative functional validation environment for account, permission, instrument, quote, history, positions, open-order, and common order-packet paths. Production autonomous execution still requires the cTrader API selector to be `LIVE`.

No 5paisa, Indian-market, options, paper-trading, or other non-Forex broker route is active in the application.

## Subsystems

### 1. Runtime Health
- Express readiness and liveness endpoints.
- SQLite initialization and persistence health.
- Runtime lifecycle state.
- Durable audit-log availability.
- cTrader LIVE/DEMO transport diagnostics.
- Auto Live lifecycle and recovery state.

### 2. Forex Market Data Quality
- Authoritative Forex bid/ask freshness.
- Historical candle availability and continuity.
- Supported Forex pair universe.
- Session state and weekend closure detection.
- 30-second maximum execution quote age.

### 3. Risk and Safety Gates
- Stop-loss and take-profit requirements.
- Daily loss protection.
- Maximum open-position and per-pair limits.
- Spread threshold.
- Signal freshness and identity.
- Kill switch.
- Execution-intent idempotency and reconciliation.
- Final autonomous order-packet validation.

### 4. Execution
Forex orders route to cTrader. Autonomous execution is serialized through the common safety/readiness pipeline and durable execution-intent lifecycle.

### 5. Reconciliation
The broker is the authoritative source for live account, positions, orders, fills, and execution status. SQLite stores durable application records used for audit and reconciliation.

### 6. Audit and Alerts
Operational actions, execution stages, safety decisions, broker responses, and reconciliation events are written to the durable runtime/audit logs.

## Operational API References
- `GET /api/operations/readiness`
- `GET /api/operations/brokers/verify`
- `GET /api/operations/account-consistency`
- `GET /api/operations/go-live-validation`
- `GET /api/operations/active-auto-live-monitor`
- `GET /api/operations/ctrader-functional-validation`
- `GET /api/observability/runtime`
- `GET /api/governance/status`
- `GET /api/governance/reconciliation/positions`
- `GET /api/governance/reconciliation/orders`
- `GET /api/governance/audit-logs`

## Production Workflow
```text
Startup
  ↓
Runtime / release readiness
  ↓
cTrader account verification
  ↓
Account-state consistency
  ↓
Production Go-Live Validation
  ↓
Operator execution-gate unlock
  ↓
Active Auto Live monitoring
  ↓
Auto Live execution through cTrader
```

For functional staging, select cTrader `DEMO` and run the cTrader functional validator before selecting `LIVE`.
