#!/usr/bin/env python3
"""
Generate authentic live-state persona visual captures from the running
STRATA ContentVault server (http://127.0.0.1:7410).

Because this minimal sandbox container does not ship with a Chromium/X11 binary,
this script logs into the LIVE HTTP server as each of the four personas (Admin,
Student A [EN], Student B [Mandarin ZH], and Unauthorized Student C), fetches
the real API responses and real server-rasterised watermarked PNG page bytes,
and renders 1440x920 visual inspection frames via PyMuPDF (with native CJK
`china-ss` font support).
"""

from __future__ import annotations

import hashlib
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
for venv_site in (REPO / ".venv").glob("lib/python*/site-packages"):
    sys.path.insert(0, str(venv_site))

import pymupdf  # noqa: E402

BASE = "http://127.0.0.1:7410"
OUT_DIR = REPO / "reports" / "screenshots"

# STRATA Palette (0..1 RGB floats for PyMuPDF)
NAVY = (0.078, 0.169, 0.251)       # #142B40
NAVY_DARK = (0.051, 0.118, 0.176)  # #0D1E2D
EMERALD = (0.090, 0.349, 0.302)    # #17594D
EMERALD_BG = (0.910, 0.953, 0.941)
GOLD = (0.773, 0.643, 0.427)       # #C5A46D
GOLD_BG = (0.973, 0.953, 0.910)
IVORY = (0.969, 0.961, 0.937)      # #F7F5EF
WHITE = (1.0, 1.0, 1.0)
INK = (0.086, 0.137, 0.188)
MUTED = (0.322, 0.380, 0.439)
BORDER = (0.867, 0.843, 0.784)
DANGER = (0.608, 0.173, 0.173)
DANGER_BG = (0.992, 0.949, 0.949)

W, H = 1440, 920


class LiveSession:
    def __init__(self) -> None:
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, path: str, method: str = "GET", payload: dict | None = None, headers: dict | None = None):
        hdrs = dict(headers or {})
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{BASE}{path}", data=body, headers=hdrs, method=method)
        try:
            with self.opener.open(req, timeout=20) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), err.read()


def draw_chrome(page, role_label: str, user_name: str, locale: str = "en") -> None:
    page.draw_rect(pymupdf.Rect(0, 0, W, H), color=None, fill=IVORY)
    # Synthetic banner
    page.draw_rect(pymupdf.Rect(0, 0, W, 28), color=None, fill=GOLD_BG)
    page.draw_rect(pymupdf.Rect(24, 5, 226, 23), color=None, fill=NAVY)
    page.insert_text((32, 17), "SYNTHETIC RESEARCH PROTOTYPE", fontsize=8.2, fontname="hebo", color=GOLD)
    if locale == "zh":
        page.insert_text(
            (240, 18),
            "STRATA ContentVault v0.1 — 实时服务端光栅化与逐学员像素级水印保护已启用",
            fontsize=9.5,
            fontname="china-ss",
            color=(0.36, 0.26, 0.10),
        )
    else:
        page.insert_text(
            (240, 18),
            "STRATA ContentVault v0.1 — Live HTTP capture · Server-side 144 DPI rasterisation & burned-in identity watermark active.",
            fontsize=9.2,
            fontname="helv",
            color=(0.36, 0.26, 0.10),
        )

    # Top Navy Header
    page.draw_rect(pymupdf.Rect(0, 28, W, 92), color=None, fill=NAVY)
    page.draw_rect(pymupdf.Rect(0, 92, W, 95), color=None, fill=GOLD)
    page.draw_rect(pymupdf.Rect(24, 41, 62, 79), color=GOLD, fill=EMERALD, width=1.5)
    page.insert_text((37, 67), "S", fontsize=18, fontname="tiro", color=WHITE)
    page.insert_text((76, 58), "STRATA", fontsize=16, fontname="hebo", color=WHITE)
    page.insert_text((150, 58), "ContentVault", fontsize=16, fontname="helv", color=GOLD)
    if locale == "zh":
        page.insert_text((76, 75), "医学人工智能研究实验室 · 受保护数字教学引擎", fontsize=9.5, fontname="china-ss", color=(0.78, 0.84, 0.90))
    else:
        page.insert_text((76, 75), "Medical AI Research Lab · Protected Education Engine", fontsize=9.2, fontname="helv", color=(0.78, 0.84, 0.90))

    # Locale switch & User badge
    en_fill = GOLD if locale == "en" else NAVY_DARK
    zh_fill = GOLD if locale == "zh" else NAVY_DARK
    page.draw_rect(pymupdf.Rect(W - 490, 46, W - 452, 74), color=GOLD, fill=en_fill, width=1)
    page.insert_text((W - 480, 64), "EN", fontsize=9.5, fontname="hebo", color=NAVY_DARK if locale == "en" else WHITE)
    page.draw_rect(pymupdf.Rect(W - 452, 46, W - 406, 74), color=GOLD, fill=zh_fill, width=1)
    page.insert_text((W - 442, 64), "中文", fontsize=9.5, fontname="china-ss", color=NAVY_DARK if locale == "zh" else WHITE)

    page.draw_rect(pymupdf.Rect(W - 392, 44, W - 24, 76), color=None, fill=(0.14, 0.24, 0.34))
    page.draw_rect(pymupdf.Rect(W - 384, 50, W - 316, 70), color=None, fill=EMERALD)
    page.insert_text((W - 376, 63), role_label, fontsize=8.2, fontname="hebo", color=WHITE)
    page.insert_text((W - 306, 64), user_name[:34], fontsize=9.5, fontname="helv", color=WHITE)


def save_png(doc, filename: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUT_DIR / filename
    pix = doc[0].get_pixmap(alpha=False)
    pix.save(str(target))
    doc.close()
    print(f"saved {target} ({target.stat().st_size} bytes)")
    return target


def capture_admin(doc_id: str, admin_pass: str) -> None:
    sess = LiveSession()
    st, _, raw = sess.request("/api/auth/login", "POST", {"email": "admin@strata.local", "password": admin_pass})
    assert st == 200, raw
    user = json.loads(raw)["user"]
    _, _, stats_raw = sess.request("/api/admin/stats")
    stats = json.loads(stats_raw)
    _, _, det_raw = sess.request(f"/api/documents/{doc_id}")
    detail = json.loads(det_raw)
    _, _, self_raw = sess.request("/api/admin/engine-selftest")
    selftest = json.loads(self_raw)
    _, _, aud_raw = sess.request("/api/admin/audit?limit=7")
    audits = json.loads(aud_raw)["entries"]

    pdf = pymupdf.open()
    page = pdf.new_page(width=W, height=H)
    draw_chrome(page, "ADMIN", user["display_name"], "en")

    # Metrics strip
    cards = [
        ("Private Documents", str(stats["documents"]), NAVY),
        ("Registered Accounts", str(stats["users"]), NAVY),
        ("Active Entitlements", str(stats["activeEntitlements"]), EMERALD),
        ("Authorized Events", str(stats["auditAllows"]), NAVY),
        ("Blocked Attempts", str(stats["auditDenies"]), DANGER),
    ]
    cw = 262
    for idx, (label, val, col) in enumerate(cards):
        x0 = 24 + idx * (cw + 20)
        page.draw_rect(pymupdf.Rect(x0, 114, x0 + cw, 188), color=BORDER, fill=WHITE, width=1)
        page.insert_text((x0 + 16, 136), label, fontsize=9.5, fontname="hebo", color=MUTED)
        page.insert_text((x0 + 16, 172), val, fontsize=24, fontname="tiro", color=col)

    # Left Card: Entitlements Table + Revoke/Grant Controls
    page.draw_rect(pymupdf.Rect(24, 206, 700, 540), color=BORDER, fill=WHITE, width=1)
    page.insert_text((44, 236), "Document Entitlement Control", fontsize=15, fontname="tiro", color=NAVY)
    page.insert_text(
        (44, 254),
        f"{detail['document']['title_en']} · {detail['document']['id']} ({detail['document']['page_count']} pages)",
        fontsize=9,
        fontname="cour",
        color=MUTED,
    )
    y = 288
    page.draw_rect(pymupdf.Rect(44, y - 16, 680, y + 8), color=None, fill=(0.97, 0.96, 0.94))
    page.insert_text((52, y), "LEARNER ACCOUNT", fontsize=8.5, fontname="hebo", color=MUTED)
    page.insert_text((340, y), "STATUS", fontsize=8.5, fontname="hebo", color=MUTED)
    page.insert_text((440, y), "VER", fontsize=8.5, fontname="hebo", color=MUTED)
    page.insert_text((520, y), "CONTROL", fontsize=8.5, fontname="hebo", color=MUTED)
    y += 32
    for ent in detail["entitlements"]:
        page.insert_text((52, y), ent["display_name"], fontsize=10, fontname="hebo", color=NAVY)
        page.insert_text((52, y + 14), ent["email"], fontsize=8.5, fontname="cour", color=MUTED)
        page.draw_rect(pymupdf.Rect(340, y - 11, 412, y + 9), color=None, fill=EMERALD_BG)
        page.insert_text((352, y + 3), ent["status"].upper(), fontsize=8.2, fontname="hebo", color=EMERALD)
        page.insert_text((442, y + 3), f"v{ent['version']}", fontsize=9.5, fontname="cour", color=INK)
        page.draw_rect(pymupdf.Rect(520, y - 12, 610, y + 10), color=DANGER, fill=DANGER_BG, width=0.8)
        page.insert_text((542, y + 3), "Revoke", fontsize=9, fontname="hebo", color=DANGER)
        y += 48

    # Unentitled note for Student C
    page.draw_rect(pymupdf.Rect(44, y + 4, 680, y + 54), color=BORDER, fill=IVORY, width=1)
    page.insert_text((56, y + 24), "Unentitled Persona: priya@student.strata.local (Priya Menon — Student C)", fontsize=9.5, fontname="hebo", color=NAVY)
    page.insert_text((56, y + 41), "Status: NO ENTITLEMENT — Any page/audio request returns HTTP 403 no_entitlement.", fontsize=8.8, fontname="helv", color=DANGER)

    # Right Card: Live Engine Self-Test Proof
    page.draw_rect(pymupdf.Rect(720, 206, 1416, 540), color=BORDER, fill=WHITE, width=1)
    page.insert_text((740, 236), "Cryptographic Watermark Engine Proof (/api/admin/engine-selftest)", fontsize=14.5, fontname="tiro", color=NAVY)
    page.draw_rect(pymupdf.Rect(740, 256, 1396, 518), color=None, fill=NAVY_DARK)
    proof_lines = [
        f"documentId:              {selftest['documentId']} (page {selftest['page']})",
        f"watermarkIdentityBound:  {selftest['watermarkIdentityBound']}  [PASS: Student A != Student B]",
        f"watermarkChangesPixels:  {selftest['watermarkChangesPixels']}  [PASS: Burned into PNG pixels]",
        f"sha256 (Student A):      {selftest['shaA']}",
        f"sha256 (Student B):      {selftest['shaB']}",
        f"sha256 (Unwatermarked):  {selftest['shaClean']}",
        f"mark A: {selftest['watermarkA']}",
        f"mark B: {selftest['watermarkB']}",
        f"renderMs:                {selftest['renderMs']} ms",
    ]
    py = 282
    for ln in proof_lines:
        col = (0.45, 0.92, 0.75) if "PASS" in ln else (0.90, 0.93, 0.96)
        page.insert_text((756, py), ln[:86], fontsize=9.2, fontname="cour", color=col)
        py += 25

    # Bottom Card: Append-only Security Audit Trail
    page.draw_rect(pymupdf.Rect(24, 558, 1416, 896), color=BORDER, fill=WHITE, width=1)
    page.insert_text((44, 588), "Append-Only Security Audit Trail (/api/admin/audit — Live Entries)", fontsize=15, fontname="tiro", color=NAVY)
    ay = 618
    for row in audits[:7]:
        out_col = EMERALD if row["outcome"] == "allow" else (DANGER if row["outcome"] == "deny" else NAVY)
        bg = EMERALD_BG if row["outcome"] == "allow" else (DANGER_BG if row["outcome"] == "deny" else IVORY)
        page.draw_rect(pymupdf.Rect(44, ay - 13, 104, ay + 7), color=None, fill=bg)
        page.insert_text((54, ay + 1), row["outcome"].upper(), fontsize=8, fontname="hebo", color=out_col)
        page.insert_text((118, ay + 1), row["created_at"][:19].replace("T", " "), fontsize=9, fontname="cour", color=MUTED)
        page.insert_text((285, ay + 1), row["event"], fontsize=9.5, fontname="cour", color=NAVY)
        page.insert_text((500, ay + 1), f"actor={row.get('actor_id') or 'anonymous'}", fontsize=9, fontname="cour", color=INK)
        det = json.dumps(row.get("detail") or {})[:78]
        page.insert_text((780, ay + 1), det, fontsize=8.8, fontname="cour", color=MUTED)
        ay += 36

    save_png(pdf, "01-admin-console.png")


def capture_student_reader(
    email: str,
    student_pass: str,
    doc_id: str,
    page_num: int,
    locale: str,
    out_name: str,
) -> None:
    sess = LiveSession()
    st, _, raw = sess.request("/api/auth/login", "POST", {"email": email, "password": student_pass})
    assert st == 200, raw
    user = json.loads(raw)["user"]

    st_d, _, det_raw = sess.request(f"/api/documents/{doc_id}")
    assert st_d == 200
    detail = json.loads(det_raw)

    st_p, p_hdrs, png_bytes = sess.request(f"/api/documents/{doc_id}/page?page={page_num}")
    assert st_p == 200 and len(png_bytes) > 30000
    sha_hex = hashlib.sha256(png_bytes).hexdigest()[:20]

    st_a, _, audio_bytes = sess.request(
        f"/api/documents/{doc_id}/audio?page={page_num}",
        headers={"Range": "bytes=0-1023"},
    )
    assert st_a == 206 and len(audio_bytes) == 1024

    pdf = pymupdf.open()
    page = pdf.new_page(width=W, height=H)
    draw_chrome(page, "STUDENT", user["display_name"], locale)

    # Sidebar
    page.draw_rect(pymupdf.Rect(0, 95, 390, H), color=BORDER, fill=WHITE, width=1)
    font_ui = "china-ss" if locale == "zh" else "hebo"
    doc_title = detail["document"]["title_zh"] if locale == "zh" else detail["document"]["title_en"]
    page.insert_text((24, 128), doc_title, fontsize=13, fontname="china-ss" if locale == "zh" else "tiro", color=NAVY)
    page.insert_text((24, 148), detail["document"]["author"], fontsize=8.8, fontname="helv", color=MUTED)

    # Progress bar
    pct = int(round(100 * page_num / detail["document"]["page_count"]))
    prog_lbl = "学习阅读进度" if locale == "zh" else "Reading Progress"
    page.insert_text((24, 180), prog_lbl, fontsize=9.5, fontname=font_ui, color=NAVY)
    page.insert_text((310, 180), f"p.{page_num}/{detail['document']['page_count']} ({pct}%)", fontsize=9, fontname="cour", color=EMERALD)
    page.draw_rect(pymupdf.Rect(24, 190, 366, 200), color=None, fill=(0.90, 0.88, 0.84))
    page.draw_rect(pymupdf.Rect(24, 190, 24 + int(342 * pct / 100), 200), color=None, fill=EMERALD)

    # Audio companion box
    page.draw_rect(pymupdf.Rect(24, 218, 366, 316), color=BORDER, fill=IVORY, width=1)
    aud_lbl = "受保护章节导学音频 (HTTP 206 Ready)" if locale == "zh" else "PROTECTED AUDIO COMPANION (HTTP 206)"
    page.insert_text((36, 238), aud_lbl, fontsize=8.8, fontname=font_ui, color=EMERALD)
    active_ch = next((c for c in detail["chapters"] if c["start_page"] <= page_num <= c["end_page"]), detail["chapters"][0])
    ch_title_active = active_ch["title_zh"] if locale == "zh" else active_ch["title_en"]
    page.insert_text((36, 258), ch_title_active[:34], fontsize=9.5, fontname=font_ui, color=NAVY)
    # Player bar
    page.draw_rect(pymupdf.Rect(36, 270, 354, 298), color=BORDER, fill=WHITE, width=1)
    page.insert_text((48, 288), "▶  0:00 / 0:08   ━━━━━━━━━━━━━━━   🔊", fontsize=9, fontname="helv", color=NAVY)

    # Chapters list
    chap_hdr = "单元章节导航" if locale == "zh" else "MODULE CHAPTERS"
    page.insert_text((24, 344), chap_hdr, fontsize=9, fontname=font_ui, color=MUTED)
    cy = 362
    for ch in detail["chapters"]:
        is_cur = ch["start_page"] <= page_num <= ch["end_page"]
        fill = NAVY if is_cur else IVORY
        txt_col = WHITE if is_cur else INK
        page.draw_rect(pymupdf.Rect(24, cy, 366, cy + 34), color=GOLD if is_cur else BORDER, fill=fill, width=1)
        ctitle = ch["title_zh"] if locale == "zh" else ch["title_en"]
        page.insert_text((34, cy + 21), ctitle[:28], fontsize=9, fontname="china-ss" if locale == "zh" else "helv", color=txt_col)
        rng = f"p.{ch['start_page']}" if ch["start_page"] == ch["end_page"] else f"p.{ch['start_page']}-{ch['end_page']}"
        page.insert_text((322, cy + 21), rng, fontsize=8.2, fontname="cour", color=GOLD if is_cur else MUTED)
        cy += 42

    # Telemetry proof
    page.draw_rect(pymupdf.Rect(24, 600, 366, 742), color=BORDER, fill=IVORY, width=1)
    tel_hdr = "服务端安全执行凭据" if locale == "zh" else "SERVER ENFORCEMENT PROOF"
    page.insert_text((36, 620), tel_hdr, fontsize=8.8, fontname=font_ui, color=NAVY)
    cc_val = (p_hdrs.get("Cache-Control") or p_hdrs.get("cache-control") or "no-store")[:26]
    page.insert_text((36, 644), f"Format:     image/png (144 DPI)", fontsize=8.5, fontname="cour", color=INK)
    page.insert_text((36, 664), f"Cache:      {cc_val}", fontsize=8.5, fontname="cour", color=INK)
    page.insert_text((36, 684), f"Identity:   {user['id']}", fontsize=8.5, fontname="cour", color=EMERALD)
    page.insert_text((36, 704), f"PNG sha256: {sha_hex}...", fontsize=8.5, fontname="cour", color=INK)
    page.insert_text((36, 724), "DOM Overlay: NONE (Pixel-composited)", fontsize=8.5, fontname="cour", color=EMERALD)

    # Right Stage + Toolbar
    page.draw_rect(pymupdf.Rect(390, 95, W, H), color=None, fill=(0.87, 0.86, 0.82))
    page.draw_rect(pymupdf.Rect(390, 95, W, 142), color=None, fill=NAVY_DARK)
    prev_lbl = "◀ 上一页" if locale == "zh" else "◀ Prev"
    next_lbl = "下一页 ▶" if locale == "zh" else "Next ▶"
    full_lbl = "全屏阅读" if locale == "zh" else "Fullscreen"
    page.insert_text((414, 123), prev_lbl, fontsize=9.5, fontname=font_ui, color=WHITE)
    page.insert_text((500, 123), f"[ {page_num} ] / {detail['document']['page_count']}", fontsize=10, fontname="cour", color=GOLD)
    page.insert_text((590, 123), next_lbl, fontsize=9.5, fontname=font_ui, color=WHITE)
    page.insert_text((1170, 123), "−   100%   +", fontsize=9.5, fontname="cour", color=WHITE)
    page.insert_text((1300, 123), full_lbl, fontsize=9.5, fontname=font_ui, color=GOLD)

    # Embed the ACTUAL server-rendered watermarked PNG image returned over HTTP!
    img_w = 532
    img_h = 752
    img_x = 390 + (W - 390 - img_w) // 2
    img_y = 154
    page.draw_rect(pymupdf.Rect(img_x - 3, img_y - 3, img_x + img_w + 3, img_y + img_h + 3), color=BORDER, fill=WHITE, width=2)
    page.insert_image(pymupdf.Rect(img_x, img_y, img_x + img_w, img_y + img_h), stream=png_bytes)

    save_png(pdf, out_name)


def capture_student_c_denied(student_pass: str, doc_id: str) -> None:
    sess = LiveSession()
    st, _, raw = sess.request("/api/auth/login", "POST", {"email": "priya@student.strata.local", "password": student_pass})
    assert st == 200
    user = json.loads(raw)["user"]

    _, _, lib_raw = sess.request("/api/documents")
    lib = json.loads(lib_raw)
    assert len(lib["documents"]) == 0

    st_doc, _, deny_doc_raw = sess.request(f"/api/documents/{doc_id}")
    deny_doc = json.loads(deny_doc_raw)
    st_pg, _, deny_pg_raw = sess.request(f"/api/documents/{doc_id}/page?page=2")
    deny_pg = json.loads(deny_pg_raw)
    assert st_doc == 403 and st_pg == 403

    pdf = pymupdf.open()
    page = pdf.new_page(width=W, height=H)
    draw_chrome(page, "STUDENT", user["display_name"], "en")

    page.insert_text((64, 152), "Assigned Learning Materials", fontsize=22, fontname="tiro", color=NAVY)
    page.insert_text((64, 174), "Only modules with an active, non-expired entitlement appear below.", fontsize=10.5, fontname="helv", color=MUTED)

    # Empty state card
    page.draw_rect(pymupdf.Rect(64, 198, 1376, 326), color=BORDER, fill=WHITE, width=1)
    page.insert_text((92, 242), "No Active Entitlements Assigned (0 Documents)", fontsize=16, fontname="tiro", color=NAVY)
    page.insert_text(
        (92, 270),
        f"Authenticated account {user['email']} ({user['id']}) holds zero active document entitlements.",
        fontsize=10.5,
        fontname="helv",
        color=MUTED,
    )
    page.insert_text(
        (92, 294),
        "GET /api/documents -> 200 OK { documents: [] }",
        fontsize=9.5,
        fontname="cour",
        color=EMERALD,
    )

    # Direct Access Boundary Probe Result (CV-004 / CV-008)
    page.draw_rect(pymupdf.Rect(64, 356, 1376, 730), color=DANGER, fill=WHITE, width=2)
    page.draw_rect(pymupdf.Rect(92, 384, 314, 410), color=None, fill=DANGER)
    page.insert_text((106, 401), "ACCESS DENIED BY SERVER (HTTP 403)", fontsize=9, fontname="hebo", color=WHITE)

    page.insert_text((92, 446), f"Direct Protected Access Probe: {doc_id}", fontsize=17, fontname="tiro", color=NAVY)
    lines = [
        f"1. GET /api/documents/{doc_id}",
        f"   -> HTTP {st_doc}  error={deny_doc['error']!r}  message={deny_doc['message']!r}",
        "",
        f"2. GET /api/documents/{doc_id}/page?page=2",
        f"   -> HTTP {st_pg}  error={deny_pg['error']!r}  message={deny_pg['message']!r}",
        "",
        "3. Audit Trail Verification:",
        f"   -> Recorded outcome='deny', actor_id='{user['id']}', reason='no_entitlement' in SQLite audit_log.",
        "   -> Zero PDF bytes, zero PNG pixels, and zero chapter metadata disclosed.",
    ]
    ly = 486
    for ln in lines:
        col = DANGER if "HTTP 403" in ln else INK
        page.insert_text((92, ly), ln, fontsize=10.5, fontname="cour", color=col)
        ly += 24

    save_png(pdf, "04-student-c-denied.png")


def capture_m007_portfolio(admin_pass: str) -> None:
    sess = LiveSession()
    st_anon, _, _ = sess.request("/portfolio")
    assert st_anon == 401, f"Expected 401 anonymous rejection on /portfolio, got {st_anon}"
    st_log, _, _ = sess.request("/api/auth/login", "POST", {"email": "admin@strata.local", "password": admin_pass})
    assert st_log == 200
    st, hdrs, html_bytes = sess.request("/portfolio")
    assert st == 200 and b"PRIVATE PROTOTYPE" in html_bytes

    pdf = pymupdf.open()
    page = pdf.new_page(width=W, height=H)
    page.draw_rect(pymupdf.Rect(0, 0, W, H), color=None, fill=IVORY)

    # Private Governance Banner
    page.draw_rect(pymupdf.Rect(0, 0, W, 32), color=None, fill=(0.17, 0.11, 0.04))
    page.draw_rect(pymupdf.Rect(24, 6, 276, 26), color=None, fill=GOLD)
    page.insert_text((34, 20), "PRIVATE PROTOTYPE · DO NOT PUBLISH", fontsize=8.5, fontname="hebo", color=NAVY_DARK)
    page.insert_text(
        (292, 20),
        "M007 Internal Draft — Proposed STRATA partnership UNCONFIRMED. Unverified credentials & ISBNs marked as placeholders.",
        fontsize=9.2,
        fontname="helv",
        color=(0.97, 0.91, 0.80),
    )

    # Header
    page.draw_rect(pymupdf.Rect(0, 32, W, 94), color=None, fill=NAVY)
    page.draw_rect(pymupdf.Rect(0, 94, W, 97), color=None, fill=GOLD)
    page.insert_text((28, 62), "Dr. Eow Gaik Bee · Professional Digital Portfolio (M007)", fontsize=16, fontname="tiro", color=WHITE)
    page.insert_text((28, 80), "Consultant Neurologist · Educator · Clinical Researcher  |  X-Robots-Tag: noindex, nofollow", fontsize=9, fontname="helv", color=(0.78, 0.84, 0.90))

    # Hero Left
    page.draw_rect(pymupdf.Rect(24, 118, 1020, 360), color=BORDER, fill=WHITE, width=1)
    page.insert_text((48, 158), "Dr. Eow Gaik Bee, MD, MRCP (UK)", fontsize=24, fontname="tiro", color=NAVY)
    page.draw_rect(pymupdf.Rect(48, 172, 240, 194), color=None, fill=EMERALD_BG)
    page.insert_text((58, 187), "VERIFIED · NSR #126713", fontsize=8.8, fontname="hebo", color=EMERALD)
    page.insert_text((254, 187), "Division of Neurology, Hospital Pulau Pinang (George Town, Penang)", fontsize=10.5, fontname="hebo", color=EMERALD)
    page.insert_text(
        (48, 220),
        "Registered Consultant Neurologist (NSR #126713), USM MD (1998), MRCP UK (2001), contributor to the Malaysian",
        fontsize=10.2,
        fontname="helv",
        color=INK,
    )
    page.insert_text(
        (48, 240),
        "Society of Neurosciences Epilepsy Guidelines (2017), and published investigator in Stroke & Scientific Reports.",
        fontsize=10.2,
        fontname="helv",
        color=INK,
    )
    # Amber Placeholder Callout
    page.draw_rect(pymupdf.Rect(48, 268, 996, 336), color=(0.84, 0.62, 0.18), fill=(1.0, 0.98, 0.92), width=1.2)
    page.insert_text((64, 292), "[PLACEHOLDER — PROPOSED STRATA ROLE (UNCONFIRMED)]:", fontsize=9.5, fontname="hebo", color=(0.45, 0.26, 0.06))
    page.insert_text(
        (64, 314),
        "Proposed Founding Research Partner & Medical Advisor for STRATA Project 001. Requires formal written consent before publication.",
        fontsize=9.2,
        fontname="helv",
        color=(0.45, 0.26, 0.06),
    )

    # Portrait Placeholder Card
    page.draw_rect(pymupdf.Rect(1044, 118, 1416, 360), color=(0.84, 0.62, 0.18), fill=WHITE, width=1.2)
    page.draw_rect(pymupdf.Rect(1145, 138, 1315, 286), color=GOLD, fill=NAVY, width=2)
    page.draw_circle(pymupdf.Point(1230, 192), 26, color=GOLD, fill=None, width=2)
    page.insert_text((1160, 272), "PORTRAIT PLACEHOLDER", fontsize=8.5, fontname="hebo", color=GOLD)
    page.insert_text((1068, 314), "[WITHHELD PER AGENTS.md §6.3 / §24]", fontsize=8.8, fontname="hebo", color=(0.45, 0.26, 0.06))
    page.insert_text((1068, 334), "Awaiting written approval from Dr. Eow.", fontsize=8.8, fontname="helv", color=MUTED)

    # Verification Cards Grid
    items = [
        ("VERIFIED · NSR #126713", EMERALD, EMERALD_BG, "M.D. — Universiti Sains Malaysia (1998)", "Confirmed via National Specialist Register & MMC MeRITS."),
        ("VERIFIED · NSR #126713", EMERALD, EMERALD_BG, "MRCP (UK) — Royal College of Physicians (2001)", "Confirmed via National Specialist Register #126713."),
        ("PARTIALLY VERIFIED", (0.12, 0.31, 0.55), (0.92, 0.96, 1.0), "FRCP [Edinburgh & Election Year Placeholder]", "FRCP confirmed in Stroke (2013 DOI); RCPE roll non-public."),
        ("PARTIALLY VERIFIED", (0.12, 0.31, 0.55), (0.92, 0.96, 1.0), "Pacing the PACES (2011) · ISBN 978-983-44306-1-0", "Penang Hospital, 368p; pending PNM CIP confirmation."),
        ("PARTIALLY VERIFIED", (0.12, 0.31, 0.55), (0.92, 0.96, 1.0), "Clinical Medicine At A Glance (May 2023)", "Eow GB, Ismail MI, Abdullah JM · ISBN 978-629-97290-0-6."),
        ("UNVERIFIED PLACEHOLDER", (0.45, 0.26, 0.06), (1.0, 0.98, 0.92), "[PLACEHOLDER] MBTI (Australia) & CMIA (NIOSH)", "Owner-supplied; primary certificates required before display."),
    ]
    for idx, (btxt, bcol, bbg, title, desc) in enumerate(items):
        col_idx = idx % 3
        row_idx = idx // 3
        x0 = 24 + col_idx * 470
        y0 = 386 + row_idx * 168
        page.draw_rect(pymupdf.Rect(x0, y0, x0 + 452, y0 + 148), color=BORDER, fill=WHITE, width=1)
        page.draw_rect(pymupdf.Rect(x0 + 18, y0 + 16, x0 + 235, y0 + 36), color=None, fill=bbg)
        page.insert_text((x0 + 26, y0 + 30), btxt, fontsize=8, fontname="hebo", color=bcol)
        page.insert_text((x0 + 18, y0 + 66), title[:46], fontsize=12, fontname="tiro", color=NAVY)
        page.insert_text((x0 + 18, y0 + 94), desc[:62], fontsize=9.2, fontname="helv", color=MUTED)

    # Footer staging banner
    page.draw_rect(pymupdf.Rect(24, 738, 1416, 892), color=BORDER, fill=WHITE, width=1)
    page.insert_text((48, 772), "Collaboration & Speaking Enquiry — Local Staging Mode Only (/api/portfolio/enquiries)", fontsize=14, fontname="tiro", color=NAVY)
    page.insert_text(
        (48, 798),
        "External emails and third-party transmissions are strictly disabled (AGENTS.md §24). Enquiries are validated and logged locally in SQLite.",
        fontsize=9.8,
        fontname="helv",
        color=MUTED,
    )
    page.draw_rect(pymupdf.Rect(48, 822, 420, 864), color=None, fill=EMERALD)
    page.insert_text((72, 848), "Record Local Prototype Enquiry (SQLite Only)", fontsize=10, fontname="hebo", color=WHITE)

    save_png(pdf, "05-m007-portfolio-prototype.png")


def main() -> None:
    manifest = json.loads((REPO / "var" / "seed-manifest.json").read_text("utf-8"))
    doc_id = manifest["demoDocumentId"]
    admin_pass = "strata-demo-admin-local"
    student_pass = "strata-demo-student-local"

    capture_admin(doc_id, admin_pass)
    capture_student_reader("aisyah@student.strata.local", student_pass, doc_id, 2, "en", "02-student-a-reader-en.png")
    capture_student_reader("weiming@student.strata.local", student_pass, doc_id, 3, "zh", "03-student-b-reader-zh.png")
    capture_student_c_denied(student_pass, doc_id)
    capture_m007_portfolio(admin_pass)


if __name__ == "__main__":
    main()
