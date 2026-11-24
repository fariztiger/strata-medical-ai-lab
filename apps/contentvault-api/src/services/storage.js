/**
 * Private object storage.
 *
 * Mirrors a private cloud bucket: objects are written under a random key, live
 * outside any static-served directory, and are only ever read by server code
 * that has already made an authorisation decision.
 *
 * There is deliberately NO HTTP route that maps a URL onto a storage key.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { STORAGE_DIR, ensureDirs } from "../config.js";
import { newId } from "../security/crypto.js";

/** Reject anything that could escape the storage root. */
function assertSafeKey(key) {
  if (typeof key !== "string" || !key) {
    throw new Error("Storage key is required.");
  }
  if (key.includes("..") || key.includes("/") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Storage key contains an illegal path segment.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new Error("Storage key contains illegal characters.");
  }
}

export function keyToPath(key) {
  assertSafeKey(key);
  const resolved = path.resolve(STORAGE_DIR, key);
  const root = path.resolve(STORAGE_DIR);
  // Defence in depth: the resolved path must sit directly inside the root.
  if (path.dirname(resolved) !== root) {
    throw new Error("Resolved storage path escapes the private root.");
  }
  return resolved;
}

/**
 * Store a buffer privately. Returns the storage descriptor.
 * The object name is random, so page URLs cannot be guessed from a title.
 */
export async function putPrivateObject(buffer, extension = "pdf") {
  ensureDirs();
  const safeExt = /^[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : "bin";
  const key = `${newId("obj")}.${safeExt}`;
  const target = keyToPath(key);
  await fs.writeFile(target, buffer, { mode: 0o600 });
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  return { key, byteSize: buffer.length, contentHash: hash };
}

export function readPrivateObjectSync(key) {
  return fsSync.readFileSync(keyToPath(key));
}

export function privateObjectExists(key) {
  try {
    return fsSync.existsSync(keyToPath(key));
  } catch {
    return false;
  }
}

export function statPrivateObject(key) {
  const full = keyToPath(key);
  return fsSync.statSync(full);
}

export function createReadStream(key, options = {}) {
  return fsSync.createReadStream(keyToPath(key), options);
}

export async function deletePrivateObject(key) {
  try {
    await fs.unlink(keyToPath(key));
    return true;
  } catch {
    return false;
  }
}


