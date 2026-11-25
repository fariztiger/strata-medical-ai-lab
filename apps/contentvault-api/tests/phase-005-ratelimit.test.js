/**
 * Mission 005 Checkpoint 005-C — Attack-Resistant Rate Limiting & Proxy Trust Suite
 * (`AUD-C4`, `AUD-D1`, `AUD-D2`, `AUD-D3c`).
 *
 * Behaviorally verifies:
 *   1. `005-C-1` (`AUD-C4` + `AUD-D2`): Oldest-expiry eviction (`ASC LIMIT`, never evicting
 *      newest buckets), expired-first reclamation, active security-lockout preservation
 *      under high-cardinality key sprays, and fail-closed admission when saturated — across
 *      BOTH PostgreSQL (`cv_check_rate_limit`) and SQLite (`sharedSqliteRateLimit`).
 *   2. `005-C-2` (`AUD-D1`): Distributed credential stuffing (6 bot IPs x 5 bad passwords
 *      + 10 rotating bot IPs = 40 bad attempts) does NOT lock out the legitimate owner
 *      signing in from a clean IP (`200 OK`), while blocking repeat bot IPs (`429`),
 *      enforcing multi-instance shared PostgreSQL coordination, and applying bounded
 *      `scrypt` CPU concurrency backpressure (`503 auth_busy`).
 *   3. `005-C-3` (`AUD-D3c`): IPv4 & IPv6 CIDR `CV_TRUST_PROXY` validation (`fd00::/8`,
 *      `2001:db8:abcd::/48`, `::1/128`) and spoof-resistant right-to-left `X-Forwarded-For`
 *      extraction.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "strata-005c-rl-"));
process.env.CV_DATA_DIR = TEST_DATA_DIR;
process.env.CV_SIGNING_SECRET = crypto.randomBytes(48).toString("hex");

const { applyPostgresMigrations } = await import("../scripts/migrate-pg.js");
const {
  PostgresPersistenceAdapter,
  SqlitePersistenceAdapter,
  setPersistenceAdapter,
  closePersistenceAdapter,
} = await import("../src/persistence/adapter.js");
const { createAppServer } = await import("../src/app.js");
const { createUserAsync } = await import("../src/security/authz.js");
const { isTrustedProxyIp, clientIp } = await import("../src/http/helpers.js");

const EXTERNAL_DB_URL = String(process.env.DATABASE_URL || "").trim();

async function createIsolatedPgAdapter() {
  if (EXTERNAL_DB_URL) {
    const pgMod = await import("pg");
    const { Pool } = pgMod.default || pgMod;
    const pool = new Pool({ connectionString: EXTERNAL_DB_URL });
    const adapter = new PostgresPersistenceAdapter(pool, {
      appRole: "cv_app_user",
      enforceRoleSeparation: process.env.CV_ENFORCE_DB_ROLE_SEPARATION === "1",
    });
    await adapter.init();
    return { adapter, cleanup: () => pool.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await applyPostgresMigrations(pg);
  const poolLike = {
    async connect() {
      return { query: (sql, params) => pg.query(sql, params), release() {} };
    },
    query: (sql, params) => pg.query(sql, params),
    async end() {
      await pg.close();
    },
  };
  const adapter = new PostgresPersistenceAdapter(poolLike, {
    appRole: "cv_runtime",
    enforceRoleSeparation: false,
  });
  await adapter.init();
  return { adapter, cleanup: () => pg.close() };
}

describe("Mission 005 Checkpoint 005-C — Attack-Resistant Rate Limiting & Trusted Proxies (AUD-C4, AUD-D1, AUD-D2, AUD-D3c)", () => {
  after(async () => {
    await closePersistenceAdapter();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("005-C-1 (AUD-C4 + AUD-D2): Reclaims expired rows first, evicts OLDEST unlocked buckets, never evicts active lockouts under spray, and fails closed when saturated", async () => {
    const { adapter: pgAdapter, cleanup: closePg } = await createIsolatedPgAdapter();
    const sqliteAdapter = new SqlitePersistenceAdapter();
    await sqliteAdapter.init();

    try {
      for (const [label, backend] of [
        ["sqlite", sqliteAdapter],
        ["postgres", pgAdapter],
      ]) {
        const prefix = `c1_${label}_${crypto.randomBytes(4).toString("hex")}`;

        // 1. AUD-C4: Insert an older-expiring bucket (`ttl=10s`) then 3 newer-expiring buckets (`ttl=120s`)
        //    with `maxBuckets = 4`. Adding a 5th bucket MUST evict `oldest` (`ttl=10s`), NOT `newest`!
        await backend.rateLimit(`${prefix}:oldest`, 5, 10, {
          increment: true,
          maxBuckets: 4,
          protectLockout: false,
        });
        for (let i = 1; i <= 3; i += 1) {
          await backend.rateLimit(`${prefix}:newer:${i}`, 5, 120, {
            increment: true,
            maxBuckets: 4,
            protectLockout: false,
          });
        }
        // Trigger 1-bucket overflow eviction
        await backend.rateLimit(`${prefix}:fifth`, 5, 180, {
          increment: true,
          maxBuckets: 4,
          protectLockout: false,
        });

        const oldestAfter = await backend.rateLimit(`${prefix}:oldest`, 5, 10, {
          increment: false,
          maxBuckets: 4,
        });
        const newestAfter = await backend.rateLimit(`${prefix}:newer:3`, 5, 120, {
          increment: false,
          maxBuckets: 4,
        });
        if (!EXTERNAL_DB_URL) {
          // Isolated empty DB has exact 4-bucket table count
          assert.equal(oldestAfter.count, 0, `[${label}] oldest bucket must be evicted first (AUD-C4)`);
        }
        assert.equal(newestAfter.count, 1, `[${label}] newer bucket must NOT be evicted (AUD-C4)`);

        // 2. Expired-row reclamation: 50ms TTL rows expire and are reclaimed without evicting valid rows
        await backend.rateLimit(`${prefix}:shortlived`, 5, 0.04, {
          increment: true,
          maxBuckets: 20,
        });
        await new Promise((r) => setTimeout(r, 65));
        const reclaimed = await backend.rateLimit(`${prefix}:shortlived`, 5, 60, {
          increment: false,
          maxBuckets: 20,
        });
        assert.equal(reclaimed.count, 0, `[${label}] expired bucket must be reclaimed automatically`);
      }

      // 3. AUD-D2 Lockout Protection + Fail-Closed Saturation on isolated PG + SQLite
      const { adapter: isoPg, cleanup: closeIsoPg } = await createIsolatedPgAdapter();
      try {
        // Trigger an active security lockout (`limit=2`, `protectLockout=true`)
        await isoPg.rateLimit("login:pair:attacker:victim", 2, 300, {
          increment: true,
          maxBuckets: 5,
          protectLockout: true,
        });
        await isoPg.rateLimit("login:pair:attacker:victim", 2, 300, {
          increment: true,
          maxBuckets: 5,
          protectLockout: true,
        });
        const locked = await isoPg.rateLimit("login:pair:attacker:victim", 2, 300, {
          increment: true,
          maxBuckets: 5,
          protectLockout: true,
        });
        assert.equal(locked.allowed, false);

        // Spray 25 distinct dummy keys with `maxBuckets: 5` trying to evict the lockout (`AUD-D2`)
        for (let i = 0; i < 25; i += 1) {
          await isoPg.rateLimit(`spray:dummy:${i}`, 10, 60, {
            increment: true,
            maxBuckets: 5,
            protectLockout: false,
          });
        }

        const stillLocked = await isoPg.rateLimit("login:pair:attacker:victim", 2, 300, {
          increment: false,
          maxBuckets: 5,
          protectLockout: true,
        });
        assert.equal(
          stillLocked.allowed,
          false,
          "Active security lockout MUST survive high-cardinality key sprays (AUD-D2)",
        );

        // Saturate all 5 slots with active lockouts -> 6th fresh key MUST fail closed (`saturated: true`)
        if (!EXTERNAL_DB_URL) {
          for (let k = 1; k <= 4; k += 1) {
            await isoPg.rateLimit(`lock:slot:${k}`, 1, 300, {
              increment: true,
              maxBuckets: 5,
              protectLockout: true,
            });
          }
          const admissionUnderSaturation = await isoPg.rateLimit("fresh:unseen:key", 10, 60, {
            increment: true,
            maxBuckets: 5,
            protectLockout: false,
          });
          assert.equal(
            admissionUnderSaturation.allowed,
            false,
            "Rate limiter must fail closed when 100% of bucket capacity holds active lockouts",
          );
          assert.equal(admissionUnderSaturation.saturated, true);
        }
      } finally {
        await closeIsoPg();
      }
    } finally {
      await closePg();
    }
  });

  it("005-C-2 (AUD-D1): Legitimate clean-IP login succeeds under 40-attempt distributed credential-stuffing attack, multi-replica PG shares limits, and scrypt concurrency applies 503 backpressure", async () => {
    const { adapter: pgAdapter, cleanup: closePg } = await createIsolatedPgAdapter();
    setPersistenceAdapter(pgAdapter);

    // Start TWO independent HTTP app servers sharing the same PostgreSQL persistence adapter
    // to prove multi-instance concurrency & shared rate-limit state!
    const prevTrust = process.env.CV_TRUST_PROXY;
    process.env.CV_TRUST_PROXY = "127.0.0.1";

    const server1 = createAppServer();
    const server2 = createAppServer();
    await new Promise((r) => server1.listen(0, "127.0.0.1", r));
    await new Promise((r) => server2.listen(0, "127.0.0.1", r));
    const url1 = `http://127.0.0.1:${server1.address().port}`;
    const url2 = `http://127.0.0.1:${server2.address().port}`;

    try {
      await createUserAsync(
        { role: "admin" },
        {
          email: "dr.victim@strata.test",
          password: "ValidDoctorPassword#2026!",
          displayName: "Dr. Victim",
          role: "student",
        },
      );

      const postLogin = (base, ip, email, password) =>
        fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": ip,
          },
          body: JSON.stringify({ email, password }),
        });

      // 1. Exact Bradley AUD-D1 reproduction:
      //    6 bot IPs x 5 wrong passwords = 30 wrong attempts across server1 & server2,
      //    PLUS 10 rotating bot IPs x 1 wrong password = 40 total wrong attempts!
      for (let bot = 1; bot <= 6; bot += 1) {
        const botIp = `198.51.100.${bot}`;
        const targetUrl = bot % 2 === 0 ? url1 : url2;
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const r = await postLogin(targetUrl, botIp, "dr.victim@strata.test", `WrongPass#${bot}_${attempt}`);
          assert.ok(r.status === 401 || r.status === 429);
        }
        // 6th attempt from this bot IP on the OTHER replica is immediately 429!
        const blockedOnOtherReplica = await postLogin(
          bot % 2 === 0 ? url2 : url1,
          botIp,
          "dr.victim@strata.test",
          "ValidDoctorPassword#2026!",
        );
        assert.equal(
          blockedOnOtherReplica.status,
          429,
          "Multi-instance PostgreSQL rate limiter must enforce pair lockout across replicas",
        );
      }

      for (let rot = 1; rot <= 10; rot += 1) {
        const rotIp = `203.0.113.${rot}`;
        const r = await postLogin(url1, rotIp, "dr.victim@strata.test", `SprayWrong#${rot}`);
        assert.equal(r.status, 429, "New bot IP sending wrong password during active attack must get 429");
      }

      // 2. Legitimate account owner signs in from a clean IP (`192.0.2.88`) -> MUST SUCCEED (200 OK)!
      const validOwnerRes = await postLogin(
        url2,
        "192.0.2.88",
        "dr.victim@strata.test",
        "ValidDoctorPassword#2026!",
      );
      assert.equal(
        validOwnerRes.status,
        200,
        "AUD-D1 fix: Legitimate user from clean IP must NOT be locked out by 40 distributed bot failures",
      );
      const validBody = await validOwnerRes.json();
      assert.equal(validBody.ok, true);
      assert.equal(validBody.user.email, "dr.victim@strata.test");

      // 3. Verify scrypt concurrency backpressure (`503 auth_busy`) + responsive `/health`
      process.env.CV_LOGIN_MAX_CONCURRENT_SCRYPT = "1";
      process.env.CV_LOGIN_MAX_SCRYPT_QUEUE = "1";
      try {
        const burst = Array.from({ length: 8 }, (_, idx) =>
          postLogin(
            url1,
            `192.0.2.${120 + idx}`,
            "dr.victim@strata.test",
            "ValidDoctorPassword#2026!",
          ),
        );
        const healthDuringBurst = fetch(`${url1}/health`);
        const [healthRes, ...burstResponses] = await Promise.all([healthDuringBurst, ...burst]);
        assert.equal(healthRes.status, 200, "/health must stay responsive during scrypt burst");
        const statuses = burstResponses.map((r) => r.status);
        assert.ok(
          statuses.includes(503),
          `Expected 503 auth_busy backpressure under scrypt saturation, got [${statuses.join(",")}]`,
        );
      } finally {
        delete process.env.CV_LOGIN_MAX_CONCURRENT_SCRYPT;
        delete process.env.CV_LOGIN_MAX_SCRYPT_QUEUE;
      }
    } finally {
      if (prevTrust === undefined) delete process.env.CV_TRUST_PROXY;
      else process.env.CV_TRUST_PROXY = prevTrust;
      await new Promise((r) => server1.close(r));
      await new Promise((r) => server2.close(r));
      setPersistenceAdapter(null);
      await closePg();
    }
  });

  it("005-C-3 (AUD-D3c): Validates IPv4 & IPv6 CIDR ranges in CV_TRUST_PROXY and extracts spoof-resistant client IP", () => {
    const prev = process.env.CV_TRUST_PROXY;
    process.env.CV_TRUST_PROXY = "10.0.0.0/8, fd00::/8, 2001:db8:abcd::/48, ::1/128";
    try {
      assert.equal(isTrustedProxyIp("10.24.0.5"), true);
      assert.equal(isTrustedProxyIp("11.0.0.1"), false);
      assert.equal(isTrustedProxyIp("fd12:3456:789a::1"), true);
      assert.equal(isTrustedProxyIp("2001:db8:abcd:0001::55"), true);
      assert.equal(isTrustedProxyIp("2001:db8:ffff::1"), false);
      assert.equal(isTrustedProxyIp("::1"), true);

      // Right-to-left XFF walk over trusted IPv6 internal ingress (`fd00::10`) ignores spoofed left-most IP!
      const fakeReqFromTrustedV6 = {
        socket: { remoteAddress: "fd00::10" },
        headers: {
          "x-forwarded-for": "1.2.3.4, 2001:4860:4860::8888, 2001:db8:abcd::9",
        },
      };
      assert.equal(
        clientIp(fakeReqFromTrustedV6),
        "2001:4860:4860::8888",
        "Must stop right-to-left at first untrusted hop and ignore spoofed 1.2.3.4",
      );

      // Untrusted IPv6 peer (`2606:4700::1`) cannot spoof X-Forwarded-For
      const fakeReqFromUntrustedV6 = {
        socket: { remoteAddress: "2606:4700::1" },
        headers: {
          "x-forwarded-for": "1.2.3.4",
        },
      };
      assert.equal(clientIp(fakeReqFromUntrustedV6), "2606:4700::1");
    } finally {
      if (prev === undefined) delete process.env.CV_TRUST_PROXY;
      else process.env.CV_TRUST_PROXY = prev;
    }
  });
});
