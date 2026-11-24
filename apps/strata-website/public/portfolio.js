/*
 * M007 — Professional Digital Portfolio Prototype (Private Development Mode)
 *
 * Strictly separates VERIFIED primary-source records (NSR #126713, MMC, DOIs)
 * from PARTIALLY_VERIFIED bibliographic entries and explicit UNVERIFIED
 * PLACEHOLDERS (AGENTS.md §3, §4, §6.3, §19, §24).
 */

(() => {
  "use strict";

  const CREDENTIALS = [
    {
      status: "verified",
      badge: "VERIFIED · NSR #126713",
      titleEn: "Doctor of Medicine (M.D.)",
      titleZh: "医学博士学位 (M.D.)",
      metaEn: "Universiti Sains Malaysia (USM) · Awarded 1998",
      metaZh: "马来西亚理科大学 (USM) · 1998年颁授",
      evidence: "https://www.nsr.org.my/list1viewdetails.asp?Account=4275",
    },
    {
      status: "verified",
      badge: "VERIFIED · NSR #126713",
      titleEn: "MRCP (UK)",
      titleZh: "英国皇家内科医学院院士资格 MRCP (UK)",
      metaEn: "Royal College of Physicians, United Kingdom · Awarded 2001",
      metaZh: "英国皇家内科医学院 · 2001年颁授",
      evidence: "https://www.nsr.org.my/list1viewdetails.asp?Account=4275",
    },
    {
      status: "verified",
      badge: "VERIFIED · NSR #126713",
      titleEn: "Specialist Registration — Internal Medicine & Neurology",
      titleZh: "马来西亚国家专科医生注册（内科与神经内科）",
      metaEn: "National Specialist Register of Malaysia · Hospital Pulau Pinang",
      metaZh: "马来西亚国家专科医生名录 #126713 · 槟城中央医院神经内科",
      evidence: "https://www.nsr.org.my/list1viewdetails.asp?Account=4275",
    },
    {
      status: "partial",
      badge: "PARTIALLY VERIFIED · PLACEHOLDER DETAIL",
      titleEn: "FRCP — [PLACEHOLDER: Edinburgh College & Election Year Pending]",
      titleZh: "FRCP 资深院士 — [占位待核：爱丁堡分院及当选年份待证书确认]",
      metaEn: "FRCP post-nominal verified in Stroke (AHA, 2013); RCPE directory is non-public",
      metaZh: "FRCP 头衔已由国际期刊 Stroke (2013) 证实；爱丁堡皇家内科医学院名录不公开检索",
      evidence: "https://doi.org/10.1161/STROKEAHA.113.002055",
      placeholder: true,
    },
    {
      status: "partial",
      badge: "PARTIALLY VERIFIED · PLACEHOLDER DATES",
      titleEn: "Epilepsy Fellowship — Cleveland Clinic Foundation, USA (2006)",
      titleZh: "美国克利夫兰医学中心癫痫专科进修 (2006) [证书细节待核]",
      metaEn: "Corroborated in Malaysian specialist directory; primary certificate pending inspection",
      metaZh: "经医疗专科名录佐证；原始进修证书编号及起止日期列为待核占位项",
      evidence: "Secondary specialist directory + AGENTS.md §3",
      placeholder: true,
    },
    {
      status: "placeholder",
      badge: "UNVERIFIED PLACEHOLDER",
      titleEn: "[PLACEHOLDER] Accredited MBTI Trainer (Australia) & CMIA (NIOSH)",
      titleZh: "[未核实占位] MBTI 认证讲师（澳大利亚）及 NIOSH 医疗伤残评估师 (CMIA)",
      metaEn: "Owner-supplied preliminary credentials; awaiting primary accreditation certificates",
      metaZh: "项目方初步提供信息；公开官方数据库无开放检索，须凭原始证书核验后方可正式展示",
      evidence: "Owner-supplied (AGENTS.md §3 — Pending Verification)",
      placeholder: true,
    },
  ];

  const TIMELINE = [
    {
      year: "1998",
      status: "verified",
      badge: "VERIFIED (NSR)",
      textEn: "Graduated with Doctor of Medicine (M.D.), Universiti Sains Malaysia.",
      textZh: "毕业于马来西亚理科大学（USM），获医学博士（M.D.）学位。",
    },
    {
      year: "2001",
      status: "verified",
      badge: "VERIFIED (NSR)",
      textEn: "Awarded Membership of the Royal Colleges of Physicians of the United Kingdom — MRCP (UK).",
      textZh: "获授英国皇家内科医学院院士资格 MRCP (UK)。",
    },
    {
      year: "2005",
      status: "partial",
      badge: "PARTIALLY VERIFIED",
      textEn: "Postgraduate neurology subspecialty training (Ministry of Health Malaysia) [Exact completion certificate placeholder].",
      textZh: "完成马来西亚卫生部神经内科专科培训 [具体结业证书日期占位待核]。",
      placeholder: true,
    },
    {
      year: "2006",
      status: "partial",
      badge: "PARTIALLY VERIFIED",
      textEn: "Epilepsy Fellowship training, Cleveland Clinic Foundation, Ohio, USA [Primary fellowship certificate placeholder].",
      textZh: "赴美国克利夫兰医学中心（Cleveland Clinic）完成癫痫专科进修 [原始证书待核]。",
      placeholder: true,
    },
    {
      year: "2009–Present",
      status: "verified",
      badge: "VERIFIED (NSR / MSN / DOI)",
      textEn: "Consultant Neurologist, Division of Neurology, Hospital Pulau Pinang; clinical investigator and medical author.",
      textZh: "任槟城中央医院神经内科顾问医生，参与多项国际脑卒中、脱髓鞘病与帕金森病临床研究及医学著作编写。",
    },
  ];

  const BOOKS = [
    {
      num: 1,
      title: "Practical Approach to Clinical Neurology",
      meta: "Reported 1st ed., 2009 · Medical Education",
      isbn: "[PLACEHOLDER: ISBN & Publisher Pending PNM Verification]",
      status: "placeholder",
      badge: "OWNER-SUPPLIED PLACEHOLDER",
    },
    {
      num: 2,
      title: "Pacing the PACES: Tips for Passing MRCP and Final MBBS",
      meta: "1st ed., 2011 · Publisher: Penang Hospital · 368 pages",
      isbn: "ISBN-13: 978-983-44306-1-0 (Publicly Indexed · Pending PNM CIP Check)",
      status: "partial",
      badge: "PARTIALLY VERIFIED",
    },
    {
      num: 3,
      title: "Electroencephalogram Examples & Guides (EEG)",
      meta: "Reported 1st ed., 2013 · Medical Education",
      isbn: "[PLACEHOLDER: ISBN & Edition Details Pending Verification]",
      status: "placeholder",
      badge: "OWNER-SUPPLIED PLACEHOLDER",
    },
    {
      num: 4,
      title: "Neuro-ophthalmology Made Easy",
      meta: "Reported 1st electronic ed., 2020 · Medical Education",
      isbn: "[PLACEHOLDER: Official eISBN & Co-author List Pending]",
      status: "partial",
      badge: "PARTIALLY VERIFIED (Title/Author)",
    },
    {
      num: 5,
      title: "Electrodiagnostic Medicine: A Case-Based Approach",
      meta: "Reported 1st electronic ed., 2021 · Medical Education",
      isbn: "[PLACEHOLDER: Official eISBN Pending Author Confirmation]",
      status: "placeholder",
      badge: "OWNER-SUPPLIED PLACEHOLDER",
    },
    {
      num: 6,
      title: "Clinical Medicine At A Glance",
      meta: "May 2023 · Co-authors: Gaik Bee Eow, Muhammad Ihfaz Ismail, Jafri Malin Abdullah · Publisher: Devine Love",
      isbn: "ISBN-13: 978-629-97290-0-6 (Author-Archived Record · Pending Print CIP Check)",
      status: "partial",
      badge: "PARTIALLY VERIFIED",
    },
    {
      num: 7,
      title: "We Are Our Best Doctors: Awaken the Healing Power Within Us (English)",
      meta: "2021 · Personal Development",
      isbn: "[PLACEHOLDER: ISBN Pending PNM Verification — 2021 Release Publicly Corroborated]",
      status: "partial",
      badge: "PARTIALLY VERIFIED",
    },
    {
      num: 8,
      title: "We Are Our Best Doctors (Mandarin Edition / 中文版)",
      meta: "Reported 2021 · Personal Development",
      isbn: "[PLACEHOLDER: Official Chinese Title & ISBN Pending Author Verification]",
      status: "placeholder",
      badge: "OWNER-SUPPLIED PLACEHOLDER",
    },
    {
      num: 9,
      title: "Understanding Self Through KHTP and Childhood Memories (Bilingual)",
      meta: "Reported 2021 · Educational Reflection (Non-Diagnostic)",
      isbn: "Reported eISBN: 978-983-44306-6-5 [Prefix & Checksum Valid · Pending PNM Check]",
      status: "placeholder",
      badge: "OWNER-SUPPLIED · ISBN CHECKSUM VALID",
    },
    {
      num: 10,
      title: "Life Book: A Step-by-Step Guide to Breakthrough, Transformation and Awakening (Bilingual)",
      meta: "Personal Development (Independent work; unaffiliated with Mindvalley)",
      isbn: "Reported ISBN: 978-983-44306-8-9 [Prefix & Checksum Valid · Year & PNM Check Pending]",
      status: "placeholder",
      badge: "OWNER-SUPPLIED · ISBN CHECKSUM VALID",
    },
  ];

  const JOURNALS = [
    {
      year: "2022",
      citation:
        "Chan PY, Ripin ZM, Halim SA, Arifin WN, Yahya AS, Eow GB, et al. Motion characteristics of subclinical tremors in Parkinson's disease and normal subjects. Scientific Reports 12(1):4021.",
      url: "https://www.nature.com/articles/s41598-022-07980-4",
    },
    {
      year: "2018",
      citation:
        "Hor JY, Lim TT, Chia YK, ..., Eow GB, et al. Prevalence of neuromyelitis optica spectrum disorder in the multi-ethnic Penang Island, Malaysia, and a review of worldwide prevalence. Multiple Sclerosis and Related Disorders 19:20–24.",
      url: "https://scholar.google.com/citations?hl=en&user=VuihjIsAAAAJ",
    },
    {
      year: "2017",
      citation:
        "Malaysian Society of Neurosciences. Consensus Guidelines on the Management of Epilepsy 2017 (Contributor: Dr. Eow Gaik Bee, Consultant Neurologist, Penang Hospital).",
      url: "https://www.neuro.org.my/assets/guideline/2017Epilepsy.pdf",
    },
    {
      year: "2014",
      citation:
        "Gopalai AA, Lim SY, ..., Eow GB, et al. LRRK2 G2385R and R1628P Mutations Are Associated with an Increased Risk of Parkinson's Disease in the Malaysian Population. BioMed Research International 2014:867321.",
      url: "https://doi.org/10.1155/2014/867321",
    },
    {
      year: "2013",
      citation:
        "Chen CLH, Young SHY, ..., Eow GB (FRCP, Steering Committee), et al. Chinese Medicine NeuroAiD Efficacy on Stroke Recovery (CHIMES). Stroke 44(8):2093–2100.",
      url: "https://doi.org/10.1161/STROKEAHA.113.002055",
    },
  ];

  const PROGRAMMES = [
    "EEG E-Books & Audio Teaching Series",
    "Electrodiagnostic Medicine Case Workshops",
    "Neuro-ophthalmology Clinical Localization Series",
    "English & Mandarin Transformation Masterclasses",
    "KHTP Reflective Drawing & Childhood Memories Workshop (Non-Diagnostic)",
  ];

  const UI_TEXT = {
    en: {
      govNotice:
        "M007 Draft for Internal Review Only — Proposed STRATA partnership is UNCONFIRMED. Unverified credentials, ISBNs, and media assets are explicitly marked as placeholders.",
      headerSub: "Consultant Neurologist · Educator · Clinical Researcher",
      navCredentials: "Qualifications",
      navTimeline: "Timeline",
      navPublications: "Publications",
      navProgrammes: "Programmes",
      navSpeaking: "Speaking & Media",
      navEnquiry: "Collaboration",
      highlightPlaceholders: "Highlight Placeholders",
      backToVault: "ContentVault →",
      heroName: "Dr. Eow Gaik Bee, MD, MRCP (UK)",
      heroRole:
        "Consultant Neurologist & Internal Medicine Specialist · Division of Neurology, Hospital Pulau Pinang",
      heroBio:
        "Registered Consultant Neurologist in George Town, Penang, Malaysia (National Specialist Register #126713), medical educator, and co-author of national epilepsy guidelines and peer-reviewed neurological research across stroke recovery, neuromyelitis optica spectrum disorder, and movement disorders.",
      proposedRoleNotice:
        "Proposed Founding Research Partner & Medical Advisor for STRATA Project 001. This collaboration is PROPOSED ONLY and awaits formal review and written consent from Dr. Eow Gaik Bee.",
      portraitNotice:
        "[PLACEHOLDER: Official portrait withheld in accordance with STRATA governance (AGENTS.md §6.3, §24) until written publication approval is granted.]",
      credentialsHeading: "Academic & Professional Qualifications",
      credentialsSub:
        "Cross-referenced on 2026-11-24 against the National Specialist Register of Malaysia (NSR), Malaysian Medical Council (MMC MeRITS), and peer-reviewed publications.",
      timelineHeading: "Academic & Clinical Career Timeline",
      pubsHeading: "Publications & Authored Monographs",
      pubsSub:
        "Separating verified peer-reviewed clinical research (DOI) from authored educational books and owner-supplied catalogue placeholders.",
      tabBooks: "Authored Books (10)",
      tabJournals: "Peer-Reviewed Research (Verified DOIs)",
      researchInterestsHeading: "Research & Educational Interests",
      programmesHeading: "Educational Programme Catalogue",
      programmesSub:
        "Preliminary programme inventory supplied for Digital Academy scoping — marked as placeholders pending partner validation.",
      speakingHeading: "Proposed International Speaking Topics",
      speakingSub: "Draft keynote and masterclass themes subject to speaker approval.",
      mediaKitHeading: "Speaker Media Resources",
      enquiryHeading: "Collaboration & Speaking Enquiry (Local Staging Mode)",
      enquirySub:
        "Per STRATA governance (AGENTS.md §18, §24), external communications are disabled in this prototype. Submissions are validated and recorded locally in SQLite for demonstration only.",
      enqName: "Your Name *",
      enqOrg: "Institution / Organization",
      enqEmail: "Official Email *",
      enqTopic: "Enquiry Category",
      enqMessage: "Proposed Collaboration Details (min 10 chars) *",
      enqSubmit: "Record Local Prototype Enquiry",
    },
    zh: {
      govNotice:
        "M007 内部审阅原型（禁止公开发布）— STRATA 研究合作尚处于拟议阶段（未确认）。所有未获一手官方核实的资质、ISBN 与媒体素材均已明确标注为占位项。",
      headerSub: "神经内科顾问医生 · 医学教育者 · 临床研究者",
      navCredentials: "学术与执业资质",
      navTimeline: "履历时间轴",
      navPublications: "学术论文与著作",
      navProgrammes: "课程体系",
      navSpeaking: "国际演讲与媒体包",
      navEnquiry: "合作咨询",
      highlightPlaceholders: "高亮显示待核占位项",
      backToVault: "返回 ContentVault →",
      heroName: "Dr. Eow Gaik Bee · 医学博士 MD, MRCP (UK)",
      heroRole: "神经内科与内科顾问专科医生 · 槟城中央医院神经内科",
      heroBio:
        "马来西亚国家专科医生名录注册神经内科顾问医生（NSR 编号 #126713，槟城乔治市），长期从事神经病学与脑电生理临床教学，参与编写马来西亚癫痫管理共识指南，并在国际同行评审期刊发表多项脑卒中康复、视神经脊髓炎谱系疾病及帕金森病临床研究。",
      proposedRoleNotice:
        "拟邀担任 STRATA Project 001 创始研究合作伙伴及医学顾问。该合作目前仅为拟议草案，须经 Dr. Eow 本人审阅并签署书面同意后方可确立。",
      portraitNotice:
        "[肖像占位符：依据 STRATA 治理规范（AGENTS.md §6.3, §24），在获得本人书面公开发布授权前，暂不展示个人肖像照片。]",
      credentialsHeading: "学术与专业执业资质核验清单",
      credentialsSub:
        "于 2026-11-24 对照马来西亚国家专科医生名录（NSR）、马来西亚医药理事会（MMC）及同行评审期刊记录完成核验。",
      timelineHeading: "学术与临床生涯时间轴",
      pubsHeading: "出版著作与同行评审临床研究",
      pubsSub: "严格区分经 DOI 核实的国际同行评审医学论文、部分核实著作与待核实书目占位项。",
      tabBooks: "编著书籍目录 (10)",
      tabJournals: "同行评审医学论文 (已核实 DOI)",
      researchInterestsHeading: "研究与数字教学方向",
      programmesHeading: "拟数字化课程目录（待核占位）",
      programmesSub: "以下课程清单源自初步项目简报，均标注为待合作伙伴确认占位项。",
      speakingHeading: "拟议国际学术与教育演讲主题",
      speakingSub: "供国际学术交流与合作评估使用的草案主题（须经讲者本人批准）。",
      mediaKitHeading: "讲者媒体资料包（占位状态）",
      enquiryHeading: "学术与课程合作咨询（本地原型暂存模式）",
      enquirySub:
        "依据 STRATA 安全规范（AGENTS.md §18, §24），本原型严禁向外发送邮件或外部通信；提交记录仅安全存入本地 SQLite 数据库用于功能验证。",
      enqName: "联系人姓名 *",
      enqOrg: "所属机构 / 学会 / 院校",
      enqEmail: "联系邮箱 *",
      enqTopic: "合作类别",
      enqMessage: "合作意向说明（至少 10 个字符） *",
      enqSubmit: "保存本地原型咨询记录",
    },
  };

  let locale = "en";
  const $ = (id) => document.getElementById(id);

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badgeClass(status) {
    if (status === "verified") return "v-badge v-verified";
    if (status === "partial") return "v-badge v-partial";
    return "v-badge v-placeholder";
  }

  function renderAll() {
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : "en";
    $("pf-en").classList.toggle("active", locale === "en");
    $("pf-zh").classList.toggle("active", locale === "zh");

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (UI_TEXT[locale][key]) {
        el.textContent = UI_TEXT[locale][key];
      }
    });

    // Credentials
    $("credentials-grid").innerHTML = CREDENTIALS.map(
      (c) => `
      <article class="cred-card" ${c.placeholder ? 'data-placeholder-item="true"' : ""}>
        <span class="${badgeClass(c.status)}">${esc(c.badge)}</span>
        <h3>${esc(locale === "zh" ? c.titleZh : c.titleEn)}</h3>
        <div class="cred-meta">${esc(locale === "zh" ? c.metaZh : c.metaEn)}</div>
        <div class="source-link">Source: ${esc(c.evidence)}</div>
      </article>
    `,
    ).join("");

    // Timeline
    $("timeline-list").innerHTML = TIMELINE.map(
      (row) => `
      <div class="tl-row" ${row.placeholder ? 'data-placeholder-item="true"' : ""}>
        <div class="tl-year">${esc(row.year)}</div>
        <div>${esc(locale === "zh" ? row.textZh : row.textEn)}</div>
        <span class="${badgeClass(row.status)}">${esc(row.badge)}</span>
      </div>
    `,
    ).join("");

    // Books
    $("pub-books-grid").innerHTML = BOOKS.map(
      (b) => `
      <article class="book-card" ${b.status !== "verified" ? 'data-placeholder-item="true"' : ""}>
        <span class="${badgeClass(b.status)}">#${b.num} · ${esc(b.badge)}</span>
        <h3>${esc(b.title)}</h3>
        <div class="book-meta">${esc(b.meta)}</div>
        <div class="source-link">${esc(b.isbn)}</div>
      </article>
    `,
    ).join("");

    // Journals
    $("pub-journals-list").innerHTML = JOURNALS.map(
      (j) => `
      <article class="journal-item">
        <span class="v-badge v-verified">VERIFIED PEER-REVIEWED RECORD · ${esc(j.year)}</span>
        <p style="margin: 8px 0 6px; font-weight: 500;">${esc(j.citation)}</p>
        <div class="source-link">${esc(j.url)}</div>
      </article>
    `,
    ).join("");

    // Programmes
    $("programmes-list").innerHTML = PROGRAMMES.map(
      (p) => `
      <div class="prog-item" data-placeholder-item="true">
        <span>${esc(p)}</span>
        <span class="v-badge v-placeholder">PLACEHOLDER</span>
      </div>
    `,
    ).join("");
  }

  $("pf-en").addEventListener("click", () => {
    locale = "en";
    renderAll();
  });
  $("pf-zh").addEventListener("click", () => {
    locale = "zh";
    renderAll();
  });

  $("btn-toggle-placeholders").addEventListener("click", () => {
    const active = document.body.classList.toggle("highlight-placeholders");
    $("btn-toggle-placeholders").setAttribute("aria-pressed", String(active));
  });

  $("tab-pub-books").addEventListener("click", () => {
    $("tab-pub-books").classList.add("active");
    $("tab-pub-journals").classList.remove("active");
    $("pub-books-grid").classList.remove("hidden");
    $("pub-journals-list").classList.add("hidden");
  });

  $("tab-pub-journals").addEventListener("click", () => {
    $("tab-pub-journals").classList.add("active");
    $("tab-pub-books").classList.remove("active");
    $("pub-journals-list").classList.remove("hidden");
    $("pub-books-grid").classList.add("hidden");
  });

  $("enquiry-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusBox = $("enq-status");
    statusBox.classList.remove("hidden", "enq-ok", "enq-err");

    const payload = {
      senderName: $("enq-name").value.trim(),
      senderOrg: $("enq-org").value.trim(),
      senderEmail: $("enq-email").value.trim(),
      topic: $("enq-topic").value,
      message: $("enq-message").value.trim(),
    };

    const res = await fetch("/api/portfolio/enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !data.ok) {
      statusBox.classList.add("enq-err");
      statusBox.textContent = data.message || "Validation failed.";
      return;
    }
    statusBox.classList.add("enq-ok");
    statusBox.textContent = `Saved locally (${data.enquiryId}) — ${data.notice}`;
    $("enquiry-form").reset();
  });

  renderAll();
})();
