/**
 * Modular PDF rendering adapter bridge (Mission 004 Phase A).
 *
 * Decouples Node API routes, authorization, entitlement enforcement, storage,
 * and frontend interfaces from the underlying PDF rasterisation library
 * (`pypdfium2` by default, replaceable via `CV_PDF_ENGINE` or `createPdfEngineAdapter`).
 *
 * The worker is invoked with a JSON request on stdin and answers with a JSON
 * object on stdout. No file paths or identity strings are shell-interpolated.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { API_ROOT, REPO_ROOT, CACHE_DIR, RENDER_DPI, PDF_ENGINE } from "../config.js";

const ENGINE_PATH = path.join(REPO_ROOT, "packages", "watermark-engine", "render_page.py");
const VENDOR_PYLIBS = path.join(REPO_ROOT, "vendor", "pylibs");

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
  constructor(code, message) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

export function runPythonWorker(request, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ENGINE_PATH)) {
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

    const child = spawn(PYTHON, [ENGINE_PATH], {
      cwd: API_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new EngineError("engine_timeout", "Rendering timed out."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new EngineError(
          "engine_spawn",
          `Could not start the rendering worker: ${error.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

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
        reject(
          new EngineError(
            payload.error || "engine_error",
            payload.message || "Render failed.",
          ),
        );
        return;
      }
      if (code !== 0 || !payload) {
        reject(
          new EngineError(
            "engine_failed",
            `Rendering worker exited with code ${code}. ${err || out}`.slice(0, 500),
          ),
        );
        return;
      }
      resolve(payload);
    });

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

/**
 * Create a modular PDF rendering adapter instance.
 * Custom `runner` or `engineName` can be injected for testing or alternative runtimes
 * without altering authorization, entitlement, storage, or HTTP handlers.
 */
export function createPdfEngineAdapter({
  engineName = null,
  runner = runPythonWorker,
  cacheDir = CACHE_DIR,
  defaultDpi = RENDER_DPI,
} = {}) {
  const resolveEngine = () =>
    String(engineName || process.env.CV_PDF_ENGINE || PDF_ENGINE || "pypdfium2")
      .trim()
      .toLowerCase();

  return {
    get engineId() {
      return resolveEngine();
    },

    async probePdf(absolutePath) {
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
    },

    async renderWatermarkedPage({
      absolutePath,
      page,
      identity,
      dpi = defaultDpi,
      contentHash = null,
    }) {
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
        30_000,
      );
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
    },

    async engineSelftest(absolutePath, page = 1, dpi = 96) {
      return runner(
        {
          command: "selftest",
          engine: resolveEngine(),
          path: absolutePath,
          page,
          dpi,
        },
        90_000,
      );
    },
  };
}

export const defaultPdfAdapter = createPdfEngineAdapter();

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
