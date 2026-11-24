/*
 * M007 — Professional Digital Portfolio Prototype (Private Reviewer/Admin Mode)
 *
 * Strictly separates VERIFIED primary-source records (NSR #126713, MSN 2017,
 * directly resolved publisher DOIs) from PARTIALLY_VERIFIED bibliographic
 * entries and explicit UNVERIFIED PLACEHOLDERS (AGENTS.md §3, §4, §6.3, §19, §24).
 * Provides complete English (EN) and Simplified Chinese (中文) localization.
 */

(() => {
  "use strict";

  const CREDENTIALS = [
    {
      status: "verified",
      badgeEn: "VERIFIED · NSR #126713",
      badgeZh: "已核实 · NSR #126713",
      titleEn: "Doctor of Medicine (M.D.)",
      titleZh: "医学博士学位 (M.D.)",
      metaEn: "Universiti Sains Malaysia (USM) · Awarded 1998",
      metaZh: "马来西亚理科大学 (USM) · 1998年颁授",
      evidence: "https://www.nsr.org.my/list1viewdetails.asp?Account=4275",
    },
    {
      status: "verified",
      badgeEn: "VERIFIED · NSR #126713",
      badgeZh: "已核实 · NSR #126713",
      titleEn: "MRCP (UK)",
      titleZh: "英国皇家内科医学院院士资格 MRCP (UK)",
      metaEn: "Royal College of Physicians, United Kingdom · Awarded 2001",
      metaZh: "英国皇家内科医学院 · 2001年颁授",
      evidence: "https://www.nsr.org.my/list1viewdetails.asp?Account=4275",
    },
    {
      status: "verified",
      badgeEn: "VERIFIED · NSR #126713",
      badgeZh: "已核实 · NSR #126713",
      titleEn: "Specialist Registration — Internal Medicine & Neurology",
      titleZh: "马来西亚国家专科医生注册（内科与神经内科）",
      metaEn: "National Specialist Register of Malaysia · Hospital Pulau Pinang",
      metaZh: "马来西亚国家专科医生名录 #126713 · 槟城中央医院神经内科",
      evidence: "https://www.nsr.org.my/list1viewdetails.asp?Account=4275",
    },
    {
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED · PLACEHOLDER DETAIL",
      badgeZh: "部分核实 · 证书细节待核",
      titleEn: "FRCP — [PLACEHOLDER: Edinburgh College & Election Year Pending]",
      titleZh: "FRCP 资深院士 — [占位待核：爱丁堡分院及当选年份待证书确认]",
      metaEn: "FRCP post-nominal verified in Stroke (AHA, 2013); RCPE directory is non-public",
      metaZh: "FRCP 头衔已由国际期刊 Stroke (2013) 证实；爱丁堡皇家内科医学院名录不公开检索",
      evidence: "https://doi.org/10.1161/STROKEAHA.113.002055",
      placeholder: true,
    },
    {
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED · PLACEHOLDER DATES",
      badgeZh: "部分核实 · 进修日期占位",
      titleEn: "Epilepsy Fellowship — Cleveland Clinic Foundation, USA (2006)",
      titleZh: "美国克利夫兰医学中心癫痫专科进修 (2006) [证书细节待核]",
      metaEn: "Corroborated in Malaysian specialist directory; primary certificate pending inspection",
      metaZh: "经医疗专科名录佐证；原始进修证书编号及起止日期列为待核占位项",
      evidence: "Secondary specialist directory + AGENTS.md §3",
      placeholder: true,
    },
    {
      status: "placeholder",
      badgeEn: "UNVERIFIED PLACEHOLDER",
      badgeZh: "未核实占位项",
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
      badgeEn: "VERIFIED (NSR)",
      badgeZh: "已核实 (NSR)",
      textEn: "Graduated with Doctor of Medicine (M.D.), Universiti Sains Malaysia.",
      textZh: "毕业于马来西亚理科大学（USM），获医学博士（M.D.）学位。",
    },
    {
      year: "2001",
      status: "verified",
      badgeEn: "VERIFIED (NSR)",
      badgeZh: "已核实 (NSR)",
      textEn: "Awarded Membership of the Royal Colleges of Physicians of the United Kingdom — MRCP (UK).",
      textZh: "获授英国皇家内科医学院院士资格 MRCP (UK)。",
    },
    {
      year: "2005",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED",
      badgeZh: "部分核实",
      textEn: "Postgraduate neurology subspecialty training (Ministry of Health Malaysia) [Exact completion certificate placeholder].",
      textZh: "完成马来西亚卫生部神经内科专科培训 [具体结业证书日期占位待核]。",
      placeholder: true,
    },
    {
      year: "2006",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED",
      badgeZh: "部分核实",
      textEn: "Epilepsy Fellowship training, Cleveland Clinic Foundation, Ohio, USA [Primary fellowship certificate placeholder].",
      textZh: "赴美国克利夫兰医学中心（Cleveland Clinic）完成癫痫专科进修 [原始证书待核]。",
      placeholder: true,
    },
    {
      year: "2009–Present",
      status: "verified",
      badgeEn: "VERIFIED (NSR / MSN / DOI)",
      badgeZh: "已核实 (NSR / 指南 / DOI)",
      textEn: "Consultant Neurologist, Division of Neurology, Hospital Pulau Pinang; clinical investigator and medical author.",
      textZh: "任槟城中央医院神经内科顾问医生，参与多项国际脑卒中、脱髓鞘病与帕金森病临床研究及医学著作编写。",
    },
  ];

  const BOOKS = [
    {
      num: 1,
      titleEn: "Practical Approach to Clinical Neurology",
      titleZh: "《临床神经病学实用方法》 (Practical Approach to Clinical Neurology)",
      metaEn: "Reported 1st ed., 2009 · Medical Education",
      metaZh: "项目简报载 2009 年第 1 版 · 临床医学教育",
      isbnEn: "[PLACEHOLDER: ISBN & Publisher Pending PNM Verification]",
      isbnZh: "[占位待核：ISBN 与出版机构待马来西亚国家图书馆 PNM 核实]",
      status: "placeholder",
      badgeEn: "OWNER-SUPPLIED PLACEHOLDER",
      badgeZh: "初步提供 · 待核占位",
    },
    {
      num: 2,
      titleEn: "Pacing the PACES: Tips for Passing MRCP and Final MBBS",
      titleZh: "《MRCP PACES 与医学毕业临床考试通关指南》 (Pacing the PACES)",
      metaEn: "1st ed., 2011 · Publisher: Penang Hospital · 368 pages",
      metaZh: "2011 年第 1 版 · 槟城中央医院出版 · 368 页",
      isbnEn: "ISBN-13: 978-983-44306-1-0 (Publicly Indexed · Pending PNM CIP Check)",
      isbnZh: "ISBN-13: 978-983-44306-1-0（公开书目已检索 · 待版权页复核）",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED",
      badgeZh: "部分核实",
    },
    {
      num: 3,
      titleEn: "Electroencephalogram Examples & Guides (EEG)",
      titleZh: "《脑电图图例与判读指南》 (Electroencephalogram Examples & Guides)",
      metaEn: "Reported 1st ed., 2013 · Medical Education",
      metaZh: "项目简报载 2013 年第 1 版 · 脑电生理教学",
      isbnEn: "[PLACEHOLDER: ISBN & Edition Details Pending Verification]",
      isbnZh: "[占位待核：ISBN 与版次信息待核实]",
      status: "placeholder",
      badgeEn: "OWNER-SUPPLIED PLACEHOLDER",
      badgeZh: "初步提供 · 待核占位",
    },
    {
      num: 4,
      titleEn: "Neuro-ophthalmology Made Easy",
      titleZh: "《简明神经眼科学》 (Neuro-ophthalmology Made Easy)",
      metaEn: "Reported 1st electronic ed., 2020 · Medical Education",
      metaZh: "2020 年第 1 电子版 · 神经眼科定位与病例教学",
      isbnEn: "[PLACEHOLDER: Official eISBN & Co-author List Pending]",
      isbnZh: "[占位待核：正式电子书号 eISBN 与合著者名单待确认]",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED (Title/Author)",
      badgeZh: "部分核实（书名与作者）",
    },
    {
      num: 5,
      titleEn: "Electrodiagnostic Medicine: A Case-Based Approach",
      titleZh: "《电诊断医学：病例导向解析》 (Electrodiagnostic Medicine: A Case-Based Approach)",
      metaEn: "Reported 1st electronic ed., 2021 · Medical Education",
      metaZh: "项目简报载 2021 年第 1 电子版 · 神经电诊断教学",
      isbnEn: "[PLACEHOLDER: Official eISBN Pending Author Confirmation]",
      isbnZh: "[占位待核：正式电子书号 eISBN 待作者确认]",
      status: "placeholder",
      badgeEn: "OWNER-SUPPLIED PLACEHOLDER",
      badgeZh: "初步提供 · 待核占位",
    },
    {
      num: 6,
      titleEn: "Clinical Medicine At A Glance",
      titleZh: "《临床医学精要速览》 (Clinical Medicine At A Glance)",
      metaEn: "May 2023 · Co-authors: Gaik Bee Eow, Muhammad Ihfaz Ismail, Jafri Malin Abdullah · Publisher: Devine Love",
      metaZh: "2023 年 5 月 · 合著者：Gaik Bee Eow, Muhammad Ihfaz Ismail, Jafri Malin Abdullah · 出版：Devine Love",
      isbnEn: "ISBN-13: 978-629-97290-0-6 (Author-Archived Record · Pending Print CIP Check)",
      isbnZh: "ISBN-13: 978-629-97290-0-6（作者学术档案记录 · 待纸质版权页复核）",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED",
      badgeZh: "部分核实",
    },
    {
      num: 7,
      titleEn: "We Are Our Best Doctors: Awaken the Healing Power Within Us (English)",
      titleZh: "《我们是自己最好的医生：唤醒内在疗愈力》（英文版）",
      metaEn: "2021 · Personal Development",
      metaZh: "2021 年 · 身心健康与自我成长",
      isbnEn: "[PLACEHOLDER: ISBN Pending PNM Verification — 2021 Release Publicly Corroborated]",
      isbnZh: "[占位待核：2021 年发行已获公开访谈佐证，ISBN 待核实]",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED",
      badgeZh: "部分核实",
    },
    {
      num: 8,
      titleEn: "We Are Our Best Doctors (Mandarin Edition)",
      titleZh: "《我们是自己最好的医生》（中文版）[正式书名待作者确认]",
      metaEn: "Reported 2021 · Personal Development",
      metaZh: "项目简报载 2021 年 · 个人成长教育",
      isbnEn: "[PLACEHOLDER: Official Chinese Title & ISBN Pending Author Verification]",
      isbnZh: "[占位待核：正式中文出版书名及 ISBN 待作者确认]",
      status: "placeholder",
      badgeEn: "OWNER-SUPPLIED PLACEHOLDER",
      badgeZh: "初步提供 · 待核占位",
    },
    {
      num: 9,
      titleEn: "Understanding Self Through KHTP and Childhood Memories (Bilingual)",
      titleZh: "《透过动态房树人（KHTP）与童年记忆理解自我》（中英双语版）",
      metaEn: "Reported 2021 · Educational Reflection (Non-Diagnostic)",
      metaZh: "项目简报载 2021 年 · 反思性自我探索教育（非临床诊断用途）",
      isbnEn: "Reported eISBN: 978-983-44306-6-5 [Prefix & Checksum Valid · Pending PNM Check]",
      isbnZh: "申报 eISBN: 978-983-44306-6-5 [出版商前缀与校验位有效 · 待 PNM 馆藏核实]",
      status: "placeholder",
      badgeEn: "OWNER-SUPPLIED · ISBN CHECKSUM VALID",
      badgeZh: "初步提供 · ISBN 校验位有效",
    },
    {
      num: 10,
      titleEn: "Life Book: A Step-by-Step Guide to Breakthrough, Transformation and Awakening (Bilingual)",
      titleZh: "《生命之书：突破、蜕变与觉醒的循序指南》（中英双语版）",
      metaEn: "Personal Development (Independent work; unaffiliated with Mindvalley)",
      metaZh: "个人成长课程读本（独立著作，与 Mindvalley 无任何关联）",
      isbnEn: "Reported ISBN: 978-983-44306-8-9 [Prefix & Checksum Valid · Year & PNM Check Pending]",
      isbnZh: "申报 ISBN: 978-983-44306-8-9 [出版商前缀与校验位有效 · 年份及馆藏待核]",
      status: "placeholder",
      badgeEn: "OWNER-SUPPLIED · ISBN CHECKSUM VALID",
      badgeZh: "初步提供 · ISBN 校验位有效",
    },
  ];

  const JOURNALS = [
    {
      year: "2017",
      status: "verified",
      badgeEn: "VERIFIED NATIONAL CLINICAL GUIDELINE · 2017",
      badgeZh: "已核实国家级临床指南 · 2017",
      citationEn:
        "Malaysian Society of Neurosciences. Consensus Guidelines on the Management of Epilepsy 2017 (Expert Panel Contributor: Dr. Eow Gaik Bee, Consultant Neurologist, Penang Hospital).",
      citationZh:
        "马来西亚神经科学学会《2017年癫痫管理共识指南》（专家组成员：槟城中央医院神经内科顾问医生 Dr. Eow Gaik Bee）。",
      url: "https://www.neuro.org.my/assets/guideline/2017Epilepsy.pdf",
    },
    {
      year: "2014",
      status: "verified",
      badgeEn: "VERIFIED PEER-REVIEWED DOI · 2014",
      badgeZh: "已核实同行评审期刊 DOI · 2014",
      citationEn:
        "Gopalai AA, Lim SY, ..., Eow GB, et al. LRR2 G2385R and R1628P Mutations Are Associated with an Increased Risk of Parkinson's Disease in the Malaysian Population. BioMed Research International 2014:867321.",
      citationZh:
        "Gopalai AA, Lim SY, ..., Eow GB 等：《马来西亚人群 LRRK2 G2385R 与 R1628P 突变与帕金森病风险研究》，BioMed Research International 2014:867321。",
      url: "https://doi.org/10.1155/2014/867321",
    },
    {
      year: "2013",
      status: "verified",
      badgeEn: "VERIFIED PEER-REVIEWED DOI · 2013",
      badgeZh: "已核实同行评审期刊 DOI · 2013",
      citationEn:
        "Chen CLH, Young SHY, ..., Eow GB (FRCP, Steering Committee), et al. Chinese Medicine NeuroAiD Efficacy on Stroke Recovery (CHIMES). Stroke 44(8):2093–2100.",
      citationZh:
        "Chen CLH, Young SHY, ..., Eow GB (FRCP, 指导委员会) 等：《脑卒中康复多中心双盲随机对照临床试验 (CHIMES)》，Stroke 44(8):2093–2100。",
      url: "https://doi.org/10.1161/STROKEAHA.113.002055",
    },
    {
      year: "2022",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED (Bibliographic Index · Direct Publisher Fetch Pending) · 2022",
      badgeZh: "部分核实（书目索引记录 · 待直接核验出版页）· 2022",
      citationEn:
        "Chan PY, Ripin ZM, Halim SA, Arifin WN, Yahya AS, Eow GB, et al. Motion characteristics of subclinical tremors in Parkinson's disease and normal subjects. Scientific Reports 12(1):4021.",
      citationZh:
        "Chan PY, Ripin ZM, Halim SA, Arifin WN, Yahya AS, Eow GB 等：《帕金森病与正常受试者亚临床震颤运动特征分析》，Scientific Reports 12(1):4021。",
      url: "https://www.nature.com/articles/s41598-022-07980-4",
      placeholder: true,
    },
    {
      year: "2018",
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED (Google Scholar Index · Direct DOI Pending) · 2018",
      badgeZh: "部分核实（学术索引记录 · 待补充直接 DOI）· 2018",
      citationEn:
        "Hor JY, Lim TT, Chia YK, ..., Eow GB, et al. Prevalence of neuromyelitis optica spectrum disorder in the multi-ethnic Penang Island, Malaysia, and a review of worldwide prevalence. Multiple Sclerosis and Related Disorders 19:20–24.",
      citationZh:
        "Hor JY, Lim TT, Chia YK, ..., Eow GB 等：《马来西亚槟岛多族群视神经脊髓炎谱系疾病患病率研究》，Multiple Sclerosis and Related Disorders 19:20–24。",
      url: "https://scholar.google.com/citations?hl=en&user=VuihjIsAAAAJ",
      placeholder: true,
    },
  ];

  const INTERESTS = [
    {
      status: "verified",
      badgeEn: "VERIFIED",
      badgeZh: "已核实",
      titleEn: "Clinical Neurology & Epilepsy Education",
      titleZh: "临床神经病学与癫痫规范化诊疗教育",
      descEn: "Structured neurological consultation, seizure semiology, and national clinical practice guidelines.",
      descZh: "结构化神经系统问诊、癫痫发作症状学解析及国家级临床管理共识指南编写。",
    },
    {
      status: "partial",
      badgeEn: "PARTIALLY VERIFIED (Monograph ISBNs Pending)",
      badgeZh: "部分核实（专著书号待核）",
      titleEn: "Clinical Neurophysiology (EEG & Electrodiagnostics)",
      titleZh: "临床神经电生理学（脑电图 EEG 与神经电诊断）",
      descEn: "Pattern recognition in electroencephalography and case-based teaching (monograph catalogue details PUB-003/PUB-005 pending PNM verification).",
      descZh: "脑电波形识别与电诊断病例教学（相关教学专著 PUB-003/PUB-005 书目细节待官方馆藏复核）。",
      placeholder: true,
    },
    {
      status: "verified",
      badgeEn: "VERIFIED",
      badgeZh: "已核实",
      titleEn: "Stroke Recovery & Movement Disorders Research",
      titleZh: "脑卒中康复与运动障碍临床研究",
      descEn: "Peer-reviewed multicentre clinical trials in stroke recovery (Stroke 2013) and Parkinson's disease genetics (BioMed Res Int 2014).",
      descZh: "涵盖脑卒中恢复多中心临床试验（Stroke 2013）及帕金森病遗传风险研究（BioMed Res Int 2014）。",
    },
    {
      status: "placeholder",
      badgeEn: "EDUCATIONAL SCOPE PLACEHOLDER",
      badgeZh: "非诊断教育边界占位项",
      titleEn: "Reflective Personal Development & KHTP Educational Workshops",
      titleZh: "反思性个人成长与 KHTP 教育工作坊",
      descEn: "[GOVERNANCE BOUNDARY — AGENTS.md §16]: Explored strictly for authorized educational reflection. Projective drawing or reflective exercises are never presented as clinical or psychiatric diagnostic tools.",
      descZh: "[治理红线 — AGENTS.md §16]：仅限于非临床自我反思教育用途；严禁将投射绘画或成长练习表述为医学或精神科临床诊断工具。",
      placeholder: true,
    },
  ];

  const PROGRAMMES = [
    {
      en: "EEG E-Books & Audio Teaching Series",
      zh: "脑电图（EEG）电子教材与导学音频系列",
    },
    {
      en: "Electrodiagnostic Medicine Case Workshops",
      zh: "神经电诊断医学临床病例解析工作坊",
    },
    {
      en: "Neuro-ophthalmology Clinical Localization Series",
      zh: "神经眼科学视路定位临床教学系列",
    },
    {
      en: "English & Mandarin Transformation Masterclasses",
      zh: "中英双语生命蜕变与自我成长大师班",
    },
    {
      en: "KHTP Reflective Drawing & Childhood Memories Workshop (Non-Diagnostic)",
      zh: "KHTP 反思性绘画与童年记忆探索工作坊（非诊断教育性质）",
    },
  ];

  const SPEAKING_TOPICS = [
    {
      badgeEn: "PROPOSED TOPIC PLACEHOLDER",
      badgeZh: "拟议演讲主题占位",
      titleEn: "1. Bridging Clinical Neuroscience & Human Resilience",
      titleZh: "1. 连接临床神经科学与心理韧性建设",
      descEn: "Evidence-informed perspectives from tertiary neurological practice on stress, sleep, and cognitive longevity.",
      descZh: "结合三甲医院神经内科临床经验，探讨压力调节、睡眠健康与认知功能长期维护。",
    },
    {
      badgeEn: "PROPOSED TOPIC PLACEHOLDER",
      badgeZh: "拟议演讲主题占位",
      titleEn: "2. Case-Based Mastery in EEG & Neuro-ophthalmology",
      titleZh: "2. 脑电图与神经眼科学病例实战精讲",
      descEn: "Interactive clinical localization workshops for postgraduate physicians, MRCP candidates, and neurology trainees.",
      descZh: "面向内科研究生、MRCP 考生及神经专科培训医生的互动式病灶定位教学工作坊。",
    },
    {
      badgeEn: "PROPOSED TOPIC PLACEHOLDER",
      badgeZh: "拟议演讲主题占位",
      titleEn: "3. Bilingual Health Literacy & Reflective Medical Education",
      titleZh: "3. 双语健康素养与反思性医学教育创新",
      descEn: "Designing accessible English and Mandarin learning ecosystems without compromising clinical rigor.",
      descZh: "在严格恪守临床循证边界的前提下，构建高质量中英双语数字医学与公众健康教育体系。",
    },
  ];

  const MEDIA_RESOURCES = [
    {
      labelEn: "Official Short & Long Speaker Biography (EN / 中文)",
      labelZh: "官方讲者长短版中英文简介",
      tagEn: "[PENDING APPROVAL]",
      tagZh: "[待讲者审定]",
    },
    {
      labelEn: "High-Resolution Approved Press Portrait",
      labelZh: "高分辨率官方授权讲者肖像照",
      tagEn: "[WITHHELD — APPROVAL REQUIRED]",
      tagZh: "[暂不展示 — 须书面授权]",
    },
    {
      labelEn: "Verified Publication & Academic Citation Sheet",
      labelZh: "已核实学术论文与出版书目清单",
      tagEn: "[DRAFT IN REPO: M002 / M003]",
      tagZh: "[仓库核验稿：M002 / M003]",
    },
    {
      labelEn: "Audio/Video Keynote Reel",
      labelZh: "主旨演讲音视频精选集锦",
      tagEn: "[PLACEHOLDER — NOT SUPPLIED]",
      tagZh: "[占位项 — 尚未提供]",
    },
  ];

  const UI_TEXT = {
    en: {
      govPill: "PRIVATE PROTOTYPE · AUTHORIZED REVIEWERS ONLY",
      govNotice:
        "M007 Draft for Internal Review Only — Authenticated reviewer/admin access enforced (SEC-001). Proposed STRATA partnership is UNCONFIRMED; unverified credentials, ISBNs, and media assets are marked as placeholders.",
      headerSub: "Consultant Neurologist · Educator · Clinical Researcher",
      navCredentials: "Qualifications",
      navTimeline: "Timeline",
      navPublications: "Publications",
      navProgrammes: "Programmes",
      navSpeaking: "Speaking & Media",
      navEnquiry: "Collaboration",
      highlightPlaceholders: "Highlight Placeholders",
      backToVault: "ContentVault →",
      legendVerified: "VERIFIED (Primary Register / DOI)",
      legendPartial: "PARTIALLY VERIFIED",
      legendPlaceholder: "PLACEHOLDER (Unverified)",
      nsrBadge: "VERIFIED · NSR #126713",
      heroName: "Dr. Eow Gaik Bee, MD, MRCP (UK)",
      heroRole:
        "Consultant Neurologist & Internal Medicine Specialist · Division of Neurology, Hospital Pulau Pinang",
      heroBio:
        "Registered Consultant Neurologist in George Town, Penang, Malaysia (National Specialist Register #126713), medical educator, and co-author of national epilepsy guidelines and peer-reviewed neurological research across stroke recovery, neuromyelitis optica spectrum disorder, and movement disorders.",
      proposedRolePrefix: "[PLACEHOLDER — PROPOSED STRATA ROLE]:",
      proposedRoleNotice:
        "Proposed Founding Research Partner & Medical Advisor for STRATA Project 001. This collaboration is PROPOSED ONLY and awaits formal review and written consent from Dr. Eow Gaik Bee.",
      portraitBadge: "PORTRAIT PLACEHOLDER",
      portraitNotice:
        "[PLACEHOLDER: Official portrait withheld in accordance with STRATA governance (AGENTS.md §6.3, §24) until written publication approval is granted.]",
      credentialsHeading: "Academic & Professional Qualifications",
      credentialsSub:
        "Cross-referenced on 2026-11-24 against the National Specialist Register of Malaysia (NSR), Malaysian Medical Council (MMC MeRITS), and peer-reviewed publications.",
      timelineHeading: "Academic & Clinical Career Timeline",
      pubsHeading: "Publications & Authored Monographs",
      pubsSub:
        "Separating verified peer-reviewed clinical research (DOI) from partially verified records and owner-supplied catalogue placeholders.",
      tabBooks: "Authored Books (10)",
      tabJournals: "Peer-Reviewed Research (5)",
      researchInterestsHeading: "Research & Educational Interests",
      programmesHeading: "Educational Programme Catalogue",
      programmesSub:
        "Preliminary programme inventory supplied for Digital Academy scoping — marked as placeholders pending partner validation.",
      speakingHeading: "Proposed International Speaking Topics",
      speakingSub: "Draft keynote and masterclass themes subject to speaker approval.",
      mediaKitHeading: "Speaker Media Resources",
      mediaKitBadge: "PLACEHOLDER ASSETS — NOT FOR DISTRIBUTION",
      enquiryHeading: "Collaboration & Speaking Enquiry (Local Staging Mode)",
      enquirySub:
        "Per STRATA governance (AGENTS.md §18, §24), external communications are disabled in this prototype. Submissions require an authenticated reviewer/admin session and are recorded locally in SQLite only.",
      enqName: "Your Name *",
      enqNamePh: "Dr. / Prof. / Coordinator Name",
      enqOrg: "Institution / Organization",
      enqOrgPh: "University / Medical Society / Conference",
      enqEmail: "Official Email *",
      enqEmailPh: "name@institution.org",
      enqTopic: "Enquiry Category",
      optSpeaking: "Academic Keynote / Medical Lecture",
      optResearch: "Clinical / Educational AI Research",
      optBook: "Publication & Bilingual Licensing",
      optWorkshop: "International Educational Workshop",
      enqMessage: "Proposed Collaboration Details (min 10 chars) *",
      enqMessagePh: "Describe the academic, speaking, or educational collaboration opportunity...",
      enqSubmit: "Record Local Prototype Enquiry",
      footerLeft:
        "STRATA Medical AI Research Lab · M007 Professional Digital Portfolio Prototype (Private)",
      footerRight:
        "Independent research prototype · Not affiliated with Mindvalley, Hospital Pulau Pinang, or USM · Do not publish without Dr. Eow's written consent.",
      placeholderWord: "PLACEHOLDER",
      sourceWord: "Source:",
    },
    zh: {
      govPill: "内部受保护原型 · 仅限授权审阅员访问",
      govNotice:
        "M007 内部审阅原型（已启用 SEC-001 审阅员/管理员会话鉴权）— STRATA 研究合作尚处于拟议阶段（未确认）。所有未获一手官方核实的资质、ISBN 与媒体素材均已明确标注为占位项。",
      headerSub: "神经内科顾问医生 · 医学教育者 · 临床研究者",
      navCredentials: "学术与执业资质",
      navTimeline: "履历时间轴",
      navPublications: "学术论文与著作",
      navProgrammes: "课程体系",
      navSpeaking: "国际演讲与媒体包",
      navEnquiry: "合作咨询",
      highlightPlaceholders: "高亮显示待核占位项",
      backToVault: "返回 ContentVault →",
      legendVerified: "已核实（官方注册名录 / 期刊 DOI）",
      legendPartial: "部分核实（书目或学术索引）",
      legendPlaceholder: "占位项（待一手证书核实）",
      nsrBadge: "已核实 · NSR #126713",
      heroName: "Dr. Eow Gaik Bee · 医学博士 MD, MRCP (UK)",
      heroRole: "神经内科与内科顾问专科医生 · 槟城中央医院神经内科",
      heroBio:
        "马来西亚国家专科医生名录注册神经内科顾问医生（NSR 编号 #126713，槟城乔治市），长期从事神经病学与脑电生理临床教学，参与编写马来西亚癫痫管理共识指南，并在国际同行评审期刊发表多项脑卒中康复、视神经脊髓炎谱系疾病及帕金森病临床研究。",
      proposedRolePrefix: "[待确认占位 — 拟议 STRATA 学术角色]：",
      proposedRoleNotice:
        "拟邀担任 STRATA Project 001 创始研究合作伙伴及医学顾问。该合作目前仅为拟议草案，须经 Dr. Eow 本人审阅并签署书面同意后方可确立。",
      portraitBadge: "肖像占位符",
      portraitNotice:
        "[肖像占位符：依据 STRATA 治理规范（AGENTS.md §6.3, §24），在获得本人书面公开发布授权前，暂不展示个人肖像照片。]",
      credentialsHeading: "学术与专业执业资质核验清单",
      credentialsSub:
        "于 2026-11-24 对照马来西亚国家专科医生名录（NSR）、马来西亚医药理事会（MMC）及同行评审期刊记录完成核验。",
      timelineHeading: "学术与临床生涯时间轴",
      pubsHeading: "出版著作与同行评审临床研究",
      pubsSub: "严格区分经官方网页直接核实的医学文献、部分核实索引记录与待核实书目占位项。",
      tabBooks: "编著书籍目录 (10)",
      tabJournals: "同行评审医学研究 (5)",
      researchInterestsHeading: "研究与数字教学方向",
      programmesHeading: "拟数字化课程目录（待核占位）",
      programmesSub: "以下课程清单源自初步项目简报，均标注为待合作伙伴确认占位项。",
      speakingHeading: "拟议国际学术与教育演讲主题",
      speakingSub: "供国际学术交流与合作评估使用的草案主题（须经讲者本人批准）。",
      mediaKitHeading: "讲者媒体资料包（占位状态）",
      mediaKitBadge: "媒体素材占位 — 严禁对外分发",
      enquiryHeading: "学术与课程合作咨询（本地原型暂存模式）",
      enquirySub:
        "依据 STRATA 安全规范（AGENTS.md §18, §24），本原型严禁向外发送邮件或外部通信；仅限已登录审阅员或管理员提交，记录安全存入本地 SQLite 数据库。",
      enqName: "联系人姓名 *",
      enqNamePh: "教授 / 医生 / 项目负责人姓名",
      enqOrg: "所属机构 / 学会 / 院校",
      enqOrgPh: "高等院校 / 医学会 / 国际学术会议",
      enqEmail: "官方联系邮箱 *",
      enqEmailPh: "name@institution.org",
      enqTopic: "合作类别",
      optSpeaking: "国际学术主旨演讲 / 医学专题讲座",
      optResearch: "临床神经科学与医学人工智能合作研究",
      optBook: "医学与双语教育著作出版授权",
      optWorkshop: "国际临床定位与教学工作坊",
      enqMessage: "合作意向说明（至少 10 个字符） *",
      enqMessagePh: "请简要说明拟议的学术交流、演讲邀请或数字教学合作内容……",
      enqSubmit: "保存本地原型咨询记录",
      footerLeft: "STRATA 医学人工智能研究实验室 · M007 专业数字学术档案原型（内部受控访问）",
      footerRight:
        "独立研发原型 · 与 Mindvalley、槟城中央医院或马来西亚理科大学无隶属关系 · 未经 Dr. Eow 书面授权严禁公开发布。",
      placeholderWord: "待核占位",
      sourceWord: "核验来源：",
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
    const dict = UI_TEXT[locale];
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : "en";
    $("pf-en").classList.toggle("active", locale === "en");
    $("pf-zh").classList.toggle("active", locale === "zh");

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (dict[key]) {
        el.setAttribute("placeholder", dict[key]);
      }
    });

    // Credentials
    $("credentials-grid").innerHTML = CREDENTIALS.map(
      (c) => `
      <article class="cred-card" ${c.placeholder ? 'data-placeholder-item="true"' : ""}>
        <span class="${badgeClass(c.status)}">${esc(locale === "zh" ? c.badgeZh : c.badgeEn)}</span>
        <h3>${esc(locale === "zh" ? c.titleZh : c.titleEn)}</h3>
        <div class="cred-meta">${esc(locale === "zh" ? c.metaZh : c.metaEn)}</div>
        <div class="source-link">${esc(dict.sourceWord)} ${esc(c.evidence)}</div>
      </article>
    `,
    ).join("");

    // Timeline
    $("timeline-list").innerHTML = TIMELINE.map(
      (row) => `
      <div class="tl-row" ${row.placeholder ? 'data-placeholder-item="true"' : ""}>
        <div class="tl-year">${esc(row.year)}</div>
        <div>${esc(locale === "zh" ? row.textZh : row.textEn)}</div>
        <span class="${badgeClass(row.status)}">${esc(locale === "zh" ? row.badgeZh : row.badgeEn)}</span>
      </div>
    `,
    ).join("");

    // Books
    $("pub-books-grid").innerHTML = BOOKS.map(
      (b) => `
      <article class="book-card" ${b.status !== "verified" ? 'data-placeholder-item="true"' : ""}>
        <span class="${badgeClass(b.status)}">#${b.num} · ${esc(locale === "zh" ? b.badgeZh : b.badgeEn)}</span>
        <h3>${esc(locale === "zh" ? b.titleZh : b.titleEn)}</h3>
        <div class="book-meta">${esc(locale === "zh" ? b.metaZh : b.metaEn)}</div>
        <div class="source-link">${esc(locale === "zh" ? b.isbnZh : b.isbnEn)}</div>
      </article>
    `,
    ).join("");

    // Journals
    $("pub-journals-list").innerHTML = JOURNALS.map(
      (j) => `
      <article class="journal-item" ${j.placeholder ? 'data-placeholder-item="true"' : ""}>
        <span class="${badgeClass(j.status)}">${esc(locale === "zh" ? j.badgeZh : j.badgeEn)}</span>
        <p style="margin: 8px 0 6px; font-weight: 500;">${esc(locale === "zh" ? j.citationZh : j.citationEn)}</p>
        <div class="source-link">${esc(j.url)}</div>
      </article>
    `,
    ).join("");

    // Interests
    $("interests-list").innerHTML = INTERESTS.map(
      (it) => `
      <li ${it.placeholder ? 'data-placeholder-item="true"' : ""}>
        <strong>${esc(locale === "zh" ? it.titleZh : it.titleEn)}</strong>
        <span class="${badgeClass(it.status)}">${esc(locale === "zh" ? it.badgeZh : it.badgeEn)}</span>
        <p>${esc(locale === "zh" ? it.descZh : it.descEn)}</p>
      </li>
    `,
    ).join("");

    // Programmes
    $("programmes-list").innerHTML = PROGRAMMES.map(
      (p) => `
      <div class="prog-item" data-placeholder-item="true">
        <span>${esc(locale === "zh" ? p.zh : p.en)}</span>
        <span class="v-badge v-placeholder">${esc(dict.placeholderWord)}</span>
      </div>
    `,
    ).join("");

    // Speaking Topics
    $("speaking-topics-list").innerHTML = SPEAKING_TOPICS.map(
      (st) => `
      <div class="topic-card" data-placeholder-item="true">
        <span class="v-badge v-placeholder">${esc(locale === "zh" ? st.badgeZh : st.badgeEn)}</span>
        <h3>${esc(locale === "zh" ? st.titleZh : st.titleEn)}</h3>
        <p>${esc(locale === "zh" ? st.descZh : st.descEn)}</p>
      </div>
    `,
    ).join("");

    // Media Resources
    $("media-resources-list").innerHTML = MEDIA_RESOURCES.map(
      (mr) => `
      <li>
        <span>${esc(locale === "zh" ? mr.labelZh : mr.labelEn)}</span>
        <span class="placeholder-tag">${esc(locale === "zh" ? mr.tagZh : mr.tagEn)}</span>
      </li>
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
    $("tab-pub-journals").addEventListener && null;
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
    statusBox.textContent =
      locale === "zh"
        ? `已存入本地暂存库 (${data.enquiryId}) — ${data.notice}`
        : `Saved locally (${data.enquiryId}) — ${data.notice}`;
    $("enquiry-form").reset();
  });

  renderAll();
})();
