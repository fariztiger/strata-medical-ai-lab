/**
 * Password hashing and signed-token primitives.
 *
 * - Passwords: scrypt with a per-user random salt and constant-time compare.
 * - Tokens: HMAC-SHA256 over a versioned payload with a server-only secret.
 */

import crypto from "node:crypto";
import { resolveSigningSecret, resolveVerificationSecrets } from "../config.js";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString(
    "base64",
  )}$${derived.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    if (typeof password !== "string" || typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * 1024 * 1024,
    });
    return (
      derived.length === expected.length &&
      crypto.timingSafeEqual(derived, expected)
    );
  } catch {
    return false;
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function signWithSecret(payloadB64, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
}

function sign(payloadB64) {
  return signWithSecret(payloadB64, resolveSigningSecret());
}

/**
 * Create a compact signed token: base64url(json).base64url(hmac)
 * No algorithm header, so there is no `alg: none` confusion class.
 */
export function signToken(payload, ttlSeconds, purpose) {
  if (!purpose) throw new Error("Token purpose is required.");
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    purpose,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(9).toString("base64url"),
  };
  const encoded = b64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded)}`;
}

export class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

/**
 * Verify signature first (constant time), then purpose, then expiry.
 * Returns the decoded payload or throws TokenError.
 */
export function verifyToken(token, purpose) {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new TokenError("malformed", "Token is malformed.");
  }
  const [encoded, provided] = token.split(".");
  if (!encoded || !provided) {
    throw new TokenError("malformed", "Token is malformed.");
  }
  const providedBuf = Buffer.from(provided, "utf8");
  const candidateSecrets = resolveVerificationSecrets();
  let sigValid = false;
  for (const secret of candidateSecrets) {
    const expectedBuf = Buffer.from(signWithSecret(encoded, secret), "utf8");
    if (
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      sigValid = true;
      break;
    }
  }
  if (!sigValid) {
    throw new TokenError("bad_signature", "Token signature is invalid.");
  }
  let body;
  try {
    body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new TokenError("malformed", "Token payload is malformed.");
  }
  if (!body || typeof body !== "object") {
    throw new TokenError("malformed", "Token payload is malformed.");
  }
  if (body.purpose !== purpose) {
    throw new TokenError("bad_purpose", "Token purpose mismatch.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof body.exp !== "number" || now > body.exp) {
    throw new TokenError("expired", "Token has expired.");
  }
  return body;
}

/** Opaque random identifier used for sessions, documents and audits. */
export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Constant-time string comparison for non-crypto identifiers. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}


