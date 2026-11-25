# STRATA Research Expenditure & Cost Control Register

Maintained in accordance with [`AGENTS.md`](AGENTS.md) Sections 7 and 22.

> **Financial Governance Notice:**
> - Proposed Round 01 targets (Soft Cap: USD 1,500 / Hard Cap: USD 3,000) are **provisional and unconfirmed**.
> - **Confirmed Paid Infrastructure / Third-Party Spend to Date:** **`$0.00 USD`**.
> - No paid cloud subscriptions, databases, storage buckets, or commercial licenses have been purchased.

---

## Expenditure Log

| Date (UTC) | Task / Workstream | Provider / Runtime | Model / Tooling | Input Tokens (Est.) | Output Tokens (Est.) | Estimated Cost (USD) | Confirmed Billed Cost (USD) | Funding Category | Approval Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-24 | Baseline experiment (`d0fc178`) | Local runtime + DeepSeek Harness | Owner desktop session | Unmetered in repo | Unmetered in repo | `$0.00` (owner session) | `$0.00` | AI API and computing | Owner-initiated |
| 2026-11-24 | Mission 002-A: ContentVault recovery, UI, tests (`CV-001`..`CV-020`) & docs | Arena.ai Agent Mode sandbox | Arena Agent Mode | ~55,000 (est.) | ~28,000 (est.) | `$0.00` (sandbox session; zero external paid API calls) | `$0.00` | Researcher / AI computing | Authorized (`MISSION 002-A`) |
| 2026-11-24 | Database, Storage & Rendering Stack | Local `node:sqlite`, local disk, open-source Python (`PyMuPDF` + `Pillow` in `.venv`) | Zero-dependency local stack (`ADR-001`) | 0 | 0 | `$0.00` | `$0.00` | Hosting and infrastructure | Approved local dev (`AGENTS.md` §24) |

---

## Pre-Commercial Cost Risk Watchlist

1. **PDF Rendering Engine Licensing (`ADR-002`):** `PyMuPDF` is `AGPL-3.0`. Before commercial SaaS deployment, evaluate zero-cost migration to `pypdfium2` (`Apache-2.0` / `BSD-3-Clause`) vs. Artifex commercial licensing so hosting/licensing remains within the provisional `$150–$300` infrastructure budget.
2. **Cloud Persistence & Storage (P1 Pilot):** Supabase Free Tier suffices for private staging evaluation; review Supabase Pro (`~$25/month`) commercial terms only upon explicit owner approval.
