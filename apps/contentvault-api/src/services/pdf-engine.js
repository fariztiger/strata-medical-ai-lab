/**
 * Modular PDF rendering adapter with bounded worker pool, SIGTERM->SIGKILL
 * timeout escalation, render-cache byte/TTL/LRU eviction, and disk-space
 * safeguards (Mission 005 Checkpoint 005-D — AUD-A1, AUD-A2).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import {
  API_ROOT,
  REPO_ROOT,
  CACHE_DIR,
  RENDER_DPI,
  PDF_ENGINE,
  WORKER_MAX_CONCURRENCY,
  WORKER_MAX_QUEUE,
  WORKER_MAX_PER_USER,
  WORKER_TIMEOUT_MS,
  WORKER_KILL_GRACE_MS,
  RENDER_CACHE_MAX_BYTES,
  RENDER_CACHE_TTL_MS,
  MIN_FREE_DISK_BYTES,
} from "../config.js";

const ENGINE_PATH = path.join(REPO_ROOT, "packages", "watermark-engine", "render_page.py");
const VENDOR_PYLIBS = path.join(REPO_ROOT, "vendor", "pylibs");
const MAX_WORKER_STDOUT_BYTES = 32 * 1024 * 1024;

function resolvePython() {
  const configured = process.env.CV_PYTHON;
  if (configured && fs.existsSync(configured)) return configured;

  const candidates = [
    path.join(REPO_ROOT, ".venv", "bin", "python"),
    path.join(REPO_ROOT, ".venv", "Scripts", "python.exe"),
    path.join(
      process.env.USERPROFILE || "",
      ".dsh",
      "dsh-runtimes",
      "dsh-primary-runtime",
      "dependencies",
      "python",
      "python.exe",
    ),
    "python3",
    "python",
    "py",
  ];
  for (const candidate of candidates) {
    if (candidate === "python" || candidate === "python3" || candidate === "py") {
      return candidate;
    }
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "python3";
}

const PYTHON = resolvePython();

export class EngineError extends Error {
  constructor(code, message, { statusCode = 500, retryAfter = null } = {}) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.statusCode = statusCode;
    if (retryAfter !== null) {
      this.retryAfter = retryAfter;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Operational Worker & Cache Metrics                                  */
/* ------------------------------------------------------------------ */

const workerMetrics = {
  completed: 0,
  failed: 0,
  timeouts: 0,
  sigkillEscalations: 0,
  rejectedQueueFull: 0,
  rejectedUserBudget: 0,
  rejectedDiskSpace: 0,
  cacheEvictions: 0,
  lastCacheBytes: 0,
  lastCacheFiles: 0,
};

/* ------------------------------------------------------------------ */
/* Render-Cache Byte/Count/TTL Eviction & Free-Disk Safeguard          */
/* ------------------------------------------------------------------ */

function getFreeDiskBytes(targetDir) {
  if (typeof fs.statfsSync !== "function") return Number.POSITIVE_INFINITY;
  try {
    const st = fs.statfsSync(targetDir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function enforceRenderCachePolicy(
  cacheDir = CACHE_DIR,
  {
    maxBytes = Number(process.env.CV_RENDER_CACHE_MAX_BYTES ?? RENDER_CACHE_MAX_BYTES),
    maxFiles = Number(process.env.CV_RENDER_CACHE_MAX_FILES ?? 2000),
    ttlMs = Number(process.env.CV_RENDER_CACHE_TTL_MS ?? RENDER_CACHE_TTL_MS),
    minFreeDiskBytes = Number(process.env.CV_MIN_FREE_DISK_BYTES ?? MIN_FREE_DISK_BYTES),
    statfsFn = getFreeDiskBytes,
  } = {},
) {
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  let entries = [];

  try {
    for (const name of fs.readdirSync(cacheDir)) {
      const full = path.join(cacheDir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        entries.push({
          name,
          full,
          size: st.size,
          mtimeMs: st.mtimeMs,
          lastTouchMs: Math.max(st.atimeMs || 0, st.mtimeMs || 0),
        });
      } catch {
        /* ignore concurrently unlinked entry */
      }
    }
  } catch {
    entries = [];
  }

  let evicted = 0;

  // 1. Purge TTL-expired cache entries first
  const activeEntries = [];
  for (const item of entries) {
    if (ttlMs > 0 && now - item.mtimeMs > ttlMs) {
      try {
        fs.unlinkSync(item.full);
        evicted += 1;
      } catch {
        /* ignore */
      }
    } else {
      activeEntries.push(item);
    }
  }

  // 2. Sort remaining entries oldest-first (LRU / oldest touch)
  activeEntries.sort((a, b) => a.lastTouchMs - b.lastTouchMs);

  let totalBytes = activeEntries.reduce((acc, item) => acc + item.size, 0);

  // 3. Evict oldest entries until both byte budget and file-count cap are satisfied
  while (
    activeEntries.length > 0 &&
    (totalBytes > maxBytes || activeEntries.length > maxFiles)
  ) {
    const victim = activeEntries.shift();
    try {
      fs.unlinkSync(victim.full);
      totalBytes = Math.max(0, totalBytes - victim.size);
      evicted += 1;
    } catch {
      /* ignore */
    }
  }

  // 4. Free-disk-space safeguard: if free space is below threshold, purge remaining cache
  //    and refuse new renders if disk remains critically low!
  if (minFreeDiskBytes > 0) {
    let freeBytes = statfsFn(cacheDir);
    if (freeBytes < minFreeDiskBytes && activeEntries.length > 0) {
      while (activeEntries.length > 0) {
        const victim = activeEntries.shift();
        try {
          fs.unlinkSync(victim.full);
          totalBytes = Math.max(0, totalBytes - victim.size);
          evicted += 1;
        } catch {
          /* ignore */
        }
      }
      freeBytes = statfsFn(cacheDir);
    }
    if (freeBytes < minFreeDiskBytes) {
      workerMetrics.rejectedDiskSpace += 1;
      throw new EngineError(
        "disk_space_exhausted",
        "Insufficient free disk space to safely rasterise document page.",
        { statusCode: 503, retryAfter: 10 },
      );
    }
  }

  workerMetrics.cacheEvictions += evicted;
  workerMetrics.lastCacheBytes = totalBytes;
  workerMetrics.lastCacheFiles = activeEntries.length;

  return {
    evicted,
    totalBytes,
    totalFiles: activeEntries.length,
  };
}

/* ------------------------------------------------------------------ */
/* Subprocess Runner with SIGTERM -> SIGKILL Escalation (`AUD-A2`)     */
/* ------------------------------------------------------------------ */

export function runPythonWorker(
  request,
  timeoutMs = Number(process.env.CV_WORKER_TIMEOUT_MS || WORKER_TIMEOUT_MS),
  {
    pythonBin = PYTHON,
    engineScript = ENGINE_PATH,
    killGraceMs = Number(process.env.CV_WORKER_KILL_GRACE_MS || WORKER_KILL_GRACE_MS),
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(engineScript)) {
      reject(new EngineError("engine_missing", "Watermark engine not found."));
      return;
    }

    const env = {
      ...process.env,
      PYTHONPATH: [VENDOR_PYLIBS, process.env.PYTHONPATH]
        .filter(Boolean)
        .join(path.delimiter),
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    };

    const child = spawn(pythonBin, [engineScript], {
      cwd: API_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let settled = false;
    let exited = false;
    let killEscalationTimer = null;

    const clearTimers = () => {
      clearTimeout(timer);
      if (killEscalationTimer) {
        clearTimeout(killEscalationTimer);
        killEscalationTimer = null;
      }
    };

    const terminateWithEscalation = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* process may already be dead */
      }
      killEscalationTimer = setTimeout(() => {
        if (!exited) {
          workerMetrics.sigkillEscalations += 1;
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }
      }, killGraceMs);
      if (typeof killEscalationTimer.unref === "function") {
        killEscalationTimer.unref();
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      workerMetrics.timeouts += 1;
      workerMetrics.failed += 1;
      terminateWithEscalation();
      reject(
        new EngineError("engine_timeout", "Rendering worker timed out.", {
          statusCode: 504,
          retryAfter: 2,
        }),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_WORKER_STDOUT_BYTES) {
        if (!settled) {
          settled = true;
          workerMetrics.failed += 1;
          clearTimers();
          terminateWithEscalation();
          reject(
            new EngineError("engine_output_exceeded", "Worker output exceeded safety cap."),
          );
        }
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64) stderr.push(chunk);
    });

    child.on("error", (error) => {
      exited = true;
      if (settled) return;
      settled = true;
      workerMetrics.failed += 1;
      clearTimers();
      reject(
        new EngineError(
          "engine_spawn",
          `Could not start the rendering worker: ${error.message}`,
        ),
      );
    });

    child.on("close", (code, signal) => {
      exited = true;
      clearTimers();
      if (settled) return;
      settled = true;

      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();

      let payload = null;
      if (out) {
        try {
          payload = JSON.parse(out);
        } catch {
          payload = null;
        }
      }

      if (payload && payload.ok === false) {
        workerMetrics.failed += 1;
        reject(
          new EngineError(
            payload.error || "engine_error",
            payload.message || "Render failed.",
          ),
        );
        return;
      }
      if (code !== 0 || !payload) {
        workerMetrics.failed += 1;
        reject(
          new EngineError(
            "engine_failed",
            `Rendering worker exited (code=${code}, signal=${signal || "none"}). ${err || out}`.slice(
              0,
              500,
            ),
          ),
        );
        return;
      }
      workerMetrics.completed += 1;
      resolve(payload);
    });

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

/* ------------------------------------------------------------------ */
/* Bounded Concurrency & Per-User/Global Queue Scheduler (`AUD-A1`)    */
/* ------------------------------------------------------------------ */

export function createBoundedWorkerScheduler({
  getMaxConcurrency = () =>
    Math.max(1, Number(process.env.CV_WORKER_MAX_CONCURRENCY || WORKER_MAX_CONCURRENCY)),
  getMaxQueue = () =>
    Math.max(0, Number(process.env.CV_WORKER_MAX_QUEUE ?? WORKER_MAX_QUEUE)),
  getMaxPerUser = () =>
    Math.max(1, Number(process.env.CV_WORKER_MAX_PER_USER || WORKER_MAX_PER_USER)),
} = {}) {
  let active = 0;
  const queue = [];
  const perUserInflight = new Map();

  function incUser(userKey) {
    if (!userKey) return;
    perUserInflight.set(userKey, (perUserInflight.get(userKey) || 0) + 1);
  }

  function decUser(userKey) {
    if (!userKey) return;
    const next = (perUserInflight.get(userKey) || 1) - 1;
    if (next <= 0) perUserInflight.delete(userKey);
    else perUserInflight.set(userKey, next);
  }

  function pump() {
    while (active < getMaxConcurrency() && queue.length > 0) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active = Math.max(0, active - 1);
          decUser(job.userKey);
          pump();
        });
    }
  }

  function schedule(userKey, task) {
    const cleanUser = userKey ? String(userKey) : null;
    if (cleanUser) {
      const currentForUser = perUserInflight.get(cleanUser) || 0;
      if (currentForUser >= getMaxPerUser()) {
        workerMetrics.rejectedUserBudget += 1;
        return Promise.reject(
          new EngineError(
            "user_render_budget_exceeded",
            "Too many concurrent page renders for this account; please wait for active pages to finish.",
            { statusCode: 429, retryAfter: 2 },
          ),
        );
      }
    }

    const maxConc = getMaxConcurrency();
    const maxQ = getMaxQueue();
    if (active >= maxConc && queue.length >= maxQ) {
      workerMetrics.rejectedQueueFull += 1;
      return Promise.reject(
        new EngineError(
          "render_queue_full",
          "Document rendering service is temporarily at capacity; please retry shortly.",
          { statusCode: 503, retryAfter: 3 },
        ),
      );
    }

    incUser(cleanUser);

    if (active < maxConc) {
      active += 1;
      return Promise.resolve()
        .then(task)
        .finally(() => {
          active = Math.max(0, active - 1);
          decUser(cleanUser);
          pump();
        });
    }

    return new Promise((resolve, reject) => {
      queue.push({ userKey: cleanUser, task, resolve, reject });
    });
  }

  function stats() {
    return {
      activeWorkers: active,
      queuedRequests: queue.length,
      trackedUsers: perUserInflight.size,
      maxConcurrency: getMaxConcurrency(),
      maxQueue: getMaxQueue(),
      maxPerUser: getMaxPerUser(),
    };
  }

  return { schedule, stats };
}

/**
 * Create a modular PDF rendering adapter instance with bounded worker scheduling
 * and render-cache housekeeping.
 */
export function createPdfEngineAdapter({
  engineName = null,
  runner = runPythonWorker,
  cacheDir = CACHE_DIR,
  defaultDpi = RENDER_DPI,
  maxConcurrency = null,
  maxQueue = null,
  maxPerUser = null,
  cacheOptions = {},
} = {}) {
  const resolveEngine = () =>
    String(engineName || process.env.CV_PDF_ENGINE || PDF_ENGINE || "pypdfium2")
      .trim()
      .toLowerCase();

  const scheduler = createBoundedWorkerScheduler({
    ...(maxConcurrency !== null ? { getMaxConcurrency: () => maxConcurrency } : {}),
    ...(maxQueue !== null ? { getMaxQueue: () => maxQueue } : {}),
    ...(maxPerUser !== null ? { getMaxPerUser: () => maxPerUser } : {}),
  });

  return {
    get engineId() {
      return resolveEngine();
    },

    getMetrics() {
      return {
        ...scheduler.stats(),
        ...workerMetrics,
      };
    },

    async probePdf(absolutePath) {
      return scheduler.schedule(null, async () => {
        const result = await runner({
          command: "probe",
          engine: resolveEngine(),
          path: absolutePath,
        });
        return {
          engine: result.engine || resolveEngine(),
          pageCount: Number(result.pageCount),
          pageWidth: Number(result.pageWidth),
          pageHeight: Number(result.pageHeight),
        };
      });
    },

    async renderWatermarkedPage({
      absolutePath,
      page,
      identity,
      userId = null,
      dpi = defaultDpi,
      contentHash = null,
      timeoutMs = undefined,
    }) {
      const budgetUserKey = userId || identity?.ref || null;
      return scheduler.schedule(budgetUserKey, async () => {
        if (cacheDir) {
          enforceRenderCachePolicy(cacheDir, cacheOptions);
        }
        const result = await runner(
          {
            command: "render",
            engine: resolveEngine(),
            path: absolutePath,
            page,
            dpi,
            identity,
            cacheDir,
            contentHash,
          },
          timeoutMs,
        );
        if (cacheDir) {
          enforceRenderCachePolicy(cacheDir, cacheOptions);
        }
        return {
          engine: result.engine || resolveEngine(),
          buffer: Buffer.from(result.png, "base64"),
          sha256: result.sha256,
          width: result.width,
          height: result.height,
          pageCount: result.pageCount,
          watermark: result.watermark,
          renderMs: result.renderMs,
          cacheHit: Boolean(result.cacheHit),
        };
      });
    },

    async engineSelftest(absolutePath, page = 1, dpi = 96) {
      return scheduler.schedule(null, () =>
        runner(
          {
            command: "selftest",
            engine: resolveEngine(),
            path: absolutePath,
            page,
            dpi,
          },
          90_000,
        ),
      );
    },
  };
}

export const defaultPdfAdapter = createPdfEngineAdapter();

export function getPdfWorkerMetrics() {
  return defaultPdfAdapter.getMetrics();
}

export async function probePdf(absolutePath) {
  return defaultPdfAdapter.probePdf(absolutePath);
}

export async function renderWatermarkedPage(options) {
  return defaultPdfAdapter.renderWatermarkedPage(options);
}

export async function engineSelftest(absolutePath, page = 1, dpi = 96) {
  return defaultPdfAdapter.engineSelftest(absolutePath, page, dpi);
}

export const enginePaths = { ENGINE_PATH, PYTHON, CACHE_DIR };
