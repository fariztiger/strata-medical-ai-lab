/**
 * STRATA ContentVault - central configuration (Mission 005).
 *
 * All secrets, database backends, worker limits, and trust boundaries are read
 * dynamically from environment variables and validated fail-closed at startup.
 */

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
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

/** Data directory holds the private storage bucket, render cache, and local SQLite DB. */
export const DATA_DIR = process.env.CV_DATA_DIR
  ? path.resolve(process.env.CV_DATA_DIR)
  : path.join(REPO_ROOT, "var");

/** Private object store. Equivalent to a private cloud bucket. */
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
 * Resolve active persistence backend (`postgres` vs `sqlite`).
 *
 * Fail-closed invariants (Mission 005 Phase A):
 *   - Setting `DATABASE_URL`, `CV_DB_BACKEND=postgres`, `CV_DB_ADAPTER=postgres`,
 *     or `CV_REQUIRE_POSTGRES=1` activates PostgreSQL and NEVER falls back to SQLite.
 *   - Unknown backend names or malformed/missing PostgreSQL URLs throw immediately.
 */
export function resolveDbBackend() {
  const explicitRaw = String(
    process.env.CV_DB_BACKEND || process.env.CV_DB_ADAPTER || "",
  )
    .trim()
    .toLowerCase();
  const requirePg = process.env.CV_REQUIRE_POSTGRES === "1";
  const dbUrl = String(process.env.DATABASE_URL || "").trim();

  if (explicitRaw && !["sqlite", "postgres", "postgresql"].includes(explicitRaw)) {
    throw new Error(
      `SEC-DB-001: Unsupported database backend '${explicitRaw}'. Expected 'postgres' or 'sqlite'.`,
    );
  }

  if (explicitRaw === "sqlite") {
    if (requirePg || (isProduction() && dbUrl)) {
      throw new Error(
        "SEC-DB-001: Refusing to use SQLite when PostgreSQL is required (CV_REQUIRE_POSTGRES=1 or DATABASE_URL set in production).",
      );
    }
    return "sqlite";
  }

  if (explicitRaw === "postgres" || explicitRaw === "postgresql" || requirePg || dbUrl) {
    if (!dbUrl) {
      throw new Error(
        "SEC-DB-001: DATABASE_URL is required when PostgreSQL backend is active.",
      );
    }
    if (!/^postgres(ql)?:\/\/.+/i.test(dbUrl)) {
      throw new Error(
        "SEC-DB-001: DATABASE_URL must use a valid postgres:// or postgresql:// scheme.",
      );
    }
    return "postgres";
  }

  return "sqlite";
}

/**
 * Build `pg.Pool` connection options including TLS verification (`AUD-D3`).
 */
export function buildPgPoolConfig(connectionString = process.env.DATABASE_URL) {
  const url = String(connectionString || "").trim();
  if (!/^postgres(ql)?:\/\/.+/i.test(url)) {
    throw new Error("SEC-DB-001: Valid PostgreSQL connection string is required.");
  }

  const sslModeRaw = String(
    process.env.CV_PG_SSL_MODE || (isProduction() ? "require" : "disable"),
  )
    .trim()
    .toLowerCase();

  if (!["disable", "require", "verify-ca", "verify-full"].includes(sslModeRaw)) {
    throw new Error(
      `SEC-DB-002: Invalid CV_PG_SSL_MODE '${sslModeRaw}'. Expected disable|require|verify-ca|verify-full.`,
    );
  }

  let ssl = false;
  if (sslModeRaw !== "disable") {
    const caFile = String(process.env.CV_PG_SSL_CA_FILE || "").trim();
    const ca = caFile ? fs.readFileSync(caFile, "utf8") : undefined;
    ssl = {
      rejectUnauthorized: sslModeRaw === "verify-ca" || sslModeRaw === "verify-full",
      ...(ca ? { ca } : {}),
    };
  }

  return {
    connectionString: url,
    max: Math.max(2, Number(process.env.CV_PG_POOL_MAX || 12)),
    idleTimeoutMillis: Math.max(1000, Number(process.env.CV_PG_IDLE_TIMEOUT_MS || 30_000)),
    connectionTimeoutMillis: Math.max(
      1000,
      Number(process.env.CV_PG_CONN_TIMEOUT_MS || 5_000),
    ),
    statement_timeout: Math.max(1000, Number(process.env.CV_PG_STATEMENT_TIMEOUT_MS || 15_000)),
    ssl,
  };
}

/**
 * SEC-002: Demo personas are DISABLED by default and strictly forbidden in production.
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
 * SEC-003: Trusted reverse-proxy list (comma-separated IPv4/IPv6 IPs or CIDRs).
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
 * Compute first-order Shannon character distribution bits/char (sanity heuristic ONLY).
 * NOTE (AUD-D3): Character-frequency entropy CANNOT prove cryptographic randomness!
 * Production secrets MUST be generated by an OS CSPRNG (`openssl rand -hex 48` or
 * `crypto.randomBytes(48)`). Startup checks combine length, character diversity,
 * and DEFLATE compressibility solely to block weak/repeated placeholder strings.
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

function readCheckedSecretFile(envVarName) {
  const secretFile = String(process.env[envVarName] || "").trim();
  if (!secretFile) return "";
  if (!fs.existsSync(secretFile)) {
    throw new Error(`${envVarName} does not exist: ${secretFile}`);
  }
  if (isProduction() && process.platform !== "win32") {
    const mode = fs.statSync(secretFile).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `SEC-002 violation: ${envVarName} permissions (${mode.toString(8)}) are too open; expected 0600 or 0400 in production.`,
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
    // AUD-D3: Also reject periodic/repeating strings (e.g. '0123456789abcdef'.repeat(4))
    // whose character distribution looks uniform (`4.0 bits/char`) but compress trivially.
    const rawBuf = Buffer.from(secret, "utf8");
    const compressedBytes = zlib.deflateRawSync(rawBuf, { level: 9 }).length;
    const compressionRatio = compressedBytes / rawBuf.length;

    if (distinctChars < 12 || entropy < 3.5 || compressionRatio < 0.55) {
      throw new Error(
        `SEC-002 violation: ${label} appears weak, low-entropy, or periodically repeated (${entropy.toFixed(2)} bits/char, ${distinctChars} unique chars, compressionRatio=${compressionRatio.toFixed(2)}). Secrets MUST be generated via CSPRNG ('openssl rand -hex 48').`,
      );
    }
  }
}

/**
 * Resolve primary signing secret (`CV_SIGNING_SECRET_FILE` or `CV_SIGNING_SECRET`).
 */
export function resolveSigningSecret() {
  const fromFile = readCheckedSecretFile("CV_SIGNING_SECRET_FILE");
  const candidate = fromFile || String(process.env.CV_SIGNING_SECRET || "");

  if (candidate) {
    assertSecretQuality(candidate, fromFile ? "CV_SIGNING_SECRET_FILE" : "CV_SIGNING_SECRET");
    return candidate;
  }

  if (isProduction()) {
    throw new Error(
      "CV_SIGNING_SECRET or CV_SIGNING_SECRET_FILE (CSPRNG >=32 chars) is required when NODE_ENV=production.",
    );
  }

  ensureDirs();
  const secretFile = path.join(DATA_DIR, ".dev-signing-secret");
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, "utf8").trim();
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

/** Maximum allowed key-rotation overlap window in production (24 hours). */
export const MAX_ROTATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve verification secrets (`[primary]` or `[primary, previous]`) with
 * enforced rotation-window expiry (`CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT`, AUD-D3).
 */
export function resolveVerificationSecrets() {
  const primary = resolveSigningSecret();
  const prevFromFile = readCheckedSecretFile("CV_SIGNING_SECRET_PREVIOUS_FILE");
  const previous = prevFromFile || String(process.env.CV_SIGNING_SECRET_PREVIOUS || "").trim();
  if (!previous || previous === primary) return [primary];

  assertSecretQuality(
    previous,
    prevFromFile ? "CV_SIGNING_SECRET_PREVIOUS_FILE" : "CV_SIGNING_SECRET_PREVIOUS",
  );

  const expiresRaw = String(process.env.CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT || "").trim();
  if (isProduction() && !expiresRaw) {
    throw new Error(
      "SEC-002 violation: CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT (ISO-8601, <=24h window) is required in production when rotating signing keys.",
    );
  }
  if (expiresRaw) {
    const expMs = Date.parse(expiresRaw);
    if (!Number.isFinite(expMs)) {
      throw new Error("SEC-002 violation: CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT is not a valid ISO-8601 timestamp.");
    }
    const now = Date.now();
    if (isProduction() && expMs - now > MAX_ROTATION_WINDOW_MS) {
      throw new Error(
        "SEC-002 violation: CV_SIGNING_SECRET_PREVIOUS_EXPIRES_AT exceeds the maximum 24-hour rotation overlap window.",
      );
    }
    if (now >= expMs) {
      // Rotation overlap window has cleanly expired — reject tokens signed with previous key.
      return [primary];
    }
  }

  return [primary, previous];
}

export const SIGNING_SECRET = resolveSigningSecret();

/** Session rolling idle lifetime (minutes) and absolute max lifetime (hours). */
export const SESSION_IDLE_MINUTES = Number(process.env.CV_SESSION_IDLE_MINUTES || 120);
export const SESSION_MAX_HOURS = Number(process.env.CV_SESSION_MAX_HOURS || 12);

/** Attack-resistant rate limiting & credential-stuffing backpressure (Mission 005 Phase C). */
export const RATE_LIMIT_MAX_BUCKETS = Number(process.env.CV_RATE_LIMIT_MAX_BUCKETS || 10_000);
export const LOGIN_IP_LIMIT_PER_MINUTE = Number(process.env.CV_LOGIN_IP_LIMIT || 25);
export const LOGIN_PAIR_FAIL_LIMIT = Number(process.env.CV_LOGIN_PAIR_FAIL_LIMIT || 5);
export const LOGIN_ACCOUNT_FAIL_LIMIT = Number(process.env.CV_LOGIN_ACCOUNT_FAIL_LIMIT || 8);
/** Bad-password scrypt failure budget per account (only incremented on FAILED attempts, AUD-D1!). */
export const LOGIN_GLOBAL_FAIL_BUDGET = Number(
  process.env.CV_LOGIN_GLOBAL_FAIL_BUDGET || process.env.CV_LOGIN_GLOBAL_CPU_CEILING || 30,
);
export const LOGIN_GLOBAL_CPU_CEILING = LOGIN_GLOBAL_FAIL_BUDGET;
/** Reserved clean-IP verification slots per account so botnets cannot lock out valid owners (AUD-D1). */
export const LOGIN_CLEAN_IP_VERIFY_CEILING = Number(
  process.env.CV_LOGIN_CLEAN_IP_VERIFY_CEILING || 120,
);
/** Bounded concurrent in-flight scrypt password verifications per Node process (CPU backpressure). */
export const LOGIN_MAX_CONCURRENT_SCRYPT = Math.max(
  1,
  Number(process.env.CV_LOGIN_MAX_CONCURRENT_SCRYPT || 8),
);
export const LOGIN_ACCOUNT_WINDOW_SECONDS = Number(
  process.env.CV_LOGIN_ACCOUNT_WINDOW_SECONDS || 300,
);

/** SEC-005 Token lifetimes. */
export const PAGE_TOKEN_TTL_SECONDS = Number(process.env.CV_PAGE_TOKEN_TTL || 45);
export const AUDIO_TOKEN_TTL_SECONDS = Number(process.env.CV_AUDIO_TOKEN_TTL || 60);

/** Render geometry, bounded worker concurrency & cache limits (Mission 005 Phase D). */
export const RENDER_DPI = Number(process.env.CV_RENDER_DPI || 144);
export const PDF_ENGINE = String(process.env.CV_PDF_ENGINE || "pypdfium2")
  .trim()
  .toLowerCase();
export const WORKER_MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.CV_WORKER_MAX_CONCURRENCY || 4),
);
export const WORKER_MAX_QUEUE = Math.max(
  0,
  Number(process.env.CV_WORKER_MAX_QUEUE ?? 24),
);
export const WORKER_MAX_PER_USER = Math.max(
  1,
  Number(process.env.CV_WORKER_MAX_PER_USER || 2),
);
export const WORKER_TIMEOUT_MS = Math.max(
  50,
  Number(process.env.CV_WORKER_TIMEOUT_MS || 20_000),
);
export const WORKER_KILL_GRACE_MS = Math.max(
  25,
  Number(process.env.CV_WORKER_KILL_GRACE_MS || 500),
);
export const RENDER_CACHE_MAX_BYTES = Math.max(
  64 * 1024,
  Number(process.env.CV_RENDER_CACHE_MAX_BYTES || 128 * 1024 * 1024),
);
export const RENDER_CACHE_TTL_MS = Math.max(
  1_000,
  Number(process.env.CV_RENDER_CACHE_TTL_MS || 24 * 60 * 60 * 1000),
);
export const MIN_FREE_DISK_BYTES = Math.max(
  0,
  Number(process.env.CV_MIN_FREE_DISK_BYTES || 32 * 1024 * 1024),
);

/** Upload safety caps. */
export const MAX_UPLOAD_BYTES = Number(process.env.CV_MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
export const MAX_PDF_PAGES = Number(process.env.CV_MAX_PDF_PAGES || 500);

/** Bilingual UI + content locales supported by the prototype. */
export const SUPPORTED_LOCALES = ["en", "zh"];

/**
 * SEC-002: Enforce production configuration invariants before accepting traffic.
 */
export function assertProductionSafety(db = null, activeDemoCount = null) {
  if (!isProduction()) return;

  resolveSigningSecret();
  resolveVerificationSecrets();
  resolveDbBackend();

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

  let count = activeDemoCount;
  if (count === null && db && typeof db.prepare === "function") {
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
    count = activeDemoRow?.n ?? 0;
  }
  if ((count ?? 0) > 0) {
    throw new Error(
      "SEC-002 violation: Active seeded demonstration accounts detected in database; refusing production startup.",
    );
  }
}

/**
 * Ensure private runtime directories exist with restricted owner-only permissions (`0700`, AUD-D3).
 */
export function ensureDirs() {
  for (const dir of [DATA_DIR, STORAGE_DIR, CACHE_DIR]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        /* ignore if directory is owned by container volume mount */
      }
    }
  }
}
