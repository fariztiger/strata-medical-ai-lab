/**
 * STRATA ContentVault - central configuration.
 *
 * All secrets and trust boundaries are read from environment variables and
 * validated dynamically where needed so production-mode checks are enforced
 * deterministically at server startup.
 */

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Locate the API package root by walking up to the nearest package.json. */
function findApiRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, "..");
}

export const API_ROOT = findApiRoot(__dirname);
export const REPO_ROOT = path.resolve(API_ROOT, "..", "..");

/** Data directory holds the private "storage bucket" and the SQLite database. */
export const DATA_DIR = process.env.CV_DATA_DIR
  ? path.resolve(process.env.CV_DATA_DIR)
  : path.join(REPO_ROOT, "var");

/** Private object store. Equivalent to a private Supabase Storage bucket. */
export const STORAGE_DIR = path.join(DATA_DIR, "storage", "private");
export const CACHE_DIR = path.join(DATA_DIR, "render-cache");
export const DB_PATH = path.join(DATA_DIR, "contentvault.db");
export const SEED_MANIFEST_PATH = path.join(DATA_DIR, "seed-manifest.json");
export const PUBLIC_DIR = path.join(API_ROOT, "public");
export const PORTFOLIO_PUBLIC_DIR = path.join(
  REPO_ROOT,
  "apps",
  "strata-website",
  "public",
);

export const PORT = Number(process.env.PORT || 7410);
export const HOST = process.env.HOST || "127.0.0.1";

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * SEC-002: Demo personas are DISABLED by default and strictly forbidden in production.
 * Must set CV_ENABLE_DEMO_PERSONAS=1 explicitly in local evaluation mode.
 */
export function isDemoPersonasEnabled() {
  return !isProduction() && process.env.CV_ENABLE_DEMO_PERSONAS === "1";
}

/**
 * SEC-002: Insecure iframe embedding and preview-session header fallback are
 * disabled by default and strictly forbidden when NODE_ENV=production.
 */
export function isFrameEmbedAllowed() {
  return !isProduction() && process.env.CV_ALLOW_FRAME_EMBED === "1";
}

/**
 * SEC-003: Trusted reverse-proxy list (comma-separated IPs or IPv4 CIDRs).
 * Empty / unset by default: X-Forwarded-* headers are NEVER trusted unless
 * the immediate TCP peer matches an entry in CV_TRUST_PROXY.
 */
export function getTrustedProxies() {
  const raw = String(process.env.CV_TRUST_PROXY || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Signing secret for session and token signatures.
 *
 * In development a local secret file is generated so the project runs without
 * manual setup. In production (NODE_ENV=production) a real CV_SIGNING_SECRET is
 * mandatory and the server refuses to start without it.
 */
export function resolveSigningSecret() {
  const fromEnv = process.env.CV_SIGNING_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (isProduction()) {
    throw new Error(
      "CV_SIGNING_SECRET (>=32 chars) is required when NODE_ENV=production.",
    );
  }
  if (fromEnv) {
    throw new Error("CV_SIGNING_SECRET must be at least 32 characters long.");
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const secretFile = path.join(DATA_DIR, ".dev-signing-secret");
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, "utf8").trim();
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const SIGNING_SECRET = resolveSigningSecret();

/** Session rolling idle lifetime (minutes) and absolute max lifetime (hours). */
export const SESSION_IDLE_MINUTES = Number(process.env.CV_SESSION_IDLE_MINUTES || 120);
export const SESSION_MAX_HOURS = Number(process.env.CV_SESSION_MAX_HOURS || 12);

/** Login rate-limiting thresholds (SEC-003). */
export const LOGIN_IP_LIMIT_PER_MINUTE = Number(process.env.CV_LOGIN_IP_LIMIT || 25);
export const LOGIN_ACCOUNT_FAIL_LIMIT = Number(process.env.CV_LOGIN_ACCOUNT_FAIL_LIMIT || 8);
export const LOGIN_ACCOUNT_WINDOW_SECONDS = Number(process.env.CV_LOGIN_ACCOUNT_WINDOW_SECONDS || 300);

/**
 * SEC-005 Token lifetimes:
 * - PAGE_TOKEN_TTL_SECONDS: single-use page verification token (jti consumed on first use).
 * - AUDIO_TOKEN_TTL_SECONDS: bounded-window stream token permitting multi-Range HTTP 206
 *   playback requests for an authorized chapter while bound to entitlement version.
 */
export const PAGE_TOKEN_TTL_SECONDS = Number(process.env.CV_PAGE_TOKEN_TTL || 45);
export const AUDIO_TOKEN_TTL_SECONDS = Number(process.env.CV_AUDIO_TOKEN_TTL || 60);

/** Render geometry. */
export const RENDER_DPI = Number(process.env.CV_RENDER_DPI || 144);
export const MAX_RASTER_DIMENSION = 2600;

/** Upload guard rails. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;

/** Bilingual UI + content locales supported by the prototype. */
export const SUPPORTED_LOCALES = ["en", "zh"];

/**
 * SEC-002: Enforce production configuration invariants before accepting traffic.
 * Throws immediately if unsafe flags or active seeded demonstration accounts exist.
 */
export function assertProductionSafety(db) {
  if (!isProduction()) return;

  resolveSigningSecret();

  if (process.env.CV_ENABLE_DEMO_PERSONAS === "1") {
    throw new Error(
      "SEC-002 violation: CV_ENABLE_DEMO_PERSONAS cannot be enabled when NODE_ENV=production.",
    );
  }
  if (process.env.CV_ALLOW_FRAME_EMBED === "1") {
    throw new Error(
      "SEC-002 violation: CV_ALLOW_FRAME_EMBED cannot be enabled when NODE_ENV=production.",
    );
  }

  if (db) {
    const activeDemoRow = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM users
         WHERE disabled_at IS NULL
           AND (is_demo = 1
                OR email LIKE '%@strata.local'
                OR email LIKE '%.strata.local')`,
      )
      .get();
    if ((activeDemoRow?.n ?? 0) > 0) {
      throw new Error(
        "SEC-002 violation: Active seeded demonstration accounts detected in database; refusing production startup.",
      );
    }
  }
}

export function ensureDirs() {
  for (const dir of [DATA_DIR, STORAGE_DIR, CACHE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
