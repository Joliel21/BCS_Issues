/* =====================================================================
   MAG PLUG — RUNTIME (magazine.js) — REALISM PATCHSET v2 (WP)
   Goals (current):
   - Prevent double-turns (dequeue legacy handlers + capture-stop fallback)
   - Arrows: tap = single step (guarded); hold = repeat (slow -> accel)
   - Touch: swipe left/right turns pages (reliable; prevents scroll-jank)
   - Bigger edge click target (outer 24%) + middle advances
   - Background static; book tilts on hover (subtle realism)
   - Realistic stack illusion (smooth) + solid gutter (no see-through)
   - Controls: Single/Spread toggle, Music toggle, TOC overlay
   ===================================================================== */
(() => {
  const DEFAULT_BG_URL =
    "https://breathtakingawareness.com/wp-content/uploads/2025/12/Wood-Digital-Scrapbook-Paper-9.png";

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const getNum = (v, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  function parseConfig(el) {
    try { return JSON.parse(el.getAttribute("data-config") || "{}"); }
    catch (_) { return {}; }
  }

  function prefersReducedMotion(cfg) {
    if (cfg && cfg.respectReducedMotion === false) return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function baseHrefFromJsonUrl(jsonUrl) {
    try {
      const u = new URL(jsonUrl, window.location.href);
      u.hash = ""; u.search = "";
      u.pathname = u.pathname.replace(/\/[^\/?#]+$/, "/");
      return u.toString();
    } catch (_) { return ""; }
  }

  function resolveUrlMaybe(baseHref, url) {
    if (!url) return "";
    try { return new URL(url, baseHref || window.location.href).toString(); }
    catch (_) { return url; }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("Fetch failed: " + res.status);
    return await res.json();
  }

  async function loadIssue(cfg, jsonUrl) {
    const baseHref = baseHrefFromJsonUrl(jsonUrl);
    let manifest = null;

    const manifestUrl = (cfg && cfg.useManifest && cfg.manifestUrl) ? String(cfg.manifestUrl) : "";
    if (manifestUrl) {
      try { manifest = await fetchJson(manifestUrl); } catch (_) { manifest = null; }
    }

    const viewer = await fetchJson(jsonUrl);
    return { viewer, manifest, baseHref };
  }

  function makeSessionId() {
    try { return "s_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16); }
    catch (_) { return "s_" + Date.now(); }
  }

  async function sendEvent(cfg, issueId, sessionId, event, pageIndex = null, meta = {}) {
    if (!cfg || !cfg.analyticsEnabled) return;
    if (!window.MAG_PLUG || !MAG_PLUG.restUrl) return;

    const payload = {
      issue_id: issueId,
      event,
      ts: Date.now(),
      page_index: pageIndex === null || pageIndex === undefined ? null : pageIndex,
      session_id: sessionId,
      ...meta,
    };

    try {
      await fetch(MAG_PLUG.restUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(MAG_PLUG.nonce ? { "X-WP-Nonce": MAG_PLUG.nonce } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch (_) {}
  }

  function ensureRootClasses(rootEl) { rootEl.classList.add("mag-plug"); }

  function buildShell(rootEl, cfg) {
    rootEl.innerHTML = "";
    ensureRootClasses(rootEl);

    const wrapper = document.createElement("div");
    wrapper.className = "bcs-mag-wrapper mag-plug-wrapper";

    const stage = document.createElement("div");
    stage.className = "bcs-mag-stage mag-plug-stage";

    const bg = document.createElement("div");
    bg.className = "bcs-mag-bg mag-plug-background";

    const propsLayer = document.createElement("div");
    propsLayer.className = "mag-plug-props-layer";
    propsLayer.setAttribute("aria-hidden", "true");

    const object = document.createElement("div");
    object.className = "bcs-mag-book mag-plug-object";

    stage.appendChild(bg);
    stage.appendChild(propsLayer);
    stage.appendChild(object);
    wrapper.appendChild(stage);
    rootEl.appendChild(wrapper);

    if (cfg && cfg.stageBackground) stage.style.backgroundColor = cfg.stageBackground;

    return { wrapper, stage, bg, propsLayer, object, rootEl };
  }

  function buildControls(wrapper) {
    const controls = document.createElement("div");
    controls.className = "mag-plug-controls";
    controls.innerHTML = `
      <button class="mag-plug-btn mag-plug-prev" type="button" aria-label="Previous page">‹</button>

      <button class="mag-plug-knob" type="button" aria-label="Rotation knob" aria-haspopup="menu" aria-expanded="false">
        <span class="mag-plug-knob-ind" aria-hidden="true"></span>
      </button>
      <div class="mag-plug-knob-menu" role="menu" aria-label="Rotation actions">
        <button type="button" class="mag-plug-knob-item" role="menuitem" data-action="rot-90">⟲ 90°</button>
        <button type="button" class="mag-plug-knob-item" role="menuitem" data-action="rot-45">⟲ 45°</button>
        <button type="button" class="mag-plug-knob-item" role="menuitem" data-action="center">Center</button>
        <button type="button" class="mag-plug-knob-item" role="menuitem" data-action="rot+45">⟳ 45°</button>
        <button type="button" class="mag-plug-knob-item" role="menuitem" data-action="rot+90">⟳ 90°</button>
      </div>

      <button class="mag-plug-viewbtn" type="button" aria-label="Toggle view">Spread</button>
      <button class="mag-plug-tocbtn" type="button" aria-label="Table of contents">TOC</button>

      <button class="mag-plug-pagejump" type="button" aria-label="Jump to page">Cover</button>
      <input class="mag-plug-pageinput" type="number" inputmode="numeric" min="1" step="1" aria-label="Type a page number and press Enter" />

      <div class="mag-plug-sound">
        <button class="mag-plug-sound-btn" type="button" aria-label="Toggle music">♪</button>
      </div>

      <button class="mag-plug-btn mag-plug-close" type="button" aria-label="Close magazine">✕</button>
      <button class="mag-plug-btn mag-plug-next" type="button" aria-label="Next page">›</button>
    `;
    wrapper.appendChild(controls);

    const toc = document.createElement("div");
    toc.className = "mag-plug-toc";
    toc.setAttribute("role", "dialog");
    toc.setAttribute("aria-modal", "false");
    toc.setAttribute("aria-label", "Table of contents");
    wrapper.appendChild(toc);

    const live = document.createElement("div");
    live.className = "mag-plug-live";
    live.setAttribute("aria-live", "polite");
    live.textContent = "";
    wrapper.appendChild(live);

    return {
      controls,
      toc,
      live,
      btnPrev: q(".mag-plug-prev", controls),
      btnNext: q(".mag-plug-next", controls),
      btnClose: q(".mag-plug-close", controls),
      knobBtn: q(".mag-plug-knob", controls),
      knobMenu: q(".mag-plug-knob-menu", controls),
      pageJumpBtn: q(".mag-plug-pagejump", controls),
      pageInput: q(".mag-plug-pageinput", controls),
      viewBtn: q(".mag-plug-viewbtn", controls),
      tocBtn: q(".mag-plug-tocbtn", controls),
      soundBtn: q(".mag-plug-sound-btn", controls),
    };
  }

  function makeTransformController(rootEl, cfg) {
    const reduced = prefersReducedMotion(cfg);
    let rot = 0;

    function apply() {
      rootEl.style.setProperty("--mag-tilt-z", `${rot.toFixed(2)}deg`);
    }
    function recenter() { rot = 0; apply(); }
    function rotateBy(deg) { rot = (rot + deg) % 360; apply(); }

    if (reduced) recenter();
    return { recenter, rotateBy };
  }

  function applyManifestTheme(shell, rootEl, cfg, manifest, baseHref) {
    const bgFromManifest = manifest && manifest.background ? (manifest.background.image || manifest.background.imageUrl || "") : "";
    const bgUrl = resolveUrlMaybe(baseHref, bgFromManifest || (cfg && cfg.backgroundUrl) || DEFAULT_BG_URL);
    shell.bg.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : "none";
    shell.propsLayer.innerHTML = "";
  }

  function indexPagesById(viewer) {
    const pages = Array.isArray(viewer?.pages) ? viewer.pages : [];
    const byId = new Map();
    pages.forEach((p, idx) => {
      const id = (p && p.id) || "";
      if (id) byId.set(id, { page: p, idx });
    });
    return { pages, byId };
  }

  function normalizeSpreads(viewer, byId) {
    const spreads = Array.isArray(viewer?.spreads) ? viewer.spreads : [];
    return spreads.map((s, si) => {
      const leftRef = byId.get(s.pageLeftId);
      const rightRef = byId.get(s.pageRightId);
      return {
        spreadIndex: si,
        id: s.id || `spread_${si}`,
        left: leftRef ? leftRef.page : null,
        right: rightRef ? rightRef.page : null,
        leftIdx: leftRef ? leftRef.idx : null,
        rightIdx: rightRef ? rightRef.idx : null,
        pageLeftNumber: s.pageLeftNumber ?? (leftRef?.page?.pageNumber ?? null),
        pageRightNumber: s.pageRightNumber ?? (rightRef?.page?.pageNumber ?? null),
      };
    }).filter(s => s.left || s.right);
  }

  function elementToDom(node, baseHref) {
    const el = document.createElement("div");
    el.className = "mag-plug-el";

    const st = node && node.style && typeof node.style === "object" ? node.style : {};
    const x = getNum(st.x, 0), y = getNum(st.y, 0), w = getNum(st.w, 0), h = getNum(st.h, 0);
    el.style.left = x * 100 + "%";
    el.style.top = y * 100 + "%";
    el.style.width = w * 100 + "%";
    el.style.height = h * 100 + "%";

    const type = (node.type || "").toLowerCase();
    if (type === "image") {
      const img = document.createElement("img");
      img.alt = String((node.content && node.content.alt) || "");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = resolveUrlMaybe(baseHref, node.content && node.content.imageUrl ? node.content.imageUrl : "");
      el.appendChild(img);
    } else {
      const t = document.createElement("div");
      t.className = "mag-plug-el-text";
      t.textContent = String((node.content && node.content.text) || "");
      const fs = node.content && node.content.fontSize ? getNum(node.content.fontSize, 0) : 0;
      if (fs) t.style.fontSize = `${fs}px`;
      if (node.content && node.content.color) t.style.color = String(node.content.color);
      if (node.content && node.content.fontFamily) t.style.fontFamily = String(node.content.fontFamily);
      el.appendChild(t);
    }

    const href = node.linkUrl || null;
    if (href) {
      const a = document.createElement("a");
      a.className = "mag-plug-link";
      a.href = resolveUrlMaybe(baseHref, href);
      a.target = "_blank";
      a.rel = "noopener";
      a.style.position = "absolute";
      a.style.inset = "0";
      a.setAttribute("aria-label", String((node.content && node.content.ariaLabel) || "Open link"));
      el.appendChild(a);
    }
    return el;
  }

  function getCoverFromSources(cfg, viewer, manifest, baseHref) {
    const mCover = manifest && manifest.cover ? (manifest.cover.image || manifest.cover.imageUrl || "") : "";
    const cfgCover = cfg && cfg.coverImageUrl ? cfg.coverImageUrl : "";
    const vCover = viewer && (viewer.coverImageUrl || viewer.cover_image_url || "");
    const coverFront = resolveUrlMaybe(baseHref, mCover || cfgCover || vCover || "");
    const coverText = String((cfg && cfg.coverText) || (manifest && manifest.cover ? manifest.cover.text || "" : "") || "").trim();
    return { coverFront, coverText };
  }

  function getBackCoverFromViewer(viewer, baseHref, fallbackFront) {
    const vBack = viewer && (viewer.backCoverImageUrl || viewer.back_cover_image_url || viewer.backCoverUrl || "");
    const direct = resolveUrlMaybe(baseHref, String(vBack || ""));
    if (direct) return direct;

    try {
      const pages = (viewer && Array.isArray(viewer.pages)) ? viewer.pages : [];
      for (let i = pages.length - 1; i >= 0; i--) {
        const p = pages[i];
        const els = p && Array.isArray(p.elements) ? p.elements : [];
        const img = els.find(e => e && e.type === "image" && e.content && e.content.imageUrl);
        if (img) return resolveUrlMaybe(baseHref, String(img.content.imageUrl || "")) || fallbackFront;
      }
    } catch (_) {}
    return fallbackFront || "";
  }

  function renderCover(objectEl, coverFrontUrl, coverBackUrl, coverText, startSide, onOpen) {
    objectEl.innerHTML = "";

    const side = (startSide === "back") ? "back" : "front";

    const cover = document.createElement("button");
    cover.type = "button";
    cover.className = "mag-plug-cover";
    cover.setAttribute("aria-label", "Open magazine");

    const inner = document.createElement("div");
    inner.className = "mag-plug-cover-inner";
    inner.setAttribute("data-side", side);

    const front = document.createElement("img");
    front.className = "mag-plug-cover-img mag-plug-cover-front";
    front.alt = "Magazine cover";
    front.src = coverFrontUrl || "";
    inner.appendChild(front);

    const back = document.createElement("img");
    back.className = "mag-plug-cover-img mag-plug-cover-back";
    back.alt = "Back cover";
    back.src = coverBackUrl || coverFrontUrl || "";
    inner.appendChild(back);

    cover.appendChild(inner);

    if (coverText) {
      const t = document.createElement("div");
      t.className = "mag-plug-cover-text";
      t.textContent = coverText;
      cover.appendChild(t);
    }

    cover.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
    });

    // Capture click to avoid page-level listeners double-firing
    cover.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      onOpen();
    }, true);

    objectEl.appendChild(cover);
    try { cover.focus({ preventScroll: true }); } catch (_) {}
  }

  function renderSpread(objectEl, leftPage, rightPage, baseHref) {
    objectEl.innerHTML = "";

    const spread = document.createElement("div");
    spread.className = "mag-plug-spread";
    spread.setAttribute("data-has-right-stack", "1");

    const rightStack = document.createElement("div");
    rightStack.className = "mag-plug-right-stack";
    spread.appendChild(rightStack);

    const pageL = document.createElement("div");
    pageL.className = "mag-plug-page left";
    const sheetL = document.createElement("div");
    sheetL.className = "mag-plug-sheet";
    (Array.isArray(leftPage?.elements) ? leftPage.elements : []).forEach((n) => sheetL.appendChild(elementToDom(n, baseHref)));
    pageL.appendChild(sheetL);

    const gutter = document.createElement("div");
    gutter.className = "mag-plug-gutter";

    const pageR = document.createElement("div");
    pageR.className = "mag-plug-page right";
    const sheetR = document.createElement("div");
    sheetR.className = "mag-plug-sheet";
    (Array.isArray(rightPage?.elements) ? rightPage.elements : []).forEach((n) => sheetR.appendChild(elementToDom(n, baseHref)));
    pageR.appendChild(sheetR);

    spread.appendChild(pageL);
    spread.appendChild(gutter);
    spread.appendChild(pageR);

    objectEl.appendChild(spread);
  }

  function renderSingle(objectEl, page, baseHref) {
    objectEl.innerHTML = "";
    const pageEl = document.createElement("div");
    pageEl.className = "mag-plug-page single";
    const sheet = document.createElement("div");
    sheet.className = "mag-plug-sheet";
    (Array.isArray(page?.elements) ? page.elements : []).forEach((n) => sheet.appendChild(elementToDom(n, baseHref)));
    pageEl.appendChild(sheet);
    objectEl.appendChild(pageEl);
  }

  function updateStacks(stageEl, spreadIndex, spreadCount) {
    const root = stageEl.closest(".mag-plug") || document.documentElement;
    const ratio = spreadCount <= 1 ? 0 : (spreadIndex / (spreadCount - 1));
    const leftPx = clamp(10 + ratio * 22, 8, 34);      // grows as you move forward
    const rightPx = clamp(32 - ratio * 22, 8, 34);     // shrinks as you move forward
    root.style.setProperty("--mag-stack-left-px", `${leftPx.toFixed(1)}px`);
    root.style.setProperty("--mag-stack-right-px", `${rightPx.toFixed(1)}px`);
  }

  function setLabel(ui, text, announce) {
    if (ui.pageJumpBtn) ui.pageJumpBtn.textContent = String(text || "");
    if (announce && ui.live) ui.live.textContent = String(text || "");
  }

  function attachNav(ui, state, transform) {
    if (!ui || !state || !transform) return;
    if (!ui.btnPrev || !ui.btnNext || !ui.btnClose) return;

    // HARD RESET prev/next buttons to remove existing listeners
    {
      const prevClone = ui.btnPrev.cloneNode(true);
      ui.btnPrev.replaceWith(prevClone);
      ui.btnPrev = prevClone;

      const nextClone = ui.btnNext.cloneNode(true);
      ui.btnNext.replaceWith(nextClone);
      ui.btnNext = nextClone;
    }

    // Capture-stop on control bar to avoid page builder click handlers
    ui.controls.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.closest(".mag-plug-controls")) {
        e.stopPropagation();
      }
    }, true);

    ui.btnClose.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.goCover("front");
    }, true);

    // Slower + safer repeat
    const HOLD_DELAY = 900;     // ms before repeating starts
    const REPEAT_START = 520;   // initial repeat (ms)
    const REPEAT_MIN = 260;     // fastest repeat (ms)
    const ACCEL_EVERY = 1100;   // ms between speed-ups
    const ACCEL_STEP = 30;      // ms faster each accel tick

    function bindHoldToRepeat(btn, stepFn /* (force:boolean)=>void */) {
      let holdTimer = 0;
      let repeatTimer = 0;
      let accelTimer = 0;
      let isHeld = false;
      let rate = REPEAT_START;

      const clearAll = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = 0; }
        if (accelTimer) { clearInterval(accelTimer); accelTimer = 0; }
      };

      // swallow click so no other handler runs
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }, true);

      const startRepeat = () => {
        isHeld = true;
        rate = REPEAT_START;

        repeatTimer = setInterval(() => stepFn(true), rate);

        accelTimer = setInterval(() => {
          rate = Math.max(REPEAT_MIN, rate - ACCEL_STEP);
          if (repeatTimer) {
            clearInterval(repeatTimer);
            repeatTimer = setInterval(() => stepFn(true), rate);
          }
        }, ACCEL_EVERY);
      };

      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        isHeld = false;
        clearAll();
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        holdTimer = setTimeout(startRepeat, HOLD_DELAY);
      }, true);

      btn.addEventListener("pointerup", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const doSingle = !isHeld;
        clearAll();
        if (doSingle) stepFn(false);
      }, true);

      btn.addEventListener("pointercancel", (e) => { e.preventDefault(); e.stopPropagation(); clearAll(); }, true);
      btn.addEventListener("pointerleave", (e) => { e.preventDefault(); e.stopPropagation(); clearAll(); }, true);
    }

    bindHoldToRepeat(ui.btnPrev, (force) => state.goPrev(force));
    bindHoldToRepeat(ui.btnNext, (force) => state.goNext(force));

    // knob menu
    if (ui.knobBtn && ui.knobMenu) {
      let knobOpen = false;
      const closeKnob = () => {
        knobOpen = false;
        ui.knobMenu.classList.remove("is-open");
        ui.knobBtn.setAttribute("aria-expanded", "false");
      };
      const toggleKnob = () => {
        knobOpen = !knobOpen;
        ui.knobMenu.classList.toggle("is-open", knobOpen);
        ui.knobBtn.setAttribute("aria-expanded", knobOpen ? "true" : "false");
      };

      ui.knobBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleKnob();
      }, true);

      document.addEventListener("pointerdown", (e) => {
        if (!knobOpen) return;
        if (ui.knobMenu.contains(e.target) || ui.knobBtn.contains(e.target)) return;
        closeKnob();
      }, true);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeKnob(); }, true);

      ui.knobMenu.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const act = t.getAttribute("data-action");
        if (!act) return;
        e.preventDefault(); e.stopPropagation();
        closeKnob();

        if (act === "center") { transform.recenter(); return; }
        if (act === "rot-45") transform.rotateBy(-45);
        if (act === "rot+45") transform.rotateBy(45);
        if (act === "rot-90") transform.rotateBy(-90);
        if (act === "rot+90") transform.rotateBy(90);
      }, true);
    }

    // page jump
    if (ui.pageJumpBtn && ui.pageInput) {
      ui.pageJumpBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ui.pageInput.value = "";
        ui.pageInput.classList.add("is-open");
        try { ui.pageInput.focus({ preventScroll: true }); ui.pageInput.select(); } catch (_) {}
      }, true);

      const closePageInput = () => ui.pageInput.classList.remove("is-open");

      ui.pageInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closePageInput(); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const v = parseInt(String(ui.pageInput.value || ""), 10);
          closePageInput();
          if (Number.isFinite(v)) state.goToPage(v);
        }
      }, true);
      ui.pageInput.addEventListener("blur", () => closePageInput(), true);
    }

    // view toggle
    if (ui.viewBtn) {
      ui.viewBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        state.toggleViewMode();
      }, true);
    }

    // TOC
    if (ui.tocBtn && ui.toc) {
      const closeToc = () => ui.toc.classList.remove("is-open");
      ui.tocBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        ui.toc.classList.toggle("is-open");
      }, true);

      ui.toc.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const btn = t.closest(".mag-plug-toc-item");
        if (!btn) return;
        const idx = parseInt(String(btn.getAttribute("data-spread") || "0"), 10);
        const side = String(btn.getAttribute("data-side") || "spread");
        closeToc();
        state.openToSpread(clamp(idx, 0, state.spreads.length - 1));
        if (side === "left") state.singleSide = "left";
        if (side === "right") state.singleSide = "right";
        state.render();
      }, true);

      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeToc(); }, true);
      document.addEventListener("pointerdown", (e) => {
        if (!ui.toc.classList.contains("is-open")) return;
        if (ui.toc.contains(e.target) || ui.tocBtn.contains(e.target)) return;
        closeToc();
      }, true);
    }

    // sound
    if (ui.soundBtn) {
      ui.soundBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        state.toggleMusic();
      }, true);
    }
  }

  function attachKeyboard(wrapper, cfg, state) {
    if (!cfg || !cfg.enableKeyboard) return;
    wrapper.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "ArrowLeft") { e.preventDefault(); state.goPrev(false); }
      if (e.key === "ArrowRight") { e.preventDefault(); state.goNext(false); }
      if (e.key === "Escape") { e.preventDefault(); state.goCover("front"); }
    });
  }

  function attachParallax(stageEl, cfg, rootEl) {
    if (prefersReducedMotion(cfg)) return () => {};
    const root = rootEl || stageEl.closest(".mag-plug") || document.documentElement;

    // subtle movement only
    let raf = 0;
    let tx = 0, ty = 0;

    function apply() {
      raf = 0;
      root.style.setProperty("--mag-tilt-x", `${ty.toFixed(2)}deg`);
      root.style.setProperty("--mag-tilt-y", `${tx.toFixed(2)}deg`);
    }

    function onMove(clientX, clientY) {
      const r = stageEl.getBoundingClientRect();
      const nx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (clientY - (r.top + r.height / 2)) / (r.height / 2);
      const cx = clamp(nx, -1, 1);
      const cy = clamp(ny, -1, 1);

      tx = cx * 5.5;     // rotateY
      ty = -cy * 4.0;    // rotateX

      if (!raf) raf = requestAnimationFrame(apply);
    }

    function reset() { tx = ty = 0; if (!raf) raf = requestAnimationFrame(apply); }

    const onPointerMove = (e) => onMove(e.clientX, e.clientY);

    stageEl.addEventListener("pointermove", onPointerMove, { passive: true });
    stageEl.addEventListener("pointerleave", reset, { passive: true });

    reset();
    return () => {
      stageEl.removeEventListener("pointermove", onPointerMove);
      stageEl.removeEventListener("pointerleave", reset);
    };
  }

  function attachGestures(shell, cfg, state) {
    const stage = shell.stage;
    const objectEl = shell.object;

    const EDGE = 0.24;
    const SWIPE_MIN_PX = 28;
    const SWIPE_MAX_Y_PX = 110;

    let down = false;
    let sx = 0, sy = 0;
    let lx = 0, ly = 0;
    let startT = 0;
    let maybeHorizontal = false;

    const isInteractiveTarget = (t) => {
      if (!t || !(t instanceof HTMLElement)) return false;
      const tag = t.tagName ? String(t.tagName).toLowerCase() : "";
      if (tag === "button" || tag === "input" || tag === "a" || tag === "select" || tag === "textarea") return true;
      if (t.closest(".mag-plug-controls")) return true;
      return false;
    };

    const onStart = (x, y) => {
      down = true;
      sx = lx = x;
      sy = ly = y;
      startT = Date.now();
      maybeHorizontal = false;
    };

    const onMove = (x, y, e) => {
      if (!down) return;
      lx = x; ly = y;

      const dx = lx - sx;
      const dy = ly - sy;

      // If it becomes horizontal, prevent scroll for the remainder of gesture
      if (!maybeHorizontal) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          maybeHorizontal = true;
        }
      }
      if (maybeHorizontal && e && typeof e.preventDefault === "function") {
        e.preventDefault();
      }
    };

    const onEnd = (x, y) => {
      if (!down) return;
      down = false;

      const dx = x - sx;
      const dy = y - sy;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const elapsed = Date.now() - startT;

      // Swipe
      if (adx >= SWIPE_MIN_PX && ady <= SWIPE_MAX_Y_PX) {
        if (dx < 0) state.goNext(false);
        else state.goPrev(false);
        return;
      }

      // Tap
      if (elapsed < 380 && adx < 8 && ady < 8) {
        const r = objectEl.getBoundingClientRect();
        const nx = (x - r.left) / Math.max(1, r.width);

        if (!state.isOpen) {
          if (state.coverSide === "back") state.openToSpread(state.spreads.length - 1);
          else state.openToSpread(0);
          return;
        }

        if (nx <= EDGE) state.goPrev(false);
        else if (nx >= 1 - EDGE) state.goNext(false);
        else state.goNext(false);
      }
    };

    // Pointer events
    stage.addEventListener("pointerdown", (e) => {
      if (isInteractiveTarget(e.target)) return;
      onStart(e.clientX, e.clientY);
    }, true);

    stage.addEventListener("pointermove", (e) => {
      onMove(e.clientX, e.clientY, null);
    }, true);

    stage.addEventListener("pointerup", (e) => {
      onEnd(e.clientX, e.clientY);
    }, true);

    // Touch fallback (more reliable on iOS)
    stage.addEventListener("touchstart", (e) => {
      if (isInteractiveTarget(e.target)) return;
      if (!e.touches || !e.touches.length) return;
      const t = e.touches[0];
      onStart(t.clientX, t.clientY);
    }, { passive: true, capture: true });

    stage.addEventListener("touchmove", (e) => {
      if (!e.touches || !e.touches.length) return;
      const t = e.touches[0];
      onMove(t.clientX, t.clientY, e);
    }, { passive: false, capture: true });

    stage.addEventListener("touchend", (e) => {
      // use last known
      onEnd(lx, ly);
    }, { passive: true, capture: true });

    return () => {};
  }

  function buildToc(ui, spreads) {
    if (!ui || !ui.toc) return;
    ui.toc.innerHTML = `<h3>Table of Contents</h3>`;
    spreads.forEach((sp, i) => {
      const pnL = sp.pageLeftNumber ? String(sp.pageLeftNumber) : String(i * 2 + 1);
      const pnR = sp.pageRightNumber ? String(sp.pageRightNumber) : String(i * 2 + 2);
      const label = `Pages ${pnL}–${pnR}`;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "mag-plug-toc-item";
      item.setAttribute("data-spread", String(i));
      item.setAttribute("data-side", "spread");
      item.innerHTML = `${label}<span class="mag-plug-toc-meta">Spread ${i + 1} of ${spreads.length}</span>`;
      ui.toc.appendChild(item);
    });
  }

  function getRoots() {
    return qa(".bcs-mag, .mag-plug").filter(el => el instanceof HTMLElement && el.getAttribute("data-json-url"));
  }

  async function bootOne(rootEl) {
    const cfg = parseConfig(rootEl);
    const jsonUrl = rootEl.getAttribute("data-json-url") || "";
    const issueId = String(cfg.issueId || "issue");
    const sessionId = makeSessionId();

    const shell = buildShell(rootEl, cfg);
    const ui = buildControls(shell.wrapper);

    shell.wrapper.tabIndex = 0;
    shell.wrapper.setAttribute("role", "region");
    shell.wrapper.setAttribute("aria-label", "Magazine reader");

    const transform = makeTransformController(rootEl, cfg);
    const detachParallax = attachParallax(shell.stage, cfg, rootEl);

    setLabel(ui, "Loading…", false);

    let viewer = null, manifest = null, baseHref = "";
    try {
      const loaded = await loadIssue(cfg, jsonUrl);
      viewer = loaded.viewer;
      manifest = loaded.manifest;
      baseHref = loaded.baseHref;
    } catch (_) {
      setLabel(ui, "Failed to load issue", true);
      if (ui.btnPrev) ui.btnPrev.disabled = true;
      if (ui.btnNext) ui.btnNext.disabled = true;
      detachParallax();
      return;
    }

    applyManifestTheme(shell, rootEl, cfg, manifest, baseHref);

    const { byId, pages } = indexPagesById(viewer);
    const spreads = normalizeSpreads(viewer, byId);

    if (!spreads.length) {
      setLabel(ui, "No spreads", true);
      if (ui.btnPrev) ui.btnPrev.disabled = true;
      if (ui.btnNext) ui.btnNext.disabled = true;
      detachParallax();
      return;
    }

    const coverInfo = getCoverFromSources(cfg, viewer, manifest, baseHref);
    const coverFront = coverInfo.coverFront || "";
    const coverBack = getBackCoverFromViewer(viewer, baseHref, coverFront);
    const coverText = coverInfo.coverText || "";
    rootEl.style.setProperty("--mag-cover-front", coverFront ? `url("${coverFront}")` : "none");

    // MUSIC (optional)
    const musicUrl = resolveUrlMaybe(baseHref, String((cfg && cfg.musicUrl) || (manifest && manifest.audio ? (manifest.audio.url || manifest.audio.musicUrl || "") : "") || ""));
    let audio = null;
    let musicOn = false;
    if (musicUrl) {
      audio = new Audio(musicUrl);
      audio.loop = true;
      audio.preload = "none";
    }
    const setMusicUi = () => {
      if (!ui.soundBtn) return;
      ui.soundBtn.textContent = musicOn ? "❚❚" : "♪";
      ui.soundBtn.setAttribute("aria-label", musicOn ? "Pause music" : "Play music");
    };
    setMusicUi();

    // NAV GUARD: slower, prevents accidental double-turns
    const NAV_GUARD_MS = 650;
    let lastNavAt = 0;

    const state = {
      isOpen: false,
      coverSide: "front",
      spreadIndex: 0,
      hasOpenedOnce: false,

      viewMode: "spread",     // "spread" | "single"
      singleSide: "left",     // "left" | "right"

      spreads,
      pages,

      toggleMusic: async () => {
        if (!audio) return;
        try {
          if (!musicOn) {
            musicOn = true;
            await audio.play();
          } else {
            musicOn = false;
            audio.pause();
          }
          setMusicUi();
        } catch (_) {
          // autoplay restrictions: user may need a second click
          musicOn = false;
          setMusicUi();
        }
      },

      toggleViewMode: () => {
        if (!state.isOpen) return;
        state.viewMode = (state.viewMode === "spread") ? "single" : "spread";
        shell.wrapper.classList.toggle("is-single", state.viewMode === "single");
        if (ui.viewBtn) ui.viewBtn.textContent = (state.viewMode === "single") ? "Single" : "Spread";
        state.render();
      },

      goCover: (side = "front") => {
        state.isOpen = false;
        state.coverSide = (side === "back") ? "back" : "front";
        shell.wrapper.classList.remove("is-open");
        shell.wrapper.classList.remove("is-opening");
        shell.wrapper.classList.remove("is-single");

        renderCover(shell.object, coverFront, coverBack, coverText, state.coverSide, () => state.openIssue());

        if (ui.btnPrev) ui.btnPrev.disabled = true;
        if (ui.btnNext) ui.btnNext.disabled = false;

        setLabel(ui, "Cover", !!cfg.announcePageChanges);
        sendEvent(cfg, issueId, sessionId, "cover_view", null, { side: state.coverSide });
      },

      openToSpread: (idx) => {
        state.isOpen = true;
        state.coverSide = "front";
        transform.recenter();
        shell.wrapper.classList.add("is-open");

        if (!state.hasOpenedOnce && !prefersReducedMotion(cfg)) {
          state.hasOpenedOnce = true;
          shell.wrapper.classList.add("is-opening");
          window.setTimeout(() => shell.wrapper.classList.remove("is-opening"), 850);
        }

        state.spreadIndex = clamp(idx, 0, spreads.length - 1);
        state.viewMode = state.viewMode || "spread";
        shell.wrapper.classList.toggle("is-single", state.viewMode === "single");

        state.render();
        sendEvent(cfg, issueId, sessionId, "issue_open", null, {});
      },

      openIssue: () => state.openToSpread(0),

      goToPage: (pageNumber) => {
        const pn = clamp(parseInt(String(pageNumber || 1), 10), 1, spreads.length * 2);
        let idx = 0;
        for (let s = 0; s < spreads.length; s++) {
          const sp = spreads[s];
          if (sp.pageLeftNumber === pn) { idx = s; state.singleSide = "left"; break; }
          if (sp.pageRightNumber === pn) { idx = s; state.singleSide = "right"; break; }
          const approxLeft = (s * 2) + 1;
          const approxRight = approxLeft + 1;
          if (approxLeft === pn) { idx = s; state.singleSide = "left"; break; }
          if (approxRight === pn) { idx = s; state.singleSide = "right"; break; }
        }
        state.openToSpread(idx);
      },

      render: () => {
        const s = spreads[state.spreadIndex];

        if (state.viewMode === "single") {
          const page = (state.singleSide === "right") ? (s.right || s.left) : (s.left || s.right);
          renderSingle(shell.object, page || null, baseHref);
        } else {
          renderSpread(shell.object, s.left || null, s.right || null, baseHref);
        }

        const pnL = s.pageLeftNumber;
        const pnR = s.pageRightNumber;

        let label = `Spread ${state.spreadIndex + 1} / ${spreads.length}`;
        if (pnL || pnR) {
          const a = pnL ? String(pnL) : "—";
          const b = pnR ? String(pnR) : "—";
          label = `Pages ${a}–${b}`;
          if (state.viewMode === "single") {
            label = state.singleSide === "right" ? `Page ${b}` : `Page ${a}`;
          }
        }

        setLabel(ui, label, !!cfg.announcePageChanges);
        if (ui.btnPrev) ui.btnPrev.disabled = (!state.isOpen) || (state.spreadIndex <= 0 && state.viewMode !== "single");
        if (ui.btnNext) ui.btnNext.disabled = (!state.isOpen) ? false : false;

        updateStacks(shell.stage, state.spreadIndex, spreads.length);

        const pageIndex =
          (state.viewMode === "single")
            ? (state.singleSide === "right" ? s.rightIdx : s.leftIdx)
            : (s.leftIdx !== null && s.leftIdx !== undefined ? s.leftIdx : null);

        sendEvent(cfg, issueId, sessionId, "page_view", pageIndex, { mode: state.viewMode, spread_id: s.id });
      },

      goPrev: (force = false) => {
        const now = Date.now();
        if (!force && (now - lastNavAt) < NAV_GUARD_MS) return;
        lastNavAt = now;

        if (!state.isOpen) {
          if (state.coverSide === "back") { state.openToSpread(spreads.length - 1); }
          return;
        }

        if (state.viewMode === "single") {
          if (state.singleSide === "right") { state.singleSide = "left"; state.render(); return; }
          if (state.spreadIndex <= 0) { state.goCover("front"); return; }
          state.spreadIndex = clamp(state.spreadIndex - 1, 0, spreads.length - 1);
          state.singleSide = "right"; // step back to previous right page
          state.render();
          return;
        }

        if (state.spreadIndex <= 0) { state.goCover("front"); return; }
        state.spreadIndex = clamp(state.spreadIndex - 1, 0, spreads.length - 1);
        state.render();
      },

      goNext: (force = false) => {
        const now = Date.now();
        if (!force && (now - lastNavAt) < NAV_GUARD_MS) return;
        lastNavAt = now;

        if (!state.isOpen) {
          if (state.coverSide === "front") { state.openToSpread(0); }
          return;
        }

        if (state.viewMode === "single") {
          if (state.singleSide === "left") { state.singleSide = "right"; state.render(); return; }
          if (state.spreadIndex >= spreads.length - 1) { state.goCover("back"); return; }
          state.spreadIndex = clamp(state.spreadIndex + 1, 0, spreads.length - 1);
          state.singleSide = "left";
          state.render();
          return;
        }

        if (state.spreadIndex >= spreads.length - 1) { state.goCover("back"); return; }
        state.spreadIndex = clamp(state.spreadIndex + 1, 0, spreads.length - 1);
        state.render();
      },
    };

    attachNav(ui, state, transform);
    attachKeyboard(shell.wrapper, cfg, state);
    attachGestures(shell, cfg, state);
    buildToc(ui, spreads);

    if (ui.viewBtn) ui.viewBtn.textContent = "Spread";

    // Start on front cover (true closed-cover state)
    state.goCover("front");
  }

  function bootAll() { getRoots().forEach((el) => { bootOne(el); }); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootAll);
  else bootAll();
})();
