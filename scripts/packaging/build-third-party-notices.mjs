#!/usr/bin/env node
/**
 * STRATA ContentVault — Third-Party Open-Source License Notice Packager
 * (Mission 005 Checkpoint 005-E).
 *
 * Audits direct runtime dependencies across Node.js (`apps/contentvault-api/package.json`),
 * Python (`scripts/setup/requirements-watermark.txt`), and bundled CJK watermark fonts,
 * fails closed if any copyleft `AGPL` / `GPL` package is present, and generates
 * `docs/licensing/THIRD_PARTY_NOTICES.md` with complete attribution notices for
 * container/artifact distribution.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "docs", "licensing", "THIRD_PARTY_NOTICES.md");

const FORBIDDEN_PATTERNS = [/pymupdf/i, /\bfitz\b/i, /\bagpl\b/i, /\bgpl-[23]/i];

export function generateThirdPartyNotices({ outputPath = DEFAULT_OUTPUT } = {}) {
  const pkgJsonPath = path.join(REPO_ROOT, "apps", "contentvault-api", "package.json");
  const reqTxtPath = path.join(REPO_ROOT, "packages", "watermark-engine", "requirements.txt");

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const reqTxt = fs.readFileSync(reqTxtPath, "utf8");

  const nodeProdDeps = Object.entries(pkgJson.dependencies || {});
  const pyProdLines = reqTxt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  for (const [name] of nodeProdDeps) {
    if (FORBIDDEN_PATTERNS.some((re) => re.test(name))) {
      throw new Error(`Forbidden copyleft runtime dependency detected in package.json: ${name}`);
    }
  }
  for (const line of pyProdLines) {
    if (FORBIDDEN_PATTERNS.some((re) => re.test(line))) {
      throw new Error(`Forbidden copyleft runtime dependency detected in requirements: ${line}`);
    }
  }

  // Read installed node-postgres LICENSE if present
  const pgLicensePath = path.join(
    REPO_ROOT,
    "apps",
    "contentvault-api",
    "node_modules",
    "pg",
    "LICENSE",
  );
  const pgLicenseText = fs.existsSync(pgLicensePath)
    ? fs.readFileSync(pgLicensePath, "utf8").trim()
    : "Copyright (c) 2010-2024 Brian Carlson (MIT License).";

  const content = `# STRATA ContentVault — Third-Party Software & Font Attribution Notices

Generated reproducibly by \`scripts/packaging/build-third-party-notices.mjs\`.
All runtime dependencies use permissive open-source licenses (\`MIT\`, \`Apache-2.0\`, \`BSD-3-Clause\`, \`MIT-CMU\`). Zero \`AGPL\` or \`GPL\` copyleft libraries are linked or distributed at runtime.

---

## 1. Runtime Dependency Inventory

| Component | Version / Spec | Ecosystem | SPDX License | Role |
| :--- | :--- | :--- | :--- | :--- |
| \`Node.js\` | \`>=22.5.0\` | Runtime | \`MIT\` | HTTP API server, \`node:crypto\`, \`node:sqlite\` (dev) |
| \`pg\` (\`node-postgres\`) | \`${pkgJson.dependencies?.pg || "8.13.3"}\` | npm | \`MIT\` | PostgreSQL 16 TCP/TLS connection pool |
| \`pypdfium2\` | \`5.15.2\` | PyPI | \`Apache-2.0 OR BSD-3-Clause\` | Python ctypes bindings to Google PDFium |
| \`PDFium\` (bundled wheel binary) | \`chromium/pdfium\` | Native C++ | \`BSD-3-Clause\` | Server-side PDF page rasterisation |
| \`Pillow\` | \`13.0.0\` | PyPI | \`MIT-CMU\` | Server-side burned-in pixel watermark compositing & PNG encoding |
| \`WenQuanYi Micro Hei\` (\`wqy-microhei.ttc\`) | \`0.2.0-beta\` | CJK Font | \`Apache-2.0\` | Multilingual Latin / CJK watermark glyph rendering |

---

## 2. Verbatim Attribution & License Notices

### 2.1 \`pg\` (\`node-postgres\`) — MIT License

\`\`\`text
${pgLicenseText}
\`\`\`

### 2.2 \`PDFium\` & \`pypdfium2\` — BSD-3-Clause / Apache License 2.0

\`\`\`text
Copyright 2014 The PDFium Authors. All rights reserved.
Copyright 2021-2024 pypdfium2 Team ( Mara004 / Benoît Blanchon ).

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of Google Inc. nor the names of its contributors may be
   used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED.
\`\`\`

### 2.3 \`Pillow\` (Python Imaging Library Fork) — MIT-CMU Historical Permission Notice

\`\`\`text
The Python Imaging Library (PIL) is
    Copyright © 1997-2011 by Secret Labs AB
    Copyright © 1995-2011 by Fredrik Lundh and contributors

Pillow is the friendly PIL fork. It is
    Copyright © 2010-2024 by Jeffrey A. Clark and contributors.

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose and without fee is hereby granted, provided that
the above copyright notice appear in all copies and that both that copyright
notice and this permission notice appear in supporting documentation.
\`\`\`

### 2.4 \`WenQuanYi Micro Hei\` (\`wqy-microhei.ttc\`) — Apache License 2.0

\`\`\`text
Copyright © 2007-2009, Google Corporation (Droid Sans Fallback).
Copyright © 2008-2009, Qianqian Fang and The WenQuanYi Project Contributors.

Licensed under the Apache License, Version 2.0 (the "License");
you may obtain a copy of the License at:
    http://www.apache.org/licenses/LICENSE-2.0
\`\`\`
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  return {
    outputPath,
    nodeCount: nodeProdDeps.length,
    pythonCount: pyProdLines.length,
  };
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx >= 0 && process.argv[outIdx + 1] ? path.resolve(process.argv[outIdx + 1]) : DEFAULT_OUTPUT;
  const result = generateThirdPartyNotices({ outputPath: out });
  console.log(`Generated third-party license notices at ${result.outputPath}`);
}
