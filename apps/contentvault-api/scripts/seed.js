#!/usr/bin/env node
/**
 * Idempotent synthetic demo seed script for STRATA ContentVault (SQLite & PostgreSQL 16).
 *
 * Creates:
 *   - 1 synthetic administrator account
 *   - 2 entitled synthetic student accounts (Student A & Student B)
 *   - 1 unentitled synthetic student account (Student C, for access-denial proof)
 *   - 1 private PDF stored under var/storage/private/ from knowledge/synthetic/
 *   - 5 bilingual chapters with private synthetic WAV audio companions
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  REPO_ROOT,
  SEED_MANIFEST_PATH,
  isProduction,
  ensureDirs,
} from "../src/config.js";
import {
  initializePersistence,
  closePersistenceAdapter,
} from "../src/persistence/adapter.js";
import {
  createUserAsync,
  findUserByEmailAsync,
} from "../src/security/authz.js";
import {
  createDocumentAsync,
  listDocumentsAsync,
  addChapterAsync,
  listChaptersAsync,
  grantEntitlementAsync,
} from "../src/services/content.js";
import { putPrivateObject } from "../src/services/storage.js";
import { probePdf } from "../src/services/pdf-engine.js";
import { generateSyntheticTeachingWav } from "../src/services/synthetic-audio.js";
import { setDemoDocId } from "../src/routes.js";

export const DEMO_ACCOUNTS = {
  admin: {
    email: "admin@strata.local",
    displayName: "Dr. Lim — STRATA Admin (Synthetic)",
    role: "admin",
    locale: "en",
  },
  studentA: {
    email: "aisyah@student.strata.local",
    displayName: "Nurul Aisyah (Synthetic Student A)",
    role: "student",
    locale: "en",
  },
  studentB: {
    email: "weiming@student.strata.local",
    displayName: "Tan Wei Ming (Synthetic Student B)",
    role: "student",
    locale: "zh",
  },
  studentC: {
    email: "priya@student.strata.local",
    displayName: "Priya Menon (Synthetic Student C)",
    role: "student",
    locale: "en",
  },
};

const SYNTHETIC_CHAPTERS = [
  {
    ordinal: 1,
    titleEn: "Chapter 1 — Orientation to the Neurological Consultation",
    titleZh: "第一章 — 神经科问诊结构导论",
    startPage: 1,
    endPage: 2,
    durationSeconds: 8,
  },
  {
    ordinal: 2,
    titleEn: "Chapter 2 — Reading EEG: Pattern Recognition",
    titleZh: "第二章 — 脑电图判读与波形识别",
    startPage: 3,
    endPage: 3,
    durationSeconds: 8,
  },
  {
    ordinal: 3,
    titleEn: "Chapter 3 — Neuro-ophthalmology Fundamentals",
    titleZh: "第三章 — 神经眼科学基础",
    startPage: 4,
    endPage: 4,
    durationSeconds: 8,
  },
  {
    ordinal: 4,
    titleEn: "Chapter 4 — Electrodiagnostic Case Approach",
    titleZh: "第四章 — 电诊断医学病例解析",
    startPage: 5,
    endPage: 5,
    durationSeconds: 8,
  },
  {
    ordinal: 5,
    titleEn: "Chapter 5 — Reflective Practice & Learning Record",
    titleZh: "第五章 — 反思性实践与学习记录",
    startPage: 6,
    endPage: 6,
    durationSeconds: 8,
  },
];

function resolveDemoPasswords() {
  return {
    adminPassword:
      process.env.CV_DEMO_ADMIN_PASSWORD || "strata-demo-admin-local",
    studentPassword:
      process.env.CV_DEMO_STUDENT_PASSWORD || "strata-demo-student-local",
  };
}

async function ensureAccountAsync(spec, password) {
  const seedActor = { role: "admin" };
  const existing = await findUserByEmailAsync(seedActor, spec.email);
  if (existing) {
    if (Number(existing.is_demo) !== 1) {
      const adapter = await initializePersistence();
      if (adapter.kind === "sqlite") {
        adapter._getDb().prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(existing.id);
      } else {
        await adapter.withActorContext(seedActor, (tx) =>
          tx.query("UPDATE users SET is_demo = TRUE WHERE id = $1", [existing.id]),
        );
      }
      return findUserByEmailAsync(seedActor, spec.email);
    }
    return existing;
  }
  return createUserAsync(seedActor, {
    email: spec.email,
    password,
    displayName: spec.displayName,
    role: spec.role,
    locale: spec.locale,
    isDemo: true,
  });
}

export async function seedDemoEnvironment() {
  if (isProduction()) {
    throw new Error(
      "SEC-002 violation: Demo seeding is prohibited when NODE_ENV=production.",
    );
  }
  ensureDirs();
  await initializePersistence();
  const { adminPassword, studentPassword } = resolveDemoPasswords();

  const admin = await ensureAccountAsync(DEMO_ACCOUNTS.admin, adminPassword);
  const studentA = await ensureAccountAsync(DEMO_ACCOUNTS.studentA, studentPassword);
  const studentB = await ensureAccountAsync(DEMO_ACCOUNTS.studentB, studentPassword);
  const studentC = await ensureAccountAsync(DEMO_ACCOUNTS.studentC, studentPassword);

  const syntheticPdfPath = path.join(
    REPO_ROOT,
    "knowledge",
    "synthetic",
    "synthetic-neurology-module.pdf",
  );
  if (!fs.existsSync(syntheticPdfPath)) {
    throw new Error(`Synthetic PDF not found at ${syntheticPdfPath}`);
  }

  const demoTitleEn = "Neurology Teaching Module (Synthetic Demonstration)";
  const allDocs = await listDocumentsAsync(admin);
  let document = allDocs.find((doc) => doc.title_en === demoTitleEn);

  if (!document) {
    const pdfBytes = fs.readFileSync(syntheticPdfPath);
    const probe = await probePdf(syntheticPdfPath);
    const storedPdf = await putPrivateObject(pdfBytes, "pdf");

    document = await createDocumentAsync(admin, {
      titleEn: demoTitleEn,
      titleZh: "神经病学教学示范单元（合成演示内容）",
      author: "STRATA Medical AI Research Lab (Synthetic)",
      description:
        "Synthetic 6-page module demonstrating server-side rasterisation, personalized per-learner watermarking, chapter navigation, and entitled audio companions. Contains no clinical guidance or proprietary content.",
      storageKey: storedPdf.key,
      contentHash: storedPdf.contentHash,
      byteSize: storedPdf.byteSize,
      pageCount: probe.pageCount,
      synthetic: true,
      uploadedBy: admin.id,
    });
  }

  const existingChapters = await listChaptersAsync(admin, document.id);
  if (existingChapters.length === 0) {
    for (const ch of SYNTHETIC_CHAPTERS) {
      const wavBuffer = generateSyntheticTeachingWav({
        chapterOrdinal: ch.ordinal,
        durationSeconds: ch.durationSeconds,
      });
      const storedAudio = await putPrivateObject(wavBuffer, "wav");
      await addChapterAsync(admin, {
        documentId: document.id,
        ordinal: ch.ordinal,
        titleEn: ch.titleEn,
        titleZh: ch.titleZh,
        startPage: ch.startPage,
        endPage: Math.min(ch.endPage, document.page_count),
        audioKey: storedAudio.key,
        audioMime: "audio/wav",
        audioSeconds: ch.durationSeconds,
      });
    }
  }

  // Grant access to Student A and Student B; leave Student C unentitled.
  await grantEntitlementAsync(admin, {
    userId: studentA.id,
    documentId: document.id,
    grantedBy: admin.id,
    reason: "seed_demo_student_a",
  });
  await grantEntitlementAsync(admin, {
    userId: studentB.id,
    documentId: document.id,
    grantedBy: admin.id,
    reason: "seed_demo_student_b",
  });

  setDemoDocId(document.id);

  const manifest = {
    demoDocumentId: document.id,
    seededAt: new Date().toISOString(),
    accounts: {
      admin: admin.email,
      studentA: studentA.email,
      studentB: studentB.email,
      studentC: studentC.email,
    },
  };
  fs.writeFileSync(SEED_MANIFEST_PATH, JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });

  const chapters = await listChaptersAsync(admin, document.id);

  return {
    admin,
    studentA,
    studentB,
    studentC,
    document,
    chaptersCount: chapters.length,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  seedDemoEnvironment()
    .then(async (summary) => {
      console.log("STRATA ContentVault synthetic seed complete:");
      console.log(`  Document:   ${summary.document.id} (${summary.document.page_count} pages, ${summary.chaptersCount} chapters)`);
      console.log(`  Admin:      ${summary.admin.email}`);
      console.log(`  Student A:  ${summary.studentA.email} [entitled]`);
      console.log(`  Student B:  ${summary.studentB.email} [entitled]`);
      console.log(`  Student C:  ${summary.studentC.email} [unentitled]`);
      await closePersistenceAdapter();
    })
    .catch(async (error) => {
      console.error("Seed failed:", error.message);
      await closePersistenceAdapter().catch(() => {});
      process.exit(1);
    });
}
