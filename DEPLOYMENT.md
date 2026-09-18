# Goldcrest Production Deployment

## Deployment target

Goldcrest is a stateful Node/Express application with SQLite persistence. Deploy it as a single persistent server/container instance with durable storage mounted at /app/data.

Do not deploy the application server as a stateless serverless function while SQLite is authoritative. Multiple instances can create divergent SQLite databases.

## Required production environment

Copy .env.example to .env and set:

- NODE_ENV=production
- HOST=0.0.0.0
- PORT=3000
- GOLDCREST_OPERATOR_API_KEY=<high-entropy-secret>
- cTrader LIVE credentials
- 5paisa LIVE credentials

Optional:
- GEMINI_API_KEY
- TRUST_PROXY=true only when the reverse proxy is trusted and correctly configured.

Keep .env outside Git. Never put broker credentials or the operator key in frontend build variables.

## Safety state

The production deployment must preserve:
- TRADING_MODE=LIVE_ONLY
- LIVE_AUTO_EXECUTION_ALLOWED=false
- LIVE_TRADING_ENABLED=false
- AUTO_EXECUTION_ENABLED=false

Broker connectivity is allowed for account, market-data, positions and order observation. Autonomous live-money order submission remains permanently blocked.

## Docker deployment

1. Install Docker Engine and Compose on the production host.
2. Clone the repository.
3. Create the production .env from .env.example.
4. Configure the durable Docker volume for /app/data.
5. Build and start with: docker compose build && docker compose up -d
6. Verify: curl -fsS http://127.0.0.1:3000/api/health
7. Verify readiness: curl -i http://127.0.0.1:3000/api/health/ready
8. Put a TLS reverse proxy in front of port 3000. Do not expose the Node port directly to the public internet when avoidable.
9. Configure DNS to the reverse proxy and verify browser operator login.

## Release procedure

For each release:
- git pull --ff-only origin main
- docker compose build
- docker compose up -d
- docker compose ps
- docker compose logs --tail=200 goldcrest

Verify:
- /api/health returns HTTP 200.
- /api/health/ready returns HTTP 200.
- Operator login succeeds.
- cTrader and 5paisa balance cards show authoritative LIVE account data when credentials/session are valid.
- Broker status identifies unavailable/authentication failures explicitly when a broker is not ready.
- SQLite data remains present after container restart.
- No PAPER/DEMO workflow is exposed as an active trading mode.
- LIVE_AUTO_EXECUTION_ALLOWED remains false.

## Database backup

Back up the SQLite database from the durable volume before upgrades and on a scheduled basis. A safe application-level backup should copy the database while the application is stopped or use a SQLite-consistent backup mechanism.

At minimum retain:
- current database backup
- previous known-good database backup
- release/version identifier
- backup timestamp

## Final production checklist

- [ ] TLS enabled at the reverse proxy.
- [ ] DNS points to the production host.
- [ ] GOLDCREST_OPERATOR_API_KEY configured.
- [ ] cTrader LIVE credentials verified.
- [ ] 5paisa LIVE credentials/session verified.
- [ ] /api/health/ready returns ready.
- [ ] Both balance cards display authoritative broker data.
- [ ] SQLite volume is durable and backed up.
- [ ] No broker credentials committed to Git.
- [ ] Autonomous live order submission remains disabled.


## HTTPS reverse proxy

The production Compose stack now includes Caddy. Set GOLDCREST_DOMAIN to the real public hostname and point its DNS A/AAAA record to the production host. Caddy terminates HTTPS and proxies internally to Goldcrest; port 3000 is not published publicly. Keep the Caddy data volume durable so certificate state survives container recreation.

Docker volumes are used because container filesystems are ephemeral; durable volumes preserve SQLite and certificate state across container lifecycle events. See Docker's volume documentation.

For production Compose deployments, a single server is an appropriate deployment shape for this stateful application, provided the SQLite volume is durable.

### Final host setup

1. Provision one Linux server with Docker Engine and Compose.
2. Allow inbound TCP 80 and 443. Do not expose TCP 3000 publicly.
3. Clone the Goldcrest repository.
4. Create .env from .env.example.
5. Set the real GOLDCREST_DOMAIN.
6. Set the production operator key and LIVE broker credentials.
7. Start with docker compose up -d --build.
8. Confirm docker compose ps shows both goldcrest and caddy healthy.
9. Confirm the HTTPS /api/health endpoint returns HTTP 200.
10. Confirm the HTTPS /api/health/ready endpoint returns HTTP 200.
11. Log in through the browser operator gate.
12. Verify both live balance cards and broker status.
13. Take the first verified SQLite backup before normal production use.

Do not put broker credentials or the operator key into Git or Vite frontend variables.
