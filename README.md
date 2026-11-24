# STRATA Medical AI Research Lab (`strata-medical-ai-lab`)

**Research. Intelligence. Innovation.**

Repository for **STRATA Project 001** — *Secure and AI-Enhanced Digital Education Ecosystem* — beginning with **STRATA ContentVault v0.1**, a functional server-side intellectual property deterrence, traceability, and entitlement-enforcement engine for professional medical and personal development education.

> **Governance & Synthetic Data Notice:**
> - STRATA is an independent research and development initiative. No institutional affiliation, clinical approval, confirmed partnership, or Mindvalley affiliation is claimed.
> - All materials stored and rendered in this repository are **100% synthetic demonstration files** containing no patient records, private student communications, or proprietary book manuscripts.
> - ContentVault provides **piracy deterrence, forensic traceability, and server-side access control**—not "piracy-proof" guarantees (see [`docs/security/KNOWN_LIMITATIONS.md`](docs/security/KNOWN_LIMITATIONS.md)).

---

## Architecture Highlights (ContentVault v0.1)

| Layer | Implementation | Security Property |
| --- | --- | --- |
| **HTTP API & Web UI** | Node.js `>= 22` (`node:http`, zero npm runtime dependencies) | Strict CSP (`script-src 'self'`), CSRF origin check, `HttpOnly` session cookies |
| **Persistence** | Built-in `node:sqlite` (`WAL` mode, parameterized queries) | Server-side RBAC, versioned entitlements, append-only `audit_log` |
| **Private Storage** | Non-public directory (`var/storage/private/`, `0600` mode) | Opaque object keys; zero direct HTTP routes to raw PDFs or audio |
| **Watermark Engine** | Python `>= 3.11` + `PyMuPDF` + `Pillow` (`packages/watermark-engine/`) | Rasterises at 144 DPI and composites learner name, ID, page & UTC stamp into PNG pixels |
| **Base Raster Cache** | Content-addressed cache (`var/render-cache/`, `0600` mode) | Stores *unwatermarked* rasters only; per-learner watermarks are burned in at request time |
| **Teaching Audio** | Authenticated HTTP `Range` (`206 Partial Content`) stream | Enforces live student entitlement and short-lived HMAC-SHA256 audio tokens |
| **Bilingual Reader & Admin** | Responsive Desktop & Mobile SPA (`EN` / `中文`) | Chapter navigation, zoom, fullscreen, reading progress, live admin revoke & audit trail |

---

## Reproducible Local Setup

### Prerequisites
- **Node.js** `>= 22.5` (for built-in `node:sqlite`)
- **Python** `>= 3.11` with `venv` and `pip`

### 1. Install Python Rendering Dependencies

**Linux / macOS (Bash):**
```bash
./scripts/setup/install-python-deps.sh
```

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup\install-python-deps.ps1
```

This creates `.venv/` (excluded from Git) with `pymupdf` and `Pillow` and runs the programmatic watermark visual verification suite (`scripts/synthetic/verify_watermark_visual.py`).

### 2. Seed Synthetic Demonstration Accounts & Protected Module

```bash
cd apps/contentvault-api
npm run seed
```

Running `npm run seed` is idempotent. It initializes `var/contentvault.db`, stores the 6-page synthetic neurology PDF and 5 synthetic chapter WAV audio tracks inside `var/storage/private/`, and provisions local evaluation personas:

| Persona | Email | Default Local Seed Password | Entitlement State |
| --- | --- | --- | --- |
| **Admin** | `admin@strata.local` | `strata-demo-admin-local` | Admin Console (upload, grant, revoke, audit, self-test) |
| **Student A** | `aisyah@student.strata.local` | `strata-demo-student-local` | **Active** — Personalized burned-in watermark A |
| **Student B** | `weiming@student.strata.local` | `strata-demo-student-local` | **Active** — Distinct burned-in watermark B (`中文` locale) |
| **Student C** | `priya@student.strata.local` | `strata-demo-student-local` | **Unentitled** — Demonstrates `403` access denial |

*(Override seed passwords locally via `CV_DEMO_ADMIN_PASSWORD` and `CV_DEMO_STUDENT_PASSWORD`; see `.env.example`.)*

### 3. Start ContentVault Server

```bash
cd apps/contentvault-api
npm start
```

Open `http://127.0.0.1:7410` in your browser (set `HOST=0.0.0.0` when binding for container/preview environments).

### 4. Run Automated Acceptance & Security Tests (`CV-001` – `CV-020`)

```bash
cd apps/contentvault-api
npm test
# or run the standalone acceptance matrix reporter:
npm run test:acceptance
```

---

## Key Documentation Index

- **Master Governance:** [`AGENTS.md`](AGENTS.md)
- **Roadmap & Milestones:** [`ROADMAP.md`](ROADMAP.md) · [`MILESTONES.md`](MILESTONES.md) · [`CHANGELOG.md`](CHANGELOG.md)
- **Architecture & ADRs:** [`docs/architecture/CONTENTVAULT_ARCHITECTURE.md`](docs/architecture/CONTENTVAULT_ARCHITECTURE.md) · [`docs/decisions/ADR-001-zero-dependency-runtime.md`](docs/decisions/ADR-001-zero-dependency-runtime.md) · [`docs/decisions/ADR-002-pdf-rasterisation-and-watermarking.md`](docs/decisions/ADR-002-pdf-rasterisation-and-watermarking.md)
- **Security & Limitations:** [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md) · [`docs/security/KNOWN_LIMITATIONS.md`](docs/security/KNOWN_LIMITATIONS.md)
- **Research & Asset Registers:** [`research/professional-profile/PROFILE_VERIFICATION_REGISTER.md`](research/professional-profile/PROFILE_VERIFICATION_REGISTER.md) · [`research/publications/ASSET_INVENTORY.md`](research/publications/ASSET_INVENTORY.md)
- **Verification & Cost Reports:** [`reports/security/ACCEPTANCE_TEST_REPORT.md`](reports/security/ACCEPTANCE_TEST_REPORT.md) · [`reports/progress/MISSION_002A_RECOVERY_REPORT.md`](reports/progress/MISSION_002A_RECOVERY_REPORT.md) · [`reports/costing/RESEARCH_COSTS.md`](reports/costing/RESEARCH_COSTS.md)
