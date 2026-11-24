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
 * Compute Shannon entropy in bits per character.
 */
export function shannonEntropyBitsPerChar(secret) {
  const str = String(secret || "");
  if (!str.length) return 0;
  const freq = new Map();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function readSecretFromFileIfConfigured() {
  const secretFile = String(process.env.CV_SIGNING_SECRET_FILE || "").trim();
  if (!secretFile) return "";
  if (!fs.existsSync(secretFile)) {
    throw new Error(`CV_SIGNING_SECRET_FILE does not exist: ${secretFile}`);
  }
  if (isProduction() && process.platform !== "win32") {
    const mode = fs.statSync(secretFile).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `SEC-002 violation: CV_SIGNING_SECRET_FILE permissions (${mode.toString(8)}) are too open; expected 0600 or 0400 in production.`,
      );
    }
  }
  return fs.readFileSync(secretFile, "utf8").trim();
}

function assertSecretQuality(secret, label = "CV_SIGNING_SECRET") {
  if (secret.length < 32) {
    throw new Error(`${label} must be at least 32 characters long.`);
  }
  if (isProduction()) {
    const distinctChars = new Set(secret).size;
    const entropy = shannonEntropyBitsPerChar(secret);
    if (distinctChars < 12 || entropy < 3.5) {
      throw new Error(
        `SEC-002 violation: ${label} lacks sufficient cryptographic entropy (${entropy.toFixed(2)} bits/char, ${distinctChars} unique chars). Generate with 'openssl rand -hex 48'.`,
      );
    }
  }
}

/**
 * Signing secret for session and token signatures (Mission 004 Phase C).
 *
 * Supports `CV_SIGNING_SECRET_FILE` (container/systemd secret mount) or
 * `CV_SIGNING_SECRET`, enforces cryptographic entropy in production, and
 * supports optional `CV_SIGNING_SECRET_PREVIOUS` for zero-downtime rotation.
 */
export function resolveSigningSecret() {
  const fromFile = readSecretFromFileIfConfigured();
  const candidate = fromFile || String(process.env.CV_SIGNING_SECRET || "");

  if (candidate) {
    assertSecretQuality(candidate, fromFile ? "CV_SIGNING_SECRET_FILE" : "CV_SIGNING_SECRET");
    return candidate;
  }

  if (isProduction()) {
    throw new Error(
      "CV_SIGNING_SECRET or CV_SIGNING_SECRET_FILE (>=32 high-entropy chars) is required when NODE_ENV=production.",
    );
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

export function resolveVerificationSecrets() {
  const primary = resolveSigningSecret();
  const previous = String(process.env.CV_SIGNING_SECRET_PREVIOUS || "").trim();
  if (!previous) return [primary];
  assertSecretQuality(previous, "CV_SIGNING_SECRET_PREVIOUS");
  return previous === primary ? [primary] : [primary, previous];
}

export const SIGNING_SECRET = resolveSigningSecret();

/** Session rolling idle lifetime (minutes) and absolute max lifetime (hours). */
export const SESSION_IDLE_MINUTES = Number(process.env.CV_SESSION_IDLE_MINUTES || 120);
export const SESSION_MAX_HOURS = Number(process.env.CV_SESSION_MAX_HOURS || 12);

/** Shared & bounded rate-limiting + lockout DoS mitigation thresholds (SEC-003 / Phase C). */
export const RATE_LIMIT_MAX_BUCKETS = Number(process.env.CV_RATE_LIMIT_MAX_BUCKETS || 10_000);
export const LOGIN_IP_LIMIT_PER_MINUTE = Number(process.env.CV_LOGIN_IP_LIMIT || 25);
export const LOGIN_PAIR_FAIL_LIMIT = Number(process.env.CV_LOGIN_PAIR_FAIL_LIMIT || 5);
export const LOGIN_ACCOUNT_FAIL_LIMIT = Number(process.env.CV_LOGIN_ACCOUNT_FAIL_LIMIT || 8);
export const LOGIN_GLOBAL_CPU_CEILING = Number(process.env.CV_LOGIN_GLOBAL_CPU_CEILING || 30);
export const LOGIN_ACCOUNT_WINDOW_SECONDS = Number(process.env.CV_LOGIN_ACCOUNT_WINDOW_SECONDS || 300);

/**
 * SEC-005 Token lifetimes:
 * - PAGE_TOKEN_TTL_SECONDS: single-use page verification token (jti consumed on first use).
 * - AUDIO_TOKEN_TTL_SECONDS: bounded-window stream token permitting multi-Range HTTP 206
 *   playback requests for an authorized chapter while bound to entitlement version.
 */
export const PAGE_TOKEN_TTL_SECONDS = Number(process.env.CV_PAGE_TOKEN_TTL || 45);
export const AUDIO_TOKEN_TTL_SECONDS = Number(process.env.CV_AUDIO_TOKEN_TTL || 60);

/** Render geometry and modular PDF engine selection (Mission 004 Phase A). */
export const RENDER_DPI = Number(process.env.CV_RENDER_DPI || 144);
export const MAX_RASTER_DIMENSION = 2600;
export const PDF_ENGINE = String(process.env.CV_PDF_ENGINE || "pypdfium2")
  .trim()
  .toLowerCase();

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
