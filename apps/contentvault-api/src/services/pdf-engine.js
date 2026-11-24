/**
 * Bridge from the Node API to the Python rasterisation/watermarking worker.
 *
 * The worker is invoked with a JSON request on stdin and answers with a JSON
 * object on stdout. We never shell out, so file paths and identity strings are
 * passed as data, not interpolated into a command line.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { API_ROOT, REPO_ROOT, CACHE_DIR, RENDER_DPI } from "../config.js";

const ENGINE_PATH = path.join(REPO_ROOT, "packages", "watermark-engine", "render_page.py");
const VENDOR_PYLIBS = path.join(REPO_ROOT, "vendor", "pylibs");

/** Resolve the Python interpreter to use for the worker. */
function resolvePython() {
  const configured = process.env.CV_PYTHON;
  if (configured && fs.existsSync(configured)) return configured;

  const candidates = [
    path.join(
      process.env.USERPROFILE || "",
      ".dsh",
      "dsh-runtimes",
      "dsh-primary-runtime",
      "dependencies",
      "python",
      "python.exe",
    ),
    "python",
    "python3",
    "py",
  ];
  for (const candidate of candidates) {
    if (candidate === "python" || candidate === "python3" || candidate === "py") {
      return candidate; // resolved via PATH by the OS
    }
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

const PYTHON = resolvePython();

export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

function runEngine(request, timeoutMs = 30_000) {
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

      // The worker emits a JSON error object on stdout for expected failures.
      let payload = null;
      if (out) {
        try {
          payload = JSON.parse(out);
        } catch {
          payload = null;
        }
      }

      if (payload && payload.ok === false) {
        reject(new EngineError(payload.error || "engine_error", payload.message || "Render failed."));
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

    child.stdin.on("error", () => {
      /* handled via close/error events */
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

/** Report page count and page dimensions for an uploaded PDF. */
export async function probePdf(absolutePath) {
  const result = await runEngine({ command: "probe", path: absolutePath });
  return {
    pageCount: Number(result.pageCount),
    pageWidth: Number(result.pageWidth),
    pageHeight: Number(result.pageHeight),
  };
}

/**
 * Render one page with the student's watermark burned in.
 * Returns { buffer, sha256, width, height, watermark, renderMs }.
 */
export async function renderWatermarkedPage({
  absolutePath,
  page,
  identity,
  dpi = RENDER_DPI,
}) {
  const result = await runEngine({
    command: "render",
    path: absolutePath,
    page,
    dpi,
    identity,
  });
  return {
    buffer: Buffer.from(result.png, "base64"),
    sha256: result.sha256,
    width: result.width,
    height: result.height,
    pageCount: result.pageCount,
    watermark: result.watermark,
    renderMs: result.renderMs,
  };
}

/** Health/diagnostic helper used by the self-test route and tests. */
export async function engineSelftest(absolutePath, page = 1, dpi = 96) {
  return runEngine({ command: "selftest", path: absolutePath, page, dpi }, 90_000);
}

export const enginePaths = { ENGINE_PATH, PYTHON, CACHE_DIR };


