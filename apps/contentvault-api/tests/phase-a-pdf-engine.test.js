/**
 * Mission 004 — Phase A Regression & Sustainability Suite:
 * Modular PDF Rendering Adapter & `pypdfium2` Verification.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../src/config.js";
import {
  createPdfEngineAdapter,
  defaultPdfAdapter,
  enginePaths,
  EngineError,
} from "../src/services/pdf-engine.js";

const SAMPLE_PDF = path.join(
  REPO_ROOT,
  "knowledge",
  "synthetic",
  "synthetic-neurology-module.pdf",
);

describe("Mission 004 Phase A — Modular PDF Adapter & pypdfium2 Engine", () => {
  test("A-1: Default adapter selects pypdfium2 and runs with zero AGPL pymupdf dependency installed", async () => {
    assert.equal(defaultPdfAdapter.engineId, "pypdfium2");

    // Verify .venv operates cleanly without pymupdf installed
    const pyCheck = execFileSync(
      enginePaths.PYTHON,
      [
        "-c",
        "import importlib.util, json; print(json.dumps({'pypdfium2': bool(importlib.util.find_spec('pypdfium2')), 'pymupdf': bool(importlib.util.find_spec('pymupdf'))}))",
      ],
      { encoding: "utf8" },
    );
    const mods = JSON.parse(pyCheck.trim());
    assert.equal(mods.pypdfium2, true, "pypdfium2 must be installed");
    assert.equal(mods.pymupdf, false, "AGPL pymupdf must not be required in .venv");

    const probe = await defaultPdfAdapter.probePdf(SAMPLE_PDF);
    assert.equal(probe.engine, "pypdfium2");
    assert.equal(probe.pageCount, 6);
    assert.equal(probe.pageWidth, 595);
    assert.equal(probe.pageHeight, 842);
  });

  test("A-2: Modular createPdfEngineAdapter swaps engines via injected runner without touching authz/storage interfaces", async () => {
    const calls = [];
    const mockPng = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const customAdapter = createPdfEngineAdapter({
      engineName: "custom-mock-engine",
      runner: async (req) => {
        calls.push(req);
        if (req.command === "probe") {
          return { ok: true, engine: req.engine, pageCount: 3, pageWidth: 612, pageHeight: 792 };
        }
        return {
          ok: true,
          engine: req.engine,
          png: mockPng,
          width: 1224,
          height: 1584,
          pageCount: 3,
          sha256: "abc123",
          watermark: "Test Mark",
          renderMs: 5,
          cacheHit: false,
        };
      },
    });

    assert.equal(customAdapter.engineId, "custom-mock-engine");
    const p = await customAdapter.probePdf("/virtual/doc.pdf");
    assert.equal(p.engine, "custom-mock-engine");
    assert.equal(p.pageCount, 3);

    const r = await customAdapter.renderWatermarkedPage({
      absolutePath: "/virtual/doc.pdf",
      page: 2,
      identity: { label: "Dr. Test", ref: "usr_1", stamp: "2026Z" },
    });
    assert.equal(r.engine, "custom-mock-engine");
    assert.equal(r.width, 1224);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].command, "render");
  });

  test("A-3: pypdfium2 renders 144 DPI text & diagram pages with personalized multilingual watermarks and bounded RSS memory", async () => {
    const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), "cv-phase-a-cache-"));
    try {
      const adapter = createPdfEngineAdapter({ engineName: "pypdfium2", cacheDir: tmpCache });

      // Page 2 (dense clinical text) + Page 4 (clinical table/diagram) in Mandarin & Tamil/Latin
      const coldZh = await adapter.renderWatermarkedPage({
        absolutePath: SAMPLE_PDF,
        page: 2,
        dpi: 144,
        identity: { label: "陈伟明 · 張雅婷", ref: "usr_zh01", stamp: "2026-11-24T00:00:00Z" },
      });
      assert.equal(coldZh.engine, "pypdfium2");
      assert.equal(coldZh.width, 1190);
      assert.equal(coldZh.height, 1684);
      assert.equal(coldZh.cacheHit, false);
      assert.match(coldZh.watermark, /陈伟明 · 張雅婷/);

      const warmEn = await adapter.renderWatermarkedPage({
        absolutePath: SAMPLE_PDF,
        page: 2,
        dpi: 144,
        identity: { label: "Aisyah binti Rahman", ref: "usr_en02", stamp: "2026-11-24T00:00:00Z" },
      });
      assert.equal(warmEn.cacheHit, true, "Second render on same page must reuse unwatermarked base cache");
      assert.notEqual(coldZh.sha256, warmEn.sha256, "Different learners must receive distinct pixels");

      const diagPage = await adapter.renderWatermarkedPage({
        absolutePath: SAMPLE_PDF,
        page: 4,
        dpi: 144,
        identity: { label: "佐藤花子 · 김민수", ref: "usr_jk03", stamp: "2026-11-24T00:00:00Z" },
      });
      assert.equal(diagPage.width, 1190);
      assert.equal(diagPage.height, 1684);
      assert.ok(diagPage.buffer.length > 40_000, "Rendered PNG must carry full diagram & text payload");

      // Verify structured error handling on invalid inputs & unknown engines
      const badEngine = createPdfEngineAdapter({ engineName: "nonexistent_pdf_lib" });
      await assert.rejects(
        () => badEngine.probePdf(SAMPLE_PDF),
        (err) => err instanceof EngineError && err.code === "bad_engine",
      );
      await assert.rejects(
        () => adapter.renderWatermarkedPage({ absolutePath: SAMPLE_PDF, page: 99, identity: {} }),
        (err) => err instanceof EngineError && err.code === "bad_page",
      );

      // Run benchmark script to assert latency & peak RSS memory stay well within sustainable bounds
      const benchRaw = execFileSync(
        enginePaths.PYTHON,
        [path.join(REPO_ROOT, "scripts", "verification", "benchmark_pdf_engines.py")],
        { encoding: "utf8" },
      );
      const bench = JSON.parse(benchRaw);
      assert.equal(bench.pypdfium2.pageCount, 6);
      assert.ok(
        bench.pypdfium2.peakRssMbMax < 160,
        `Expected peak RSS < 160 MB, got ${bench.pypdfium2.peakRssMbMax} MB`,
      );
      assert.ok(
        bench.pypdfium2.coldRenderMsMean < 1500,
        `Expected mean cold render < 1500 ms, got ${bench.pypdfium2.coldRenderMsMean} ms`,
      );
      assert.equal(bench.pypdfium2.selftest.fontLoaded, true);
    } finally {
      fs.rmSync(tmpCache, { recursive: true, force: true });
    }
  });
});
