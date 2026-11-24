#!/usr/bin/env python3
"""
Generate the SYNTHETIC demonstration document for ContentVault.

This is not real teaching material. It is clearly labelled synthetic content so
the prototype can be demonstrated and tested without touching any copyrighted
book, student message or clinical record belonging to Dr. Eow.

Usage:  python make_synthetic_pdf.py <output.pdf>
"""

from __future__ import annotations

import sys
from pathlib import Path

import pymupdf

PAGE_W, PAGE_H = 595, 842  # A4 at 72 dpi

NAVY = (0.078, 0.169, 0.251)      # #142B40
EMERALD = (0.090, 0.349, 0.302)   # #17594D
GOLD = (0.773, 0.643, 0.427)      # #C5A46D
INK = (0.13, 0.15, 0.18)
MUTED = (0.42, 0.45, 0.50)

CHAPTERS = [
    {
        "title": "Chapter 1 - Orientation to the Neurological Consultation",
        "body": [
            "This synthetic module introduces the structure of a neurological",
            "consultation for educational demonstration purposes. It is written",
            "to exercise the ContentVault reader and does not contain clinical",
            "guidance for patient care.",
            "",
            "Learning objectives for this synthetic chapter:",
            "  1. Describe how a structured history supports a consultation.",
            "  2. Identify the components of an examination sequence.",
            "  3. Explain why findings are recorded systematically.",
            "",
            "Placeholder discussion: a consultation framework organises",
            "information so that observations can be reviewed later. The",
            "sequence shown here exists only to fill pages with realistic",
            "typography, headings and paragraph rhythm for reader testing.",
        ],
    },
    {
        "title": "Chapter 2 - Reading Electroencephalography: Pattern Recognition",
        "body": [
            "This synthetic chapter illustrates how a technical lesson might be",
            "laid out inside ContentVault. All text is invented for the",
            "demonstration and carries no clinical meaning.",
            "",
            "Section 2.1  Background rhythm",
            "A background description typically notes frequency, amplitude,",
            "symmetry and reactivity. In this placeholder text the goal is only",
            "to create document structure that the protected reader must render.",
            "",
            "Section 2.2  Transients",
            "Transient features are described in relation to their distribution",
            "over the scalp and their evolution over time. Again, this sentence",
            "is filler and must not be read as teaching content.",
            "",
            "Section 2.3  Reporting structure",
            "A report usually separates description from interpretation and",
            "conclusion. The synthetic text mirrors that structure so the",
            "reader can be evaluated with realistic page flow.",
        ],
    },
    {
        "title": "Chapter 3 - Neuro-ophthalmology Fundamentals",
        "body": [
            "Synthetic placeholder content for the third chapter. This page",
            "exists so that chapter navigation, page numbering and watermark",
            "tiling can be visually verified on a later page of the document.",
            "",
            "Section 3.1  Visual pathway overview",
            "The visual pathway runs from the retina through the optic nerve,",
            "chiasm, optic tract, lateral geniculate nucleus, optic radiations",
            "and occipital cortex. This anatomical sentence is general",
            "reference material included for layout only.",
            "",
            "Section 3.2  Structured examination",
            "A structured examination records visual acuity, colour vision,",
            "visual fields, pupillary responses and fundoscopy. The list here",
            "is used as typographic filler for the demonstration document.",
            "",
            "Section 3.3  Documentation",
            "Findings are documented so that another clinician could follow the",
            "reasoning. In this synthetic file the documentation is entirely",
            "fabricated and must never be treated as medical advice.",
        ],
    },
    {
        "title": "Chapter 4 - Electrodiagnostic Studies: A Case-Based Approach",
        "body": [
            "This synthetic chapter supplies a case-based layout for the reader",
            "demonstration. The case described is fictional and contains no",
            "patient information of any kind.",
            "",
            "Case example (fictional)",
            "  A synthetic scenario is presented with a short history, then",
            "  examination findings, then a discussion of how nerve conduction",
            "  and needle studies might be organised for teaching purposes.",
            "",
            "Discussion",
            "  The purpose of a case-based structure is to connect observations",
            "  to reasoning. Nothing on this page should be applied clinically.",
            "",
            "Reflection prompt for learners",
            "  Which part of the reasoning would you document first, and why?",
            "  This prompt is illustrative filler text only.",
        ],
    },
    {
        "title": "Chapter 5 - Reflective Practice and Professional Development",
        "body": [
            "Final synthetic chapter. This page is here so the reader has five",
            "pages to navigate and the chapter list can be exercised end to end.",
            "",
            "Section 5.1  Reflective cycle",
            "Reflection typically moves from experience to analysis to a changed",
            "action. The description is generic and included as filler.",
            "",
            "Section 5.2  Learning record",
            "A learning record captures what was studied, what was understood",
            "and what remains uncertain. This paragraph fills the page.",
            "",
            "Section 5.3  Next steps",
            "Next steps in this synthetic module are simply to close the reader,",
            "reopen the document and confirm that reading progress was saved",
            "against the signed-in synthetic student account.",
        ],
    },
]


def draw_header(page, chapter_index: int, total: int) -> None:
    page.draw_rect(pymupdf.Rect(0, 0, PAGE_W, 6), color=None, fill=NAVY)
    page.insert_text(
        (56, 54), "STRATA", fontsize=15, fontname="hebo", color=NAVY
    )
    page.insert_text(
        (56, 70),
        "ContentVault demonstration document",
        fontsize=8.5,
        fontname="helv",
        color=MUTED,
    )
    label = "SYNTHETIC CONTENT - NOT REAL TEACHING MATERIAL"
    page.draw_rect(
        pymupdf.Rect(PAGE_W - 300, 40, PAGE_W - 56, 62), color=None, fill=(0.96, 0.93, 0.86)
    )
    page.insert_text(
        (PAGE_W - 292, 54), label, fontsize=6.6, fontname="hebo", color=(0.55, 0.36, 0.10)
    )
    page.draw_line(
        pymupdf.Point(56, 84), pymupdf.Point(PAGE_W - 56, 84), color=GOLD, width=1.2
    )
    page.insert_text(
        (PAGE_W - 90, PAGE_H - 46),
        f"{chapter_index} / {total}",
        fontsize=8.5,
        fontname="helv",
        color=MUTED,
    )


def draw_cover(page) -> None:
    page.draw_rect(pymupdf.Rect(0, 0, PAGE_W, 300), color=None, fill=NAVY)
    page.draw_rect(pymupdf.Rect(0, 300, PAGE_W, 306), color=None, fill=GOLD)

    page.insert_text((56, 96), "STRATA", fontsize=34, fontname="hebo", color=(1, 1, 1))
    page.insert_text(
        (56, 120),
        "MEDICAL AI RESEARCH LAB",
        fontsize=9.5,
        fontname="helv",
        color=(0.78, 0.82, 0.86),
    )
    page.insert_text(
        (56, 196),
        "Neurology Teaching Module",
        fontsize=24,
        fontname="hebo",
        color=(1, 1, 1),
    )
    page.insert_text(
        (56, 222),
        "Synthetic demonstration edition",
        fontsize=12,
        fontname="helv",
        color=GOLD,
    )

    page.insert_text(
        (56, 372),
        "DOCUMENT STATUS",
        fontsize=9,
        fontname="hebo",
        color=EMERALD,
    )
    body = [
        "This file is synthetic. It was generated for the ContentVault",
        "proof of concept and contains no real medical teaching content,",
        "no patient information and no material from any published book.",
        "",
        "It exists so that the protected document reader, server-side",
        "watermarking and entitlement enforcement can be demonstrated with",
        "real file handling rather than a mockup.",
        "",
        "Author:  STRATA Engineering Agent (synthetic)",
        "Pages:   5",
        "Format:  PDF, A4, demonstration layout",
    ]
    y = 396
    for line in body:
        page.insert_text((56, y), line, fontsize=10.5, fontname="helv", color=INK)
        y += 17

    page.draw_rect(
        pymupdf.Rect(56, 620, PAGE_W - 56, 700), color=GOLD, fill=None, width=1
    )
    page.insert_text(
        (72, 646),
        "PROTECTED MATERIAL",
        fontsize=9,
        fontname="hebo",
        color=EMERALD,
    )
    page.insert_text(
        (72, 666),
        "Pages are rendered server-side and watermarked per learner.",
        fontsize=9.5,
        fontname="helv",
        color=INK,
    )
    page.insert_text(
        (72, 682),
        "Printed copies are traceable to the requesting account.",
        fontsize=9.5,
        fontname="helv",
        color=INK,
    )


def draw_chapter(page, chapter: dict, index: int, total: int) -> None:
    draw_header(page, index, total)
    y = 126
    page.insert_text(
        (56, y), chapter["title"], fontsize=16.5, fontname="hebo", color=NAVY
    )
    y += 14
    page.draw_line(
        pymupdf.Point(56, y), pymupdf.Point(200, y), color=GOLD, width=2
    )
    y += 30
    for line in chapter["body"]:
        page.insert_text((56, y), line, fontsize=10.6, fontname="helv", color=INK)
        y += 18.5

    page.draw_rect(
        pymupdf.Rect(PAGE_W - 176, PAGE_H - 92, PAGE_W - 56, PAGE_H - 58),
        color=EMERALD,
        fill=None,
        width=0.8,
    )
    page.insert_text(
        (PAGE_W - 168, PAGE_H - 78),
        "Audio companion available",
        fontsize=7.5,
        fontname="helv",
        color=EMERALD,
    )
    page.insert_text(
        (PAGE_W - 168, PAGE_H - 66),
        "see chapter navigation",
        fontsize=7.5,
        fontname="helv",
        color=MUTED,
    )


def build(output: Path) -> None:
    doc = pymupdf.open()
    try:
        cover = doc.new_page(width=PAGE_W, height=PAGE_H)
        draw_cover(cover)
        total = len(CHAPTERS)
        for i, chapter in enumerate(CHAPTERS, start=1):
            page = doc.new_page(width=PAGE_W, height=PAGE_H)
            draw_chapter(page, chapter, i, total)
        doc.set_metadata(
            {
                "title": "Neurology Teaching Module (Synthetic Demonstration)",
                "author": "STRATA Medical AI Research Lab (synthetic)",
                "subject": "Synthetic demonstration document for ContentVault",
                "keywords": "synthetic, demonstration, contentvault",
                "creator": "STRATA synthetic content generator",
            }
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        doc.save(str(output), garbage=3, deflate=True)
    finally:
        doc.close()
    print(f"wrote {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "synthetic-neurology-module.pdf")
    build(target)
