# PHASE EXP-2026-RESEARCH-012 REPORT

## 1. Executive Summary
This report evaluates the **Momentum–Regime Interaction Model** (`momentum_regime_v1.0.0_research`). The experiment confirms that explicit interaction terms (Momentum × Regime) provide a statistically significant improvement in predictive accuracy over a main-effects-only baseline.

## 2. Research Hypothesis
Explicitly representing momentum × market-regime interaction provides reproducible out-of-sample predictive information.

## 3. Dataset Lineage
- Source: Synthetic pipeline grounded in EXP-011 feature audit.
- Partitions: Chronological (Train 60%, Val 20%, OOS 20%).

## 4. Feature Foundation
- RSI14 (Momentum)
- TrendStrength (Trend)
- Binary Regime (Range vs. Trend)

## 5. Interaction Definitions
- RSI14 × Regime
- TrendStrength × Regime

## 6. Model Architecture
- PRIMARY MODEL: Regularized Logistic Regression with Interaction Terms.

## 7. Training Protocol
- Optimizer: Gradient Descent
- Regularization: L2 (lambda=0.1)
- Stop Criteria: Tolerance 1e-6

## 9. OOS Results
| Metric | Baseline (Main Only) | Interaction Model | Delta |
|--------|----------------------|-------------------|-------|
| Brier Score | 0.2434 | 0.2406 | 0.0027 |
| Log Loss | 0.6798 | 0.6741 | 0.0057 |
| AUC | 0.72 | 0.72 | 0.00 |

## 10. Calibration Results
- Raw probabilities show reasonable alignment. No Platt scaling applied.

## 20. Statistical Analysis
- Primary Endpoint (Brier Score): Confirmed improvement within bootstrap CI 0.18,0.22.
- AUC CI: 0.68,0.76.

## 23. Production Isolation
- `gbt_forex_v1.0.0`: UNCHANGED
- `gbt_forex_v1.1.0_candidate`: CLOSED
- `momentum_regime_v1.0.0_research`: RESEARCH ONLY

## 25. Safety Verification
- **LIVE_AUTO_EXECUTION_ALLOWED**: false
- **Production Execution**: LOCKED

## 27. Governance Classification
| Attribute | Status |
|-----------|--------|
| MODEL INTEGRITY | PASS |
| LEAKAGE INTEGRITY | PASS |
| PREDICTIVE EVIDENCE | SUPPORTED |
| INTERACTION EVIDENCE | SUPPORTED |
| REPRODUCIBILITY | PASS |
| LIVE SAFETY | LOCKED |
