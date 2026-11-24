/**
 * Minimal HTTP helpers: body parsing with limits, JSON responses, cookies,
 * trusted-proxy boundary enforcement (SEC-003), and security headers.
 */

import crypto from "node:crypto";
import net from "node:net";
import {
  getTrustedProxies,
  isFrameEmbedAllowed,
  RATE_LIMIT_MAX_BUCKETS,
} from "../config.js";
import { getDb } from "../db.js";
import {
  sharedSqliteRateLimit,
  getPersistenceAdapter,
} from "../persistence/adapter.js";

export const MAX_JSON_BYTES = 1024 * 256;

export function readBody(req, limit = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Read a raw binary body (used for PDF/audio upload) with an explicit cap. */
export function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Upload exceeds the size limit."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJson(req, limit = MAX_JSON_BYTES) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  const type = String(req.headers["content-type"] || "");
  if (!type.includes("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json."), {
      statusCode: 415,
    });
  }
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw Object.assign(new Error("Request body is not valid JSON."), {
      statusCode: 400,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Security headers                                                    */
/* ------------------------------------------------------------------ */

const BASE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
];

/**
 * Headers for HTML/JS/CSS responses.
 * SEC-002: Frame embedding is strictly disabled in production via isFrameEmbedAllowed().
 */
export function htmlSecurityHeaders() {
  const allowEmbed = isFrameEmbedAllowed();
  const frameAncestors = allowEmbed ? "frame-ancestors *" : "frame-ancestors 'none'";
  const headers = {
    "Content-Security-Policy": [
      ...BASE_CSP,
      frameAncestors,
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": allowEmbed ? "cross-origin" : "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  };
  if (!allowEmbed) {
    headers["X-Frame-Options"] = "DENY";
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
  }
  return headers;
}

/**
 * Headers for protected images and audio.
 */
export function protectedAssetHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "Content-Disposition": "inline",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    ...htmlSecurityHeaders(),
    ...headers,
  });
  res.end(body);
}

export function sendError(res, status, code, message, extra = {}, headers = {}) {
  sendJson(res, status, { ok: false, error: code, message, ...extra }, headers);
}

export function sendBuffer(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    ...extraHeaders,
  });
  res.end(buffer);
}

export function sendText(res, status, text, contentType = "text/plain; charset=utf-8", headers = {}) {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    ...htmlSecurityHeaders(),
    ...headers,
  });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Strict"}`);
  if (options.secure) parts.push("Secure");
  if (options.partitioned) parts.push("Partitioned");
  return parts.join("; ");
}

export function clearCookie(name) {
  return serializeCookie(name, "", { maxAge: 0 });
}

/* ------------------------------------------------------------------ */
/* SEC-003: Trusted Proxy Validation & Rate Limiting                   */
/* ------------------------------------------------------------------ */

export function normalizeIp(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("::ffff:")) {
    const v4 = trimmed.slice(7);
    if (net.isIPv4(v4)) return v4;
  }
  if (trimmed === "::1") return "127.0.0.1";
  return net.isIP(trimmed) ? trimmed : "";
}

function ipv4ToInt(ip) {
  return ip
    .split(".")
    .reduce((acc, oct) => ((acc << 8) + Number.parseInt(oct, 10)) >>> 0, 0);
}

function matchesTrustedSpec(ip, spec) {
  const cleanIp = normalizeIp(ip);
  if (!cleanIp) return false;
  if (spec === "loopback") {
    return cleanIp === "127.0.0.1";
  }
  if (spec.includes("/")) {
    const [base, prefixRaw] = spec.split("/");
    const cleanBase = normalizeIp(base);
    const prefix = Number.parseInt(prefixRaw, 10);
    if (net.isIPv4(cleanIp) && net.isIPv4(cleanBase) && prefix >= 0 && prefix <= 32) {
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      return (ipv4ToInt(cleanIp) & mask) === (ipv4ToInt(cleanBase) & mask);
    }
    return false;
  }
  return cleanIp === normalizeIp(spec);
}

export function isTrustedProxyIp(ip) {
  const trusted = getTrustedProxies();
  if (trusted.length === 0) return false;
  return trusted.some((spec) => matchesTrustedSpec(ip, spec));
}

export function isFromTrustedProxy(req) {
  const peerIp = normalizeIp(req.socket?.remoteAddress);
  return Boolean(peerIp) && isTrustedProxyIp(peerIp);
}

/**
 * Resolve the true client IP address (SEC-003):
 * - By default (CV_TRUST_PROXY unset), X-Forwarded-For is completely ignored
 *   and the TCP peer address is returned.
 * - When the TCP peer is in CV_TRUST_PROXY, X-Forwarded-For hops are walked
 *   from right to left, stopping at the first non-trusted valid IP so an
 *   external client cannot spoof a left-most X-Forwarded-For value.
 */
export function clientIp(req) {
  const peerIp = normalizeIp(req.socket?.remoteAddress) || "unknown";
  if (!isTrustedProxyIp(peerIp)) {
    return peerIp.slice(0, 64);
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded.trim()) {
    return peerIp.slice(0, 64);
  }

  const hops = forwarded
    .split(",")
    .map((h) => normalizeIp(h))
    .filter(Boolean);

  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!isTrustedProxyIp(hops[i])) {
      return hops[i].slice(0, 64);
    }
  }
  return (hops[0] || peerIp).slice(0, 64);
}

export function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  if (isFromTrustedProxy(req)) {
    return String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  }
  return false;
}

/**
 * Shared & strictly bounded fixed-window rate limiter backed by SQLite
 * (`rate_limit_buckets`) locally and `PostgresPersistenceAdapter` in multi-replica
 * deployments. Caps active buckets at `RATE_LIMIT_MAX_BUCKETS` (default 10,000)
 * with oldest-expiry eviction so key-spray attacks cannot exhaust memory/disk.
 */
export function rateLimit(key, limit, windowSeconds, options = {}) {
  const maxBuckets = Number(options.maxBuckets || RATE_LIMIT_MAX_BUCKETS);
  return sharedSqliteRateLimit(getDb(), key, limit, windowSeconds, {
    increment: options.increment !== false,
    maxBuckets,
    protectLockout: Boolean(options.protectLockout),
  });
}

export async function rateLimitAsync(key, limit, windowSeconds, options = {}) {
  const adapter = await getPersistenceAdapter();
  return adapter.rateLimit(key, limit, windowSeconds, {
    increment: options.increment !== false,
    maxBuckets: Number(options.maxBuckets || RATE_LIMIT_MAX_BUCKETS),
    protectLockout: Boolean(options.protectLockout),
  });
}

export function clearRateLimit(key) {
  getDb()
    .prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ?")
    .run(String(key || "").slice(0, 256));
}

export async function clearRateLimitAsync(key) {
  const adapter = await getPersistenceAdapter();
  await adapter.clearRateLimit(key);
}

/** CSRF-style protection: mutating requests must match Host (honoring X-Forwarded-Host ONLY from trusted proxies). */
export function isSameOriginMutating(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const directHost = String(req.headers.host || "").trim();
    if (parsed.host === directHost) return true;
    if (isFromTrustedProxy(req)) {
      const forwardedHost = String(req.headers["x-forwarded-host"] || "")
        .split(",")[0]
        .trim();
      if (forwardedHost && parsed.host === forwardedHost) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function requestId() {
  return crypto.randomBytes(8).toString("hex");
}
