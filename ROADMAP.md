# STRATA Project 001 — Technical & Research Roadmap

Aligned with [`AGENTS.md`](AGENTS.md) Section 8 (*Development Priorities*). P2 and P3 research directions remain gated behind completion and partner review of P0 deliverables.

---

## P0 — Essential Proof of Concept (Current Phase)

- [x] **Repository & Governance Initialization** (`AGENTS.md`, `README.md`, `ROADMAP.md`, `MILESTONES.md`, `CHANGELOG.md`, `.gitignore`, `.env.example`)
- [x] **Preliminary Research & Asset Inventory** (`research/professional-profile/`, `research/publications/` with strict `OWNER_SUPPLIED` / `UNVERIFIED` provenance)
- [x] **ContentVault Threat Model & Known Limitations** (`docs/security/THREAT_MODEL.md`, `docs/security/KNOWN_LIMITATIONS.md`)
- [x] **ContentVault v0.1 Vertical Slice**:
  - [x] Server-side `scrypt` authentication & `HttpOnly` session management (Admin + Student roles)
  - [x] Private document & audio object storage (`var/storage/private/`)
  - [x] 144 DPI server-side PDF rasterisation + burned-in per-learner pixel watermarking (`packages/watermark-engine/render_page.py`)
  - [x] Unwatermarked base-raster disk cache (`var/render-cache/`)
  - [x] Versioned entitlement grant, expiration, and immediate revocation
  - [x] Responsive bilingual (`EN` / `中文`) Protected Document Reader + Chapter Audio Player + Admin Console
  - [x] Automated 20-test acceptance & security verification suite (`CV-001` – `CV-020`)
- [ ] **External Primary-Source Verification** of Dr. Eow's register entries & PNM ISBN records (pending unrestricted web verification & partner confirmation)
- [ ] **Professional Digital Portfolio Prototype & Research Sponsorship Proposal** (`M007`, `M011`)

---

## P1 — Pilot Product Enhancement

- PostgreSQL + Supabase Auth + audited Row Level Security (RLS) migration
- Pre-commercial PDF engine license resolution (`pypdfium2` Apache-2.0 adapter vs. Artifex commercial license)
- Accessible chapter transcripts alongside rasterized visual pages
- Extended bilingual learning modules, interactive workbooks, and structured quizzes
- Optional Telegram cohort notification bridge (complementing, not misrepresenting, native Telegram restrictions)

---

## P2 — Extended Research

- Retrieval-Augmented Generation (RAG) bilingual educational assistant over authorized materials
- Interactive EEG, EMG/NCS, and Neuro-ophthalmology educational simulators (strictly non-clinical teaching tools)
- APInex / gateway security evaluation and model benchmarking

---

## P3 — Future Research (Out of Initial Scope)

- Institutional ethics-reviewed medical AI research collaborations
- Validated clinical decision-support research under qualified specialist oversight
