/**
 * STRATA ContentVault - central configuration.
 *
 * All secrets are read from the environment. Nothing here may be imported
 * by a browser bundle; this file lives in the API app only.
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

export const PORT = Number(process.env.PORT || 7410);
export const HOST = process.env.HOST || "127.0.0.1";

/**
 * Signing secret for session and token signatures.
 *
 * In development a local secret file is generated so the project runs without
 * manual setup. In production (NODE_ENV=production) a real CV_SIGNING_SECRET is
 * mandatory and the server refuses to start without it.
 */
function resolveSigningSecret() {
  const fromEnv = process.env.CV_SIGNING_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    throw new Error(
      "CV_SIGNING_SECRET (>=32 chars) is required when NODE_ENV=production.",
    );
  }
  if (fromEnv) {
    // Too short but present: refuse rather than silently weaken crypto.
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

/** Session lifetime for a logged-in user (rolling). */
export const SESSION_IDLE_MINUTES = Number(process.env.CV_SESSION_IDLE_MINUTES || 120);

/**
 * The page access token is deliberately short-lived. It authorizes ONE
 * page-image request for ONE student, and is bound to their entitlement
 * version so revocation invalidates outstanding tokens immediately.
 */
export const PAGE_TOKEN_TTL_SECONDS = Number(process.env.CV_PAGE_TOKEN_TTL || 45);

/** Signed audio URL lifetime. */
export const AUDIO_TOKEN_TTL_SECONDS = Number(process.env.CV_AUDIO_TOKEN_TTL || 60);

/** Render geometry. */
export const RENDER_DPI = Number(process.env.CV_RENDER_DPI || 144);
export const MAX_RASTER_DIMENSION = 2600;

/** Upload guard rails. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;

/** Bilingual UI + content locales supported by the prototype. */
export const SUPPORTED_LOCALES = ["en", "zh"];

export function ensureDirs() {
  for (const dir of [DATA_DIR, STORAGE_DIR, CACHE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

