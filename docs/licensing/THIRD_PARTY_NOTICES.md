# STRATA ContentVault — Third-Party Software & Font Attribution Notices

Generated reproducibly by `scripts/packaging/build-third-party-notices.mjs`.
All runtime dependencies use permissive open-source licenses (`MIT`, `Apache-2.0`, `BSD-3-Clause`, `MIT-CMU`). Zero `AGPL` or `GPL` copyleft libraries are linked or distributed at runtime.

---

## 1. Runtime Dependency Inventory

| Component | Version / Spec | Ecosystem | SPDX License | Role |
| :--- | :--- | :--- | :--- | :--- |
| `Node.js` | `>=22.5.0` | Runtime | `MIT` | HTTP API server, `node:crypto`, `node:sqlite` (dev) |
| `pg` (`node-postgres`) | `8.13.3` | npm | `MIT` | PostgreSQL 16 TCP/TLS connection pool |
| `pypdfium2` | `5.15.2` | PyPI | `Apache-2.0 OR BSD-3-Clause` | Python ctypes bindings to Google PDFium |
| `PDFium` (bundled wheel binary) | `chromium/pdfium` | Native C++ | `BSD-3-Clause` | Server-side PDF page rasterisation |
| `Pillow` | `13.0.0` | PyPI | `MIT-CMU` | Server-side burned-in pixel watermark compositing & PNG encoding |
| `WenQuanYi Micro Hei` (`wqy-microhei.ttc`) | `0.2.0-beta` | CJK Font | `Apache-2.0` | Multilingual Latin / CJK watermark glyph rendering |

---

## 2. Verbatim Attribution & License Notices

### 2.1 `pg` (`node-postgres`) — MIT License

```text
MIT License

Copyright (c) 2010 - 2021 Brian Carlson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 2.2 `PDFium` & `pypdfium2` — BSD-3-Clause / Apache License 2.0

```text
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
```

### 2.3 `Pillow` (Python Imaging Library Fork) — MIT-CMU Historical Permission Notice

```text
The Python Imaging Library (PIL) is
    Copyright © 1997-2011 by Secret Labs AB
    Copyright © 1995-2011 by Fredrik Lundh and contributors

Pillow is the friendly PIL fork. It is
    Copyright © 2010-2024 by Jeffrey A. Clark and contributors.

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose and without fee is hereby granted, provided that
the above copyright notice appear in all copies and that both that copyright
notice and this permission notice appear in supporting documentation.
```

### 2.4 `WenQuanYi Micro Hei` (`wqy-microhei.ttc`) — Apache License 2.0

```text
Copyright © 2007-2009, Google Corporation (Droid Sans Fallback).
Copyright © 2008-2009, Qianqian Fang and The WenQuanYi Project Contributors.

Licensed under the Apache License, Version 2.0 (the "License");
you may obtain a copy of the License at:
    http://www.apache.org/licenses/LICENSE-2.0
```

### 2.5 Transitive Native Binary Credits (`PDFium` & `Pillow` Wheels)

```text
FreeType Project License (FTL) Credit:
Portions of this software are copyright © The FreeType Project (www.freetype.org).
All rights reserved.

Independent JPEG Group (IJG) / libjpeg-turbo Documentation Notice:
This software is based in part on the work of the Independent JPEG Group.
```
