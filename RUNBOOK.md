# DISASTER-RECOVERY RUNBOOK
**RELEASE CANDIDATE:** RC-1.0.0-FINAL
**STATUS:** PRODUCTION READY (PAPER/DEMO/SANDBOX ONLY)

## A. Application Failure (Crash / OOM)
- **Detection**: Cloud Run memory limit alerts / Unresponsive frontend.
- **Containment**: Restart container instance.
- **Action**: Scale down container and immediately spin up new instance.
- **Verification**: Ensure internal broker connections re-authenticate cleanly.
- **Reconciliation**: Application compares local order queue against broker API on boot.
- **Recovery**: Automatic resume of execution queue.
- **Audit**: Log crash timestamp and container ID.

## B. Database Failure (Firestore Unavailable)
- **Detection**: Firebase SDK `unavailable` exceptions in backend logs.
- **Containment**: Kill Switch automatically triggers, halting all signal execution.
- **Action**: Wait for Google Cloud incident resolution. Do NOT route trades if persistence fails.
- **Verification**: Health check ping to Firestore.
- **Reconciliation**: Not applicable; state is frozen.
- **Recovery**: Release Kill Switch manually once DB is restored.
- **Audit**: Log exact downtime duration.

## C. Broker Failure (API Disconnect)
- **Detection**: Heartbeat timeout or repeated 502/504 errors from cTrader/5paisa.
- **Containment**: System pauses routing; orders placed in `STALLED` state.
- **Action**: Retry with exponential backoff up to 5 times. If persistent, trigger emergency halt.
- **Verification**: Operator verifies broker status page.
- **Reconciliation**: On reconnect, query all open positions via broker API and compare against internal ledger. Handle orphans.
- **Recovery**: Resume auto-execution once reconciliation passes 100%.
- **Audit**: Record orphan/phantom trades detected during reconciliation.

## D. Security Incident (Live-Gate Bypass Attempt)
- **Detection**: Penetration attempt hits `LIVE_AUTO_EXECUTION_ALLOWED === false` invariant.
- **Containment**: Connection dropped (403 Forbidden).
- **Action**: Shut down application entirely if sustained attack is detected.
- **Verification**: Review logs for execution payload.
- **Reconciliation**: Verify absolutely zero LIVE orders reached broker API.
- **Recovery**: Do not recover until exploit vector is analyzed.
- **Audit**: Full forensic analysis.

## E. Release Rollback [TRACKED IN ACTION REGISTER]
- **Detection**: Operator initiates due to critical bug.
- **Action**: Currently **BLOCKED** pending GCP Artifact Registry setup (ACT-002).
- **Recovery**: Requires manual deployment of previous known Git commit until CI/CD is attached.

## F. Database Restore [TRACKED IN ACTION REGISTER]
- **Detection**: Data corruption / accidental deletion.
- **Action**: Currently **BLOCKED** pending GCP IAM Backup exports (ACT-001).
- **Recovery**: Manual resolution required if Firestore data is permanently lost prior to automated backup implementation.

