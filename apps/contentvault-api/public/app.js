/*
 * STRATA ContentVault Web Client (Zero external dependencies, CSP script-src 'self').
 *
 * Security invariants enforced here:
 *   1. No credentials, signing keys, or secrets exist in this bundle (CV-016).
 *   2. Identity is never sent as a userId/role parameter; the server resolves
 *      identity solely from the authenticated session.
 *   3. Document pages are rendered exclusively as server-rasterised PNG images
 *      with watermarks burned into pixel data — no DOM/CSS overlay exists (CV-019).
 */

(() => {
  "use strict";

  const I18N = {
    en: {
      skipToContent: "Skip to main content",
      syntheticBadge: "SYNTHETIC RESEARCH PROTOTYPE",
      syntheticNotice:
        "STRATA ContentVault v0.1 — Uses synthetic demonstration content only. Server-side rasterisation & per-learner watermarking active.",
      brandSubtitle: "Medical AI Research Lab · Protected Education Engine",
      portfolioNav: "M007 Portfolio",
      signOut: "Sign Out",
      heroEyebrow: "INTELLECTUAL PROPERTY DETERRENCE & TRACEABILITY",
      heroTitle: "Protected Clinical & Personal Development Learning",
      heroLead:
        "Original PDFs remain sealed inside private server storage. Every authorized page request is rasterised server-side at 144 DPI with a personalized, non-removable learner watermark and paired with entitled chapter audio.",
      pillar1Title: "Zero Raw PDF Exposure",
      pillar1Body:
        "Browsers receive single-page PNG rasters with strict no-store cache headers—never the source PDF.",
      pillar2Title: "Burned-In Identity Mark",
      pillar2Body:
        "Learner name, account ID, page, and UTC timestamp are composited directly into pixel data.",
      pillar3Title: "Instant Revocation & Audit",
      pillar3Body:
        "Entitlement version counters immediately invalidate prior tokens and record every allow/deny event.",
      signInHeading: "Sign In to ContentVault",
      signInSub: "Authenticate with your institutional or learner session.",
      emailLabel: "Email Address",
      passwordLabel: "Password",
      signInBtn: "Authenticate & Enter Vault",
      demoQuickFill: "Synthetic Evaluation Personas (Click to Sign In)",
      myLibraryTab: "Assigned Library",
      protectedReaderTab: "Protected Reader",
      assignedMaterialsHeading: "Assigned Learning Materials",
      assignedMaterialsSub:
        "Only modules with an active, non-expired entitlement appear below.",
      refreshBtn: "Refresh",
      verifyAccessTitle: "Access Boundary Verification",
      verifyAccessDesc:
        "Attempt to open a document ID directly to verify server-side entitlement enforcement (e.g. when signed in as an unentitled or revoked student).",
      testOpenBtn: "Request Protected Access",
      backToLibrary: "← Back to Assigned Library",
      chaptersAndAudio: "Chapters & Audio",
      readingProgressLabel: "Reading Progress",
      audioCompanionLabel: "PROTECTED AUDIO COMPANION",
      chaptersHeading: "Module Chapters",
      securityProofHeading: "Server Enforcement Proof",
      telemetryDelivery: "Delivery Format",
      telemetryWatermark: "Watermark Mode",
      telemetryCache: "Cache Policy",
      telemetryToken: "Page Token Exp.",
      prevPage: "◀ Prev",
      nextPage: "Next ▶",
      fullscreenBtn: "Fullscreen",
      renderingPage: "Verifying entitlement & rasterising watermarked page…",
      accessDeniedBadge: "ACCESS DENIED BY SERVER",
      adminTabEntitlements: "Documents & Entitlements",
      adminTabUpload: "Upload Private PDF",
      adminTabUsers: "Learner Accounts",
      adminTabAudit: "Security Audit & Proof",
      statDocuments: "Private Documents",
      statAccounts: "Registered Accounts",
      statGrants: "Active Entitlements",
      statAllows: "Authorized Events",
      statDenies: "Blocked Attempts",
      vaultInventoryHeading: "Private Vault Inventory",
      vaultInventorySub:
        "Select a document to manage per-learner entitlements, expirations, and revocations.",
      manageEntitlementsHeading: "Entitlement Control",
      selectLearnerLabel: "Learner Account",
      expirationOptionalLabel: "Access Expiration (Optional)",
      grantAccessBtn: "Grant / Update Access",
      grantShortExpiryBtn: "Grant 60s Expiring Access",
      currentEntitlementsHeading: "Current Learner Entitlements",
      uploadHeading: "Ingest Private PDF into ContentVault",
      uploadSub:
        "Uploaded PDFs are validated via the modular PDFium engine, written under an opaque key with 0600 permissions outside the web root, and never served directly. Use synthetic or authorized material only.",
      titleEnLabel: "Title (English) *",
      titleZhLabel: "Title (Mandarin / 中文)",
      authorLabel: "Author / Source Label",
      descLabel: "Module Summary",
      pdfFileLabel: "PDF File (application/pdf, max 40 MB) *",
      uploadSubmitBtn: "Validate & Store Privately",
      registerLearnerHeading: "Provision Account",
      registerLearnerSub:
        "Self-registration is disabled; only administrators may provision learner or admin credentials.",
      displayNameLabel: "Full Name (Used in Watermark)",
      passwordMinLabel: "Initial Password (min 8 chars)",
      roleLabel: "Role",
      preferredLocaleLabel: "Locale",
      createAccountBtn: "Create Account",
      directoryHeading: "Account Directory",
      selftestHeading:
        "Cryptographic Watermark Engine Proof (CV-005 / CV-006 / CV-019)",
      selftestSub:
        "Renders the same page for Student A, Student B, and an unwatermarked baseline on the server and compares SHA-256 pixel digests.",
      runSelftestBtn: "Run Live Pixel Proof",
      auditLogHeading: "Append-Only Security Audit Trail (CV-014)",
      auditLogSub:
        "Every authentication, upload, grant, revocation, page render, audio play, and access denial is immutably logged.",
      footerDisclaimer:
        "Piracy deterrence, traceability & access control — independent research prototype; not affiliated with Mindvalley.",
      emptyLibraryTitle: "No Active Entitlements Assigned",
      emptyLibraryBody:
        "Your account currently holds no active document entitlements. Contact an administrator or test unauthorized access refusal below.",
      openModuleBtn: "Open Protected Reader",
      pagesLabel: "pages",
      syntheticTag: "Synthetic Demo",
      entitledTag: "Entitled",
      watermarkActivePrefix: "Server Watermark Identity:",
      noAudioTrack: "No teaching audio attached to this page.",
      audioReady: "Authenticated chapter audio ready.",
      revokeBtn: "Revoke",
      regrantBtn: "Re-grant",
      reviewerEyebrow: "AUTHORIZED REVIEWER PORTAL · LEAST-PRIVILEGE SESSION",
      reviewerHeading: "M007 Private Specialist Collaboration Review",
      reviewerLead:
        "Your reviewer session is scoped strictly to the private, non-indexed M007 Specialist Collaboration & Public Education Portfolio prototype. In accordance with STRATA least-privilege governance, reviewer accounts hold zero access to learner curriculum files, raw PDFs, or administrator controls.",
      reviewerScope1Title: "Authorized M007 Access",
      reviewerScope1Body:
        "Inspect primary-source verification badges (VERIFIED vs PARTIALLY VERIFIED), bilingual EN/中文 copy, and local-only enquiry capture.",
      reviewerScope2Title: "Non-Indexed & Private",
      reviewerScope2Body:
        "Protected by server-side session checks, X-Robots-Tag noindex headers, and strict no-store cache directives.",
      reviewerScope3Title: "Zero Learner Data Exposure",
      reviewerScope3Body:
        "Student entitlements, watermarked learning modules, and administrative audit APIs remain isolated.",
      reviewerOpenPortfolioBtn: "Open Private M007 Portfolio →",
    },
    zh: {
      skipToContent: "跳转至主要内容",
      syntheticBadge: "合成研究原型系统",
      syntheticNotice:
        "STRATA ContentVault v0.1 — 仅使用合成演示资料。已启用服务端光栅化渲染与逐学员像素级水印保护。",
      brandSubtitle: "医学人工智能研究实验室 · 受保护数字教学引擎",
      portfolioNav: "M007 专家档案原型",
      signOut: "退出登录",
      heroEyebrow: "知识产权威慑、溯源与访问控制",
      heroTitle: "受保护的临床医学与个人成长数字学习平台",
      heroLead:
        "原始 PDF 始终密封于服务端私有存储中。每次经授权的页面请求均在服务端以 144 DPI 实时渲染，将不可移除的学员专属水印烧录进像素数据，并匹配受授权保护的章节导学音频。",
      pillar1Title: "零原始 PDF 暴露",
      pillar1Body:
        "浏览器仅接收带 no-store 缓存策略的单页 PNG 图像，绝不下发原始 PDF 字节。",
      pillar2Title: "像素级烧录身份水印",
      pillar2Body:
        "学员姓名、账户编号、页码与 UTC 时间戳直接合成至图像像素层，无法通过禁用 CSS 去除。",
      pillar3Title: "即时撤销与不可篡改审计",
      pillar3Body:
        "权限版本号机制在撤销瞬间使旧令牌失效，并完整记录每一次允许与拦截事件。",
      signInHeading: "登录 ContentVault",
      signInSub: "请使用管理员或学员凭证验证身份。",
      emailLabel: "电子邮箱",
      passwordLabel: "登录密码",
      signInBtn: "验证身份并进入系统",
      demoQuickFill: "合成评估演示账户（点击一键登录）",
      myLibraryTab: "已授权课程库",
      protectedReaderTab: "受保护阅读器",
      assignedMaterialsHeading: "已分配的学习资料",
      assignedMaterialsSub: "仅显示当前处于有效授权且未过期的学习单元。",
      refreshBtn: "刷新",
      verifyAccessTitle: "访问控制边界验证",
      verifyAccessDesc:
        "直接输入文档 ID 发起受保护访问请求，用于验证未授权或已撤销账户的服务端 403 拦截效果。",
      testOpenBtn: "请求受保护访问",
      backToLibrary: "← 返回已授权课程库",
      chaptersAndAudio: "章节与导学音频",
      readingProgressLabel: "学习阅读进度",
      audioCompanionLabel: "受保护章节导学音频",
      chaptersHeading: "单元章节导航",
      securityProofHeading: "服务端安全执行凭据",
      telemetryDelivery: "传输格式",
      telemetryWatermark: "水印机制",
      telemetryCache: "缓存策略",
      telemetryToken: "页面令牌有效期",
      prevPage: "◀ 上一页",
      nextPage: "下一页 ▶",
      fullscreenBtn: "全屏阅读",
      renderingPage: "正在校验访问权限并生成带专属水印的页面…",
      accessDeniedBadge: "服务端已拒绝访问",
      adminTabEntitlements: "文档与授权管理",
      adminTabUpload: "上传私有 PDF",
      adminTabUsers: "学员与账户目录",
      adminTabAudit: "安全审计与像素验证",
      statDocuments: "私有文档总数",
      statAccounts: "注册账户数",
      statGrants: "有效授权数",
      statAllows: "允许访问记录",
      statDenies: "越权拦截记录",
      vaultInventoryHeading: "私有内容库目录",
      vaultInventorySub: "选择文档以管理逐位学员的访问授权、有效期与即时撤销。",
      manageEntitlementsHeading: "访问权限管理",
      selectLearnerLabel: "选择学员账户",
      expirationOptionalLabel: "授权到期时间（可选）",
      grantAccessBtn: "授予 / 更新权限",
      grantShortExpiryBtn: "授予 60 秒短期权限（测试过期）",
      currentEntitlementsHeading: "当前文档授权列表",
      uploadHeading: "导入私有 PDF 至 ContentVault",
      uploadSub:
        "上传文件经模块化 PDFium 引擎校验后，以随机密钥和 0600 权限存入 Web 根目录之外的私有存储。请仅上传合成或获授权内容。",
      titleEnLabel: "英文标题 (English) *",
      titleZhLabel: "中文标题 (Mandarin)",
      authorLabel: "作者 / 来源标注",
      descLabel: "学习单元简介",
      pdfFileLabel: "PDF 文档 (application/pdf，上限 40 MB) *",
      uploadSubmitBtn: "校验并安全存储",
      registerLearnerHeading: "开通新账户",
      registerLearnerSub: "已关闭公开注册；仅平台管理员可创建学员或管理员账户。",
      displayNameLabel: "姓名标注（用于烧录专属水印）",
      passwordMinLabel: "初始密码（至少 8 位）",
      roleLabel: "角色权限",
      preferredLocaleLabel: "界面语言偏好",
      createAccountBtn: "创建账户",
      directoryHeading: "系统账户名录",
      selftestHeading: "像素级水印引擎自检证明 (CV-005 / CV-006 / CV-019)",
      selftestSub:
        "在服务端对同一页分别渲染学员 A、学员 B 与无水印基准图，并比对 SHA-256 像素摘要。",
      runSelftestBtn: "运行实时像素校验",
      auditLogHeading: "只追加安全审计日志 (CV-014)",
      auditLogSub:
        "完整记录每一次登录、上传、授权、撤销、页面渲染、音频播放及越权拒绝事件。",
      footerDisclaimer:
        "盗版威慑、身份溯源与访问控制 — STRATA 独立研究原型，与 Mindvalley 无任何关联或合作关系。",
      emptyLibraryTitle: "当前暂无有效学习授权",
      emptyLibraryBody:
        "您的账户目前未被授予任何有效文档权限。请联系管理员授权，或在下方测试服务端越权拦截。",
      openModuleBtn: "打开受保护阅读器",
      pagesLabel: "页",
      syntheticTag: "合成演示内容",
      entitledTag: "已授权",
      watermarkActivePrefix: "服务端水印绑定身份：",
      noAudioTrack: "当前页未关联导学音频。",
      audioReady: "已通过权限校验，可播放章节导学音频。",
      revokeBtn: "撤销权限",
      regrantBtn: "重新授权",
      reviewerEyebrow: "授权审阅人门户 · 最小权限会话",
      reviewerHeading: "M007 私有专科协作与公众科普档案审阅",
      reviewerLead:
        "您的审阅人会话仅限访问非公开、禁止搜索引擎收录的 M007 专科协作与公众教育档案原型。依据 STRATA 最小权限治理原则，审阅人账户不具备学员课程库、原始 PDF 或管理员控制台访问权限。",
      reviewerScope1Title: "M007 授权审阅范围",
      reviewerScope1Body:
        "审阅一手来源核验标签（已核实 / 部分核实）、中英双语内容及仅限本地存储的协作咨询记录。",
      reviewerScope2Title: "私有保护与禁止收录",
      reviewerScope2Body:
        "受服务端会话鉴权、X-Robots-Tag noindex 响应头及严格的 no-store 缓存策略保护。",
      reviewerScope3Title: "零学员数据暴露",
      reviewerScope3Body:
        "学员授权记录、带水印教学页面及管理员审计接口均保持严格隔离。",
      reviewerOpenPortfolioBtn: "进入 M007 私有专家档案 →",
    },
  };

  // In-memory state (never persisted in localStorage/sessionStorage)
  let currentLocale = "en";
  let currentUser = null;
  let previewSessionToken = null;
  let demoDocIdHint = null;
  let demoPersonasCache = [];

  // Reader state
  let activeDoc = null;
  let activeChapters = [];
  let activePage = 1;
  let zoomPercent = 100;
  let currentPageBlobUrl = null;
  let currentAudioBlobUrl = null;
  let loadedAudioChapterId = null;

  // Admin state
  let adminDocs = [];
  let adminUsers = [];
  let selectedAdminDocId = null;

  const $ = (id) => document.getElementById(id);

  function t(key) {
    return I18N[currentLocale]?.[key] || I18N.en[key] || key;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(message) {
    const el = $("global-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.add("hidden"), 3800);
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    if (previewSessionToken) {
      headers["X-CV-Session"] = previewSessionToken;
    }
    return headers;
  }

  async function apiJson(url, options = {}) {
    const method = options.method || "GET";
    const headers = authHeaders(options.headers || {});
    let body = options.body;
    if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const res = await fetch(url, {
      method,
      headers,
      body,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
    return { status: res.status, ok: res.ok && data.ok !== false, data, headers: res.headers };
  }

  /* ------------------------------------------------------------------ */
  /* Localization                                                        */
  /* ------------------------------------------------------------------ */

  function setLocale(locale) {
    currentLocale = locale === "zh" ? "zh" : "en";
    document.documentElement.lang = currentLocale === "zh" ? "zh-Hans" : "en";
    $("btn-locale-en").classList.toggle("active", currentLocale === "en");
    $("btn-locale-en").setAttribute("aria-pressed", String(currentLocale === "en"));
    $("btn-locale-zh").classList.toggle("active", currentLocale === "zh");
    $("btn-locale-zh").setAttribute("aria-pressed", String(currentLocale === "zh"));

    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.getAttribute("data-i18n");
      if (key && I18N[currentLocale][key]) {
        node.textContent = I18N[currentLocale][key];
      }
    });

    renderPersonaButtons();
    if (currentUser?.role === "student") {
      updateWatermarkBanner();
      if (!$("panel-student-library").classList.contains("hidden")) {
        loadStudentLibrary();
      } else if (activeDoc) {
        renderReaderMetadata();
      }
    } else if (currentUser?.role === "admin") {
      renderAdminDocsList();
    }
  }

  function localizedTitle(item) {
    if (!item) return "";
    if (currentLocale === "zh" && item.title_zh) return item.title_zh;
    return item.title_en || "";
  }

  /* ------------------------------------------------------------------ */
  /* Session & View Switching                                            */
  /* ------------------------------------------------------------------ */

  function cleanupReaderBlobs() {
    if (currentPageBlobUrl) {
      URL.revokeObjectURL(currentPageBlobUrl);
      currentPageBlobUrl = null;
    }
    if (currentAudioBlobUrl) {
      URL.revokeObjectURL(currentAudioBlobUrl);
      currentAudioBlobUrl = null;
    }
    const audio = $("reader-audio-player");
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    loadedAudioChapterId = null;
  }

  function applySessionState(user) {
    currentUser = user || null;
    cleanupReaderBlobs();

    $("view-login").classList.toggle("hidden", Boolean(currentUser));
    $("header-session-box").classList.toggle("hidden", !currentUser);
    const canSeePortfolio =
      Boolean(currentUser) &&
      (currentUser.role === "admin" || currentUser.role === "reviewer");
    const pfLink = $("header-portfolio-link");
    if (pfLink) {
      pfLink.classList.toggle("hidden", !canSeePortfolio);
    }

    if (!currentUser) {
      $("view-student").classList.add("hidden");
      $("view-reviewer")?.classList.add("hidden");
      $("view-admin").classList.add("hidden");
      return;
    }

    if (currentUser.locale === "zh" || currentUser.locale === "en") {
      setLocale(currentUser.locale);
    }

    $("header-user-role").textContent = currentUser.role.toUpperCase();
    $("header-user-name").textContent = currentUser.display_name;

    if (currentUser.role === "admin") {
      $("view-student").classList.add("hidden");
      $("view-reviewer")?.classList.add("hidden");
      $("view-admin").classList.remove("hidden");
      refreshAdminConsole();
    } else if (currentUser.role === "reviewer") {
      $("view-admin").classList.add("hidden");
      $("view-student").classList.add("hidden");
      $("view-reviewer")?.classList.remove("hidden");
    } else {
      $("view-admin").classList.add("hidden");
      $("view-reviewer")?.classList.add("hidden");
      $("view-student").classList.remove("hidden");
      updateWatermarkBanner();
      showStudentTab("library");
      loadStudentLibrary();
    }
  }

  function updateWatermarkBanner() {
    if (!currentUser) return;
    $("student-watermark-preview").textContent = `${t("watermarkActivePrefix")} ${currentUser.display_name} · ${currentUser.id}`;
  }

  async function loadDemoPersonas() {
    const { ok, data } = await apiJson("/api/auth/demo-personas");
    if (!ok || !data.enabled || !Array.isArray(data.personas) || !data.personas.length) {
      $("demo-personas-section").classList.add("hidden");
      return;
    }
    demoDocIdHint = data.demoDocumentId || null;
    demoPersonasCache = data.personas;
    $("demo-personas-section").classList.remove("hidden");
    renderPersonaButtons();
  }

  function renderPersonaButtons() {
    const grid = $("demo-personas-grid");
    if (!grid || !demoPersonasCache.length) return;
    grid.innerHTML = "";
    for (const p of demoPersonasCache) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "persona-btn";
      const label = currentLocale === "zh" ? p.labelZh : p.labelEn;
      const note = currentLocale === "zh" ? p.noteZh : p.noteEn;
      btn.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(note)}</span>`;
      btn.addEventListener("click", async () => {
        const errBox = $("login-error");
        errBox.classList.add("hidden");
        const { ok, data } = await apiJson("/api/auth/demo-login", {
          method: "POST",
          body: { personaId: p.id },
        });
        if (!ok) {
          errBox.textContent = data.message || "Demo sign-in unavailable.";
          errBox.classList.remove("hidden");
          return;
        }
        if (data.previewSession) {
          previewSessionToken = data.previewSession;
        }
        applySessionState(data.user);
      });
      grid.appendChild(btn);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Student Library & Protected Reader                                  */
  /* ------------------------------------------------------------------ */

  function showStudentTab(tab) {
    const isReader = tab === "reader";
    $("panel-student-library").classList.toggle("hidden", isReader);
    $("panel-student-reader").classList.toggle("hidden", !isReader);
    $("tab-student-library").classList.toggle("active", !isReader);
    $("tab-student-library").setAttribute("aria-selected", String(!isReader));
    $("tab-student-reader").classList.toggle("active", isReader);
    $("tab-student-reader").setAttribute("aria-selected", String(isReader));
    $("tab-student-reader").disabled = !activeDoc;
  }

  async function loadStudentLibrary() {
    const grid = $("student-docs-grid");
    const { ok, data } = await apiJson("/api/documents");
    if (!ok) {
      grid.innerHTML = `<div class="alert alert-error">${escapeHtml(data.message || "Could not load library.")}</div>`;
      return;
    }

    const docs = data.documents || [];
    if (demoDocIdHint && !$("probe-doc-id").value) {
      $("probe-doc-id").value = demoDocIdHint;
    }

    if (!docs.length) {
      grid.innerHTML = `
        <div class="card">
          <h3 class="serif-heading">${escapeHtml(t("emptyLibraryTitle"))}</h3>
          <p class="muted-sm">${escapeHtml(t("emptyLibraryBody"))}</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = "";
    for (const doc of docs) {
      const pct = Math.min(100, Math.round(((doc.pages_read || 0) / Math.max(1, doc.page_count)) * 100));
      const expiryNote = doc.expires_at
        ? ` · Exp: ${new Date(doc.expires_at).toLocaleString()}`
        : "";
      const card = document.createElement("article");
      card.className = "doc-card";
      card.innerHTML = `
        <div>
          <div class="doc-badges">
            ${doc.synthetic ? `<span class="badge badge-synthetic">${escapeHtml(t("syntheticTag"))}</span>` : ""}
            <span class="badge badge-active">${escapeHtml(t("entitledTag"))} v${Number(doc.version || 1)}</span>
          </div>
          <h3>${escapeHtml(localizedTitle(doc))}</h3>
          <div class="doc-meta-line">
            ${escapeHtml(doc.author || "STRATA")} · ${Number(doc.page_count)} ${escapeHtml(t("pagesLabel"))}${escapeHtml(expiryNote)}
          </div>
          <p class="doc-desc">${escapeHtml(doc.description || "")}</p>
        </div>
        <div>
          <div class="progress-label-row">
            <span>${escapeHtml(t("readingProgressLabel"))}</span>
            <span class="mono-xs">${Number(doc.pages_read || 0)} / ${Number(doc.page_count)} (${pct}%)</span>
          </div>
          <div class="progress-track" style="margin-bottom: 14px;">
            <div class="progress-fill" style="width: ${pct}%"></div>
          </div>
          <button type="button" class="btn btn-primary btn-block" data-open-doc="${escapeHtml(doc.id)}">
            ${escapeHtml(t("openModuleBtn"))}
          </button>
        </div>
      `;
      card.querySelector("[data-open-doc]").addEventListener("click", () => {
        openProtectedReader(doc.id, doc.last_page || 1);
      });
      grid.appendChild(card);
    }
  }

  async function openProtectedReader(documentId, initialPage = 1) {
    const { ok, status, data } = await apiJson(`/api/documents/${encodeURIComponent(documentId)}`);
    if (!ok) {
      showToast(`HTTP ${status}: ${data.message || data.error}`);
      return { ok: false, status, data };
    }

    activeDoc = data.document;
    activeChapters = data.chapters || [];
    activePage = Math.min(
      Math.max(1, Number(initialPage || data.progress?.last_page || 1)),
      activeDoc.page_count,
    );
    zoomPercent = 100;
    applyZoom();

    $("tab-student-reader").disabled = false;
    showStudentTab("reader");
    renderReaderMetadata();
    await loadProtectedPage(activePage);
    return { ok: true, status, data };
  }

  function renderReaderMetadata() {
    if (!activeDoc) return;
    $("reader-doc-title").textContent = localizedTitle(activeDoc);
    $("reader-doc-author").textContent = activeDoc.author || "";
    $("label-page-count").textContent = String(activeDoc.page_count);
    $("input-page-num").max = String(activeDoc.page_count);
    renderChaptersList();
  }

  function renderChaptersList() {
    const ul = $("reader-chapters-list");
    ul.innerHTML = "";
    for (const ch of activeChapters) {
      const isActive = activePage >= ch.start_page && activePage <= ch.end_page;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `chapter-btn${isActive ? " active" : ""}`;
      const chTitle = currentLocale === "zh" && ch.title_zh ? ch.title_zh : ch.title_en;
      const rangeText =
        ch.start_page === ch.end_page
          ? `p.${ch.start_page}`
          : `p.${ch.start_page}–${ch.end_page}`;
      btn.innerHTML = `
        <span>${escapeHtml(chTitle)}</span>
        <span class="chapter-pages">${escapeHtml(rangeText)}</span>
      `;
      btn.addEventListener("click", () => {
        $("reader-sidebar").classList.remove("mobile-open");
        loadProtectedPage(ch.start_page);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  function updateProgressUi(page, total) {
    const pct = Math.min(100, Math.round((page / Math.max(1, total)) * 100));
    $("reader-progress-text").textContent = `p.${page} / ${total}`;
    $("reader-progress-fill").style.width = `${pct}%`;
    $("reader-progress-bar-wrap").setAttribute("aria-valuenow", String(pct));
  }

  function applyZoom() {
    const fig = $("reader-figure");
    if (!fig) return;
    const basePx = 790;
    fig.style.width = `${Math.round((basePx * zoomPercent) / 100)}px`;
    $("btn-zoom-reset").textContent = `${zoomPercent}%`;
  }

  async function loadProtectedPage(pageNumber) {
    if (!activeDoc) return;
    const bounded = Math.min(Math.max(1, Number(pageNumber) || 1), activeDoc.page_count);
    activePage = bounded;

    $("input-page-num").value = String(activePage);
    $("btn-prev-page").disabled = activePage <= 1;
    $("btn-next-page").disabled = activePage >= activeDoc.page_count;
    renderChaptersList();
    updateProgressUi(activePage, activeDoc.page_count);

    $("reader-denied").classList.add("hidden");
    $("reader-loading").classList.remove("hidden");

    const url = `/api/documents/${encodeURIComponent(activeDoc.id)}/page?page=${activePage}`;
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      credentials: "same-origin",
    });

    $("reader-loading").classList.add("hidden");

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: "denied", message: `HTTP ${res.status}` }));
      cleanupReaderBlobs();
      $("reader-figure").classList.add("hidden");
      $("reader-denied").classList.remove("hidden");
      $("reader-denied-title").textContent = `HTTP ${res.status} · ${errBody.error || "access_denied"}`;
      $("reader-denied-desc").textContent =
        errBody.message || "Your entitlement is no longer active. Protected pages cannot be requested.";
      return;
    }

    const blob = await res.blob();
    if (currentPageBlobUrl) {
      URL.revokeObjectURL(currentPageBlobUrl);
    }
    currentPageBlobUrl = URL.createObjectURL(blob);
    const img = $("reader-page-img");
    img.dataset.renderedPage = "";
    img.src = currentPageBlobUrl;
    if (typeof img.decode === "function") {
      await img.decode().catch(() => {});
    }
    img.dataset.renderedPage = String(activePage);
    $("reader-figure").classList.remove("hidden");

    // Populate live server security headers proof
    $("telemetry-cache").textContent = (res.headers.get("cache-control") || "no-store").slice(0, 32);
    const expIso = res.headers.get("x-page-token-expires");
    $("telemetry-token-exp").textContent = expIso
      ? new Date(expIso).toLocaleTimeString()
      : "45s TTL";
    const audioToken = res.headers.get("x-audio-token");

    await syncChapterAudio(activePage, audioToken);
  }

  async function syncChapterAudio(page, audioToken) {
    const chapter = activeChapters.find(
      (ch) => page >= ch.start_page && page <= ch.end_page,
    );
    const titleEl = $("reader-audio-title");
    const statusEl = $("reader-audio-status");
    const player = $("reader-audio-player");

    if (!chapter || !chapter.has_audio) {
      titleEl.textContent = "—";
      statusEl.textContent = t("noAudioTrack");
      player.classList.add("hidden");
      return;
    }

    player.classList.remove("hidden");
    titleEl.textContent =
      currentLocale === "zh" && chapter.title_zh ? chapter.title_zh : chapter.title_en;

    if (loadedAudioChapterId === chapter.id && currentAudioBlobUrl) {
      return;
    }

    let audioUrl = `/api/documents/${encodeURIComponent(activeDoc.id)}/audio?chapter=${encodeURIComponent(chapter.id)}`;
    if (audioToken) {
      audioUrl += `&token=${encodeURIComponent(audioToken)}`;
    }

    const res = await fetch(audioUrl, {
      method: "GET",
      headers: authHeaders(),
      credentials: "same-origin",
    });

    if (!res.ok) {
      statusEl.textContent = `Audio denied (HTTP ${res.status})`;
      player.removeAttribute("src");
      return;
    }

    const audioBlob = await res.blob();
    if (currentAudioBlobUrl) {
      URL.revokeObjectURL(currentAudioBlobUrl);
    }
    currentAudioBlobUrl = URL.createObjectURL(audioBlob);
    loadedAudioChapterId = chapter.id;
    player.src = currentAudioBlobUrl;
    if (typeof player.load === "function") {
      player.load();
    }
    statusEl.textContent = t("audioReady");
  }

  /* ------------------------------------------------------------------ */
  /* Admin Console                                                       */
  /* ------------------------------------------------------------------ */

  function switchAdminTab(tabName) {
    document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      const active = btn.getAttribute("data-admin-tab") === tabName;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    ["overview", "upload", "users", "audit"].forEach((name) => {
      $(`admin-panel-${name}`).classList.toggle("hidden", name !== tabName);
    });
    if (tabName === "audit") {
      loadAdminAudit();
    }
  }

  async function refreshAdminConsole() {
    const [statsRes, docsRes, usersRes] = await Promise.all([
      apiJson("/api/admin/stats"),
      apiJson("/api/documents"),
      apiJson("/api/admin/users"),
    ]);

    if (statsRes.ok) {
      $("stat-docs").textContent = String(statsRes.data.documents ?? 0);
      $("stat-users").textContent = String(statsRes.data.users ?? 0);
      $("stat-grants").textContent = String(statsRes.data.activeEntitlements ?? 0);
      $("stat-allows").textContent = String(statsRes.data.auditAllows ?? 0);
      $("stat-denies").textContent = String(statsRes.data.auditDenies ?? 0);
    }

    if (docsRes.ok) {
      adminDocs = docsRes.data.documents || [];
      if (!selectedAdminDocId && adminDocs.length > 0) {
        selectedAdminDocId = adminDocs[0].id;
      }
      renderAdminDocsList();
    }

    if (usersRes.ok) {
      adminUsers = usersRes.data.users || [];
      renderAdminUsersSelect();
      renderAdminUsersTable();
    }

    if (selectedAdminDocId) {
      await loadAdminDocEntitlements(selectedAdminDocId);
    }
    await loadAdminAudit();
  }

  function renderAdminDocsList() {
    const wrap = $("admin-docs-list");
    if (!adminDocs.length) {
      wrap.innerHTML = `<p class="muted-sm">No documents uploaded yet.</p>`;
      return;
    }
    wrap.innerHTML = "";
    for (const doc of adminDocs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `admin-doc-item${doc.id === selectedAdminDocId ? " active" : ""}`;
      btn.innerHTML = `
        <strong>${escapeHtml(localizedTitle(doc))}</strong>
        <span>${escapeHtml(doc.id)} · ${Number(doc.page_count)}p · ${Number(doc.active_grants || 0)} active grants</span>
      `;
      btn.addEventListener("click", () => {
        selectedAdminDocId = doc.id;
        renderAdminDocsList();
        loadAdminDocEntitlements(doc.id);
      });
      wrap.appendChild(btn);
    }
  }

  function renderAdminUsersSelect() {
    const select = $("grant-student-email");
    const students = adminUsers.filter((u) => u.role === "student");
    select.innerHTML = "";
    for (const st of students) {
      const opt = document.createElement("option");
      opt.value = st.email;
      opt.textContent = `${st.display_name} (${st.email})`;
      select.appendChild(opt);
    }
  }

  function renderAdminUsersTable() {
    const wrap = $("admin-users-table-wrap");
    const rows = adminUsers
      .map(
        (u) => `
      <tr>
        <td><strong>${escapeHtml(u.display_name)}</strong><div class="mono-xs muted">${escapeHtml(u.id)}</div></td>
        <td class="mono-xs">${escapeHtml(u.email)}</td>
        <td><span class="badge ${u.role === "admin" ? "badge-info" : "badge-active"}">${escapeHtml(u.role)}</span></td>
        <td>${escapeHtml(u.locale)}</td>
      </tr>
    `,
      )
      .join("");
    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Identity</th><th>Email</th><th>Role</th><th>Locale</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  async function loadAdminDocEntitlements(docId) {
    const { ok, data } = await apiJson(`/api/documents/${encodeURIComponent(docId)}`);
    if (!ok) return;

    $("admin-selected-doc-title").textContent = localizedTitle(data.document);
    $("admin-selected-doc-meta").textContent = `${data.document.id} · ${data.document.page_count} pages · ${(data.chapters || []).length} chapters`;

    const list = data.entitlements || [];
    const wrap = $("admin-entitlements-table-wrap");
    if (!list.length) {
      wrap.innerHTML = `<p class="muted-sm">No entitlements granted for this document yet.</p>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Learner</th>
            <th>Status</th>
            <th>Ver.</th>
            <th>Expires</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map((ent) => {
              const isExpired =
                ent.expires_at && new Date(ent.expires_at).getTime() <= Date.now();
              const effectiveStatus =
                ent.status === "active" && isExpired ? "expired" : ent.status;
              const badgeCls =
                effectiveStatus === "active" ? "badge-active" : "badge-revoked";
              return `
              <tr>
                <td>
                  <strong>${escapeHtml(ent.display_name)}</strong>
                  <div class="mono-xs muted">${escapeHtml(ent.email)}</div>
                </td>
                <td><span class="badge ${badgeCls}">${escapeHtml(effectiveStatus)}</span></td>
                <td class="mono-xs">v${Number(ent.version)}</td>
                <td class="mono-xs">${ent.expires_at ? escapeHtml(new Date(ent.expires_at).toLocaleString()) : "—"}</td>
                <td>
                  ${
                    effectiveStatus === "active"
                      ? `<button type="button" class="btn btn-danger btn-sm" data-revoke-email="${escapeHtml(ent.email)}">${escapeHtml(t("revokeBtn"))}</button>`
                      : `<button type="button" class="btn btn-secondary btn-sm" data-regrant-email="${escapeHtml(ent.email)}">${escapeHtml(t("regrantBtn"))}</button>`
                  }
                </td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll("[data-revoke-email]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.getAttribute("data-revoke-email");
        const res = await apiJson(`/api/documents/${encodeURIComponent(docId)}/revoke`, {
          method: "POST",
          body: { email, reason: "admin_console_revoke" },
        });
        if (res.ok) {
          showToast(`Revoked access for ${email}`);
          await refreshAdminConsole();
        }
      });
    });

    wrap.querySelectorAll("[data-regrant-email]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.getAttribute("data-regrant-email");
        const res = await apiJson(`/api/documents/${encodeURIComponent(docId)}/grant`, {
          method: "POST",
          body: { email },
        });
        if (res.ok) {
          showToast(`Re-granted access for ${email}`);
          await refreshAdminConsole();
        }
      });
    });
  }

  async function loadAdminAudit() {
    const outcome = $("audit-filter-outcome").value;
    const event = $("audit-filter-event").value;
    const params = new URLSearchParams({ limit: "60" });
    if (outcome) params.set("outcome", outcome);
    if (event) params.set("event", event);

    const { ok, data } = await apiJson(`/api/admin/audit?${params.toString()}`);
    if (!ok) return;

    const entries = data.entries || [];
    const wrap = $("admin-audit-table-wrap");
    if (!entries.length) {
      wrap.innerHTML = `<p class="muted-sm">No matching audit entries.</p>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp (UTC)</th>
            <th>Event</th>
            <th>Outcome</th>
            <th>Actor</th>
            <th>Doc / Page</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map((e) => {
              const cls =
                e.outcome === "allow"
                  ? "badge-active"
                  : e.outcome === "deny"
                    ? "badge-deny"
                    : "badge-info";
              const detailStr = e.detail
                ? typeof e.detail === "string"
                  ? e.detail
                  : JSON.stringify(e.detail)
                : "—";
              return `
              <tr>
                <td class="mono-xs">${escapeHtml(e.created_at.replace("T", " ").slice(0, 19))}</td>
                <td class="mono-xs"><strong>${escapeHtml(e.event)}</strong></td>
                <td><span class="badge ${cls}">${escapeHtml(e.outcome)}</span></td>
                <td class="mono-xs">${escapeHtml(e.actor_id || "anonymous")}</td>
                <td class="mono-xs">${escapeHtml(e.document_id || "—")}${e.page ? ` · p.${Number(e.page)}` : ""}</td>
                <td class="mono-xs">${escapeHtml(detailStr.slice(0, 96))}</td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Event Bindings                                                      */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    $("btn-locale-en").addEventListener("click", () => setLocale("en"));
    $("btn-locale-zh").addEventListener("click", () => setLocale("zh"));

    $("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const errEl = $("login-error");
      errEl.classList.add("hidden");
      const email = $("login-email").value.trim();
      const password = $("login-password").value;

      const { ok, data } = await apiJson("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });

      if (!ok) {
        errEl.textContent = data.message || "Authentication failed.";
        errEl.classList.remove("hidden");
        return;
      }

      previewSessionToken = data.previewSession || null;
      $("login-password").value = "";
      applySessionState(data.user);
    });

    $("btn-logout").addEventListener("click", async () => {
      await apiJson("/api/auth/logout", { method: "POST" });
      previewSessionToken = null;
      activeDoc = null;
      applySessionState(null);
      await loadDemoPersonas();
    });

    // Student tabs & navigation
    $("tab-student-library").addEventListener("click", () => {
      showStudentTab("library");
      loadStudentLibrary();
    });
    $("tab-student-reader").addEventListener("click", () => {
      if (activeDoc) showStudentTab("reader");
    });
    $("btn-refresh-library").addEventListener("click", () => loadStudentLibrary());
    $("btn-back-library").addEventListener("click", () => {
      showStudentTab("library");
      loadStudentLibrary();
    });
    $("btn-back-library-mobile").addEventListener("click", () => {
      showStudentTab("library");
      loadStudentLibrary();
    });
    $("btn-toggle-chapters").addEventListener("click", () => {
      const sb = $("reader-sidebar");
      const isOpen = sb.classList.toggle("mobile-open");
      $("btn-toggle-chapters").setAttribute("aria-expanded", String(isOpen));
    });

    // Direct access boundary probe (demonstrates CV-004 / CV-009 / CV-010)
    $("probe-doc-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const docId = $("probe-doc-id").value.trim();
      const out = $("probe-doc-result");
      if (!docId) return;

      const { ok, status, data } = await apiJson(`/api/documents/${encodeURIComponent(docId)}`);
      out.classList.remove("hidden", "alert-error", "alert-success");
      if (!ok) {
        out.classList.add("alert-error");
        out.textContent = `Denied (HTTP ${status} · ${data.error}): ${data.message} — Recorded in security audit log.`;
      } else {
        out.classList.add("alert-success");
        out.textContent = `Authorized (HTTP 200): Opening "${localizedTitle(data.document)}"...`;
        openProtectedReader(docId, 1);
      }
    });

    // Reader controls
    $("btn-prev-page").addEventListener("click", () => {
      if (activePage > 1) loadProtectedPage(activePage - 1);
    });
    $("btn-next-page").addEventListener("click", () => {
      if (activeDoc && activePage < activeDoc.page_count) {
        loadProtectedPage(activePage + 1);
      }
    });
    $("input-page-num").addEventListener("change", () => {
      loadProtectedPage(Number($("input-page-num").value));
    });
    $("btn-zoom-out").addEventListener("click", () => {
      zoomPercent = Math.max(60, zoomPercent - 15);
      applyZoom();
    });
    $("btn-zoom-in").addEventListener("click", () => {
      zoomPercent = Math.min(175, zoomPercent + 15);
      applyZoom();
    });
    $("btn-zoom-reset").addEventListener("click", () => {
      zoomPercent = 100;
      applyZoom();
    });
    $("btn-fullscreen").addEventListener("click", () => {
      const stage = $("reader-stage-container");
      if (!document.fullscreenElement) {
        stage.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    document.addEventListener("keydown", (event) => {
      if (
        !activeDoc ||
        $("panel-student-reader").classList.contains("hidden") ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && activePage > 1) {
        loadProtectedPage(activePage - 1);
      } else if (event.key === "ArrowRight" && activePage < activeDoc.page_count) {
        loadProtectedPage(activePage + 1);
      }
    });

    // Admin tabs & forms
    document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      btn.addEventListener("click", () => switchAdminTab(btn.getAttribute("data-admin-tab")));
    });
    $("btn-admin-refresh").addEventListener("click", () => refreshAdminConsole());

    $("grant-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!selectedAdminDocId) return;
      const email = $("grant-student-email").value;
      const rawExp = $("grant-expires").value;
      const expiresAt = rawExp ? new Date(rawExp).toISOString() : null;
      const res = await apiJson(`/api/documents/${encodeURIComponent(selectedAdminDocId)}/grant`, {
        method: "POST",
        body: { email, expiresAt },
      });
      if (res.ok) {
        showToast(`Entitlement active for ${email}`);
        $("grant-expires").value = "";
        await refreshAdminConsole();
      } else {
        showToast(res.data.message || "Grant failed");
      }
    });

    $("btn-grant-short-expiry").addEventListener("click", async () => {
      if (!selectedAdminDocId) return;
      const email = $("grant-student-email").value;
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const res = await apiJson(`/api/documents/${encodeURIComponent(selectedAdminDocId)}/grant`, {
        method: "POST",
        body: { email, expiresAt, reason: "short_expiry_demo" },
      });
      if (res.ok) {
        showToast(`Granted 60-second expiring entitlement to ${email}`);
        await refreshAdminConsole();
      }
    });

    $("upload-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fileInput = $("upload-file");
      const file = fileInput.files?.[0];
      if (!file) return;

      const titleEn = $("upload-title-en").value.trim();
      const titleZh = $("upload-title-zh").value.trim();
      const author = $("upload-author").value.trim();
      const desc = $("upload-desc").value.trim();

      const btn = $("btn-upload-submit");
      btn.disabled = true;
      try {
        const arrayBuf = await file.arrayBuffer();
        const res = await fetch("/api/documents", {
          method: "POST",
          credentials: "same-origin",
          headers: authHeaders({
            "Content-Type": "application/pdf",
            "X-Title-En": encodeURIComponent(titleEn),
            "X-Title-Zh": encodeURIComponent(titleZh),
            "X-Author": encodeURIComponent(author),
            "X-Description": encodeURIComponent(desc),
            "X-Auto-Chapter": "1",
          }),
          body: arrayBuf,
        });
        const payload = await res.json();
        if (!res.ok || !payload.ok) {
          showToast(payload.message || "PDF upload failed");
          return;
        }
        showToast(`Stored "${titleEn}" privately (${payload.document.page_count} pages)`);
        $("upload-form").reset();
        $("upload-author").value = "STRATA Research Lab (Synthetic)";
        selectedAdminDocId = payload.document.id;
        switchAdminTab("overview");
        await refreshAdminConsole();
      } finally {
        btn.disabled = false;
      }
    });

    $("register-user-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const displayName = $("reg-name").value.trim();
      const email = $("reg-email").value.trim();
      const password = $("reg-password").value;
      const role = $("reg-role").value;
      const locale = $("reg-locale").value;

      const res = await apiJson("/api/auth/register", {
        method: "POST",
        body: { displayName, email, password, role, locale },
      });
      if (!res.ok) {
        showToast(res.data.message || "Account creation failed");
        return;
      }
      showToast(`Created ${role} account: ${email}`);
      $("register-user-form").reset();
      await refreshAdminConsole();
    });

    $("btn-run-selftest").addEventListener("click", async () => {
      const box = $("selftest-output");
      box.classList.remove("hidden");
      box.textContent = "Executing server-side PDFium pixel verification...";
      const res = await apiJson("/api/admin/engine-selftest");
      if (!res.ok) {
        box.textContent = `Error: ${res.data.message || "Self-test failed"}`;
        return;
      }
      box.textContent = JSON.stringify(res.data, null, 2);
      await loadAdminAudit();
    });

    $("audit-filter-outcome").addEventListener("change", () => loadAdminAudit());
    $("audit-filter-event").addEventListener("change", () => loadAdminAudit());
  }

  async function init() {
    bindEvents();
    setLocale("en");
    const me = await apiJson("/api/auth/me");
    if (me.ok && me.data.user) {
      applySessionState(me.data.user);
    } else {
      applySessionState(null);
      await loadDemoPersonas();
    }
  }

  init();
})();
