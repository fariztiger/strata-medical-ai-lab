/**
 * Minimal HTTP helpers: body parsing with limits, JSON responses, cookies,
 * and the security headers applied to every response.
 */

import crypto from "node:crypto";

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

/** Read a raw binary body (used for PDF upload) with an explicit cap. */
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
  "frame-ancestors 'none'",
  "object-src 'none'",
];

/**
 * Headers for HTML/JS/CSS responses.
 * Inline styles are allowed because the reader uses a few computed style
 * attributes; inline scripts are not.
 */
export function htmlSecurityHeaders() {
  return {
    "Content-Security-Policy": [
      ...BASE_CSP,
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "media-src 'self'",
      "connect-src 'self'",
      "font-src 'self'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  };
}

/**
 * Headers for protected images and audio.
 *
 * - `no-store` so a rendered page is never written to a shared cache.
 * - `no-cache, private` is the fallback for browsers that ignore no-store.
 * - `X-Robots-Tag` keeps pages out of search indexes if a URL leaks.
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

export function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { ok: false, error: code, message, ...extra });
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
  return parts.join("; ");
}

export function clearCookie(name) {
  return serializeCookie(name, "", { maxAge: 0 });
}

export function isSecureRequest(req) {
  return (
    Boolean(req.socket?.encrypted) ||
    String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https"
  );
}

/* ------------------------------------------------------------------ */
/* Rate limiting (in-memory, fixed window)                             */
/* ------------------------------------------------------------------ */

const buckets = new Map();

/**
 * Simple in-memory limiter for login and page requests.
 * Deliberately simple for the prototype; a distributed limiter is required for
 * any multi-instance deployment (documented in known limitations).
 */
export function rateLimit(key, limit, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: limit - 1 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.ceil((windowMs - (now - bucket.start)) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: limit - bucket.count };
}

export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || "unknown").slice(0, 64);
}

/** CSRF-style protection: mutating requests must be same-origin JSON. */
export function isSameOriginMutating(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests) authenticate via cookie anyway
  try {
    const parsed = new URL(origin);
    const host = String(req.headers.host || "");
    return parsed.host === host;
  } catch {
    return false;
  }
}

export function requestId() {
  return crypto.randomBytes(8).toString("hex");
}
