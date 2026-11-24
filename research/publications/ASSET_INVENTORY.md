# STRATA Preliminary Publication & Educational Asset Inventory

- **Milestone:** M003 (Preliminary Publication & Programme Catalogue)
- **Date:** 2026-11-24
- **Governance Rule (`AGENTS.md` §4, §19):** All bibliographic entries below are recorded strictly as `OWNER_SUPPLIED` / `UNVERIFIED` preliminary records. No proprietary book files, Telegram exports, or student data have been ingested; ContentVault v0.1 uses synthetic demonstration files (`knowledge/synthetic/synthetic-neurology-module.pdf`) exclusively.

---

## 1. Reported Publication Catalogue

| Finding ID | Reported Title & Edition | Category | Source Origin | Reported Date | Access Date | Evidence Summary | Verification Status | Limitations & Recommended Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **PUB-001** | *Practical Approach to Clinical Neurology* (1st ed.) | Medical Education | `AGENTS.md` §4 | 2009 | 2026-11-24 | Preliminary catalogue entry supplied by project owner. | `OWNER_SUPPLIED` | Verify publisher, ISBN, co-authors, and copyright holder via Perpustakaan Negara Malaysia (PNM) catalogue. |
| **PUB-002** | *Pacing the PACES: Tips for passing MRCP and MBBS* (1st ed.) | Medical Education | `AGENTS.md` §4 | 2011 | 2026-11-24 | Preliminary catalogue entry supplied by project owner. | `OWNER_SUPPLIED` | Verify exact subtitle, ISBN, publisher, and edition history. |
| **PUB-003** | *Electroencephalogram Examples & Guides (EEG)* (1st ed.) | Medical Education | `AGENTS.md` §4 | 2013 | 2026-11-24 | Preliminary catalogue entry supplied by project owner. | `OWNER_SUPPLIED` | Verify bibliographic record and confirm no identifiable patient traces exist before any future authorized digitization. |
| **PUB-004** | *Neuro-ophthalmology Made Easy* (1st electronic ed.) | Medical Education | `AGENTS.md` §4 | 2020 | 2026-11-24 | Preliminary electronic publication entry. | `OWNER_SUPPLIED` | Verify eISBN, digital rights ownership, and co-authorship. |
| **PUB-005** | *Electrodiagnostic Medicine: A Case-Based Approach* (1st electronic ed.) | Medical Education | `AGENTS.md` §4 | 2021 | 2026-11-24 | Preliminary electronic publication entry. | `OWNER_SUPPLIED` | Verify eISBN, case anonymization status, and copyright terms. |
| **PUB-006** | *Clinical Medicine At A Glance* | Medical Education | `AGENTS.md` §4 | Unspecified | 2026-11-24 | Explicitly flagged in `AGENTS.md` as requiring bibliographic verification. | `UNVERIFIED` | Disambiguate against similarly titled international textbooks; confirm exact authorship/contribution with Dr. Eow. |
| **PUB-007** | *We Are Our Best Doctors: Awaken the Healing Power Within Us* (English ed.) | Personal Development | `AGENTS.md` §4 | 2021 | 2026-11-24 | Preliminary English edition record. | `OWNER_SUPPLIED` | Verify ISBN, publisher, and medical-disclaimer framing. |
| **PUB-008** | *We Are Our Best Doctors* (Mandarin ed.) | Personal Development | `AGENTS.md` §4 | 2021 | 2026-11-24 | Preliminary Mandarin edition record. | `OWNER_SUPPLIED` | Confirm official Chinese title, translator/editor credits, and ISBN. |
| **PUB-009** | *Understanding Self Through KHTP and Childhood Memories* (Bilingual ed., reported eISBN `978-983-44306-6-5`) | Personal Development | `AGENTS.md` §4 | 2021 | 2026-11-24 | Includes owner-reported Malaysian `978-983` prefix eISBN; checksum digit `5` is mathematically valid for ISBN-13 (`9789834430665`). | `OWNER_SUPPLIED` | Checksum valid (`INFERRED` structural validity only); verify official title/registrant in Perpustakaan Negara Malaysia depository. Ensure KHTP educational framing complies with `AGENTS.md` §16. |
| **PUB-010** | *Life Book: A Step-by-Step Guide to Breakthrough, Transformation and Awakening* (Bilingual ed., reported ISBN `978-983-44306-8-9`) | Personal Development | `AGENTS.md` §4 | Unspecified | 2026-11-24 | Includes owner-reported Malaysian `978-983` prefix ISBN; checksum digit `9` is mathematically valid for ISBN-13 (`9789834430689`). | `OWNER_SUPPLIED` | Checksum valid (`INFERRED` structural validity only); verify publication year and registrant in PNM catalogue; keep distinct from Mindvalley's "Lifebook" trademark in any international outreach. |

---

## 2. Reported Educational Programmes (Preliminary)

All programmes below are recorded as `OWNER_SUPPLIED` hypotheses of current Telegram-distributed offerings (`AGENTS.md` §4–5) requiring partner validation:
- English Transformation Masterclass & Mandarin Transformation Masterclass
- Lifebook programmes & KHTP Drawing workshops
- Decoding the Subconscious Mind & Photo Interpretation (subject to strict `AGENTS.md` §16 non-diagnostic educational boundaries)
- EEG e-books and audio teaching, Electrodiagnostic education, Neuro-ophthalmology education
- Drawing and childhood memories education

## 3. Approved Repository Synthetic Assets

| Asset Path | Type | Status | Purpose |
| --- | --- | --- | --- |
| `knowledge/synthetic/synthetic-neurology-module.pdf` | 6-page A4 PDF | `VERIFIED` (Synthetic) | Exercises ContentVault upload, private storage, rasterisation, and per-learner pixel watermarking. |
| `apps/contentvault-api/src/services/synthetic-audio.js` | Deterministic PCM WAV generator | `VERIFIED` (Synthetic) | Generates 5 chapter audio companions in `var/storage/private/` during `npm run seed`. |
