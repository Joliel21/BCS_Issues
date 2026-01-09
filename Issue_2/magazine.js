/* =====================================================================
   MAG PLUG — RUNTIME (magazine.js) — STABLE PATCHSET (WP)
   Goals:
   - Zero boot crashes (defensive DOM checks)
   - Background NEVER moves
   - Edge click (outer 16%) + middle click advances
   - Swipe left/right turns pages (includes covers)
   - True closed-cover states: front + back; last spread -> back cover
   - Hold-to-repeat on prev/next arrows (accelerating)
   - Knob menu order: 90, 45, Center, 45, 90
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

  function ensureRootClasses(rootEl) {
    rootEl.classList.add("mag-plug");
  }

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
      <button class="mag-plug-btn mag-plug-prev" type="button" aria-label="Previous spread">‹</button>

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

      <button class="mag-plug-pagejump" type="button" aria-label="Jump to page">Cover</button>
      <input class="mag-plug-pageinput" type="number" inputmode="numeric" min="1" step="1" aria-label="Type a page number and press Enter" />

      <button class="mag-plug-btn mag-plug-close" type="button" aria-label="Close magazine">✕</button>
      <button class="mag-plug-btn mag-plug-next" type="button" aria-label="Next spread">›</button>
    `;
    wrapper.appendChild(controls);

    const live = document.createElement("div");
    live.className = "mag-plug-live";
    live.setAttribute("aria-live", "polite");
    live.textContent = "";
    wrapper.appendChild(live);

    return {
      controls,
      live,
      btnPrev: q(".mag-plug-prev", controls),
      btnNext: q(".mag-plug-next", controls),
      btnClose: q(".mag-plug-close", controls),
      knobBtn: q(".mag-plug-knob", controls),
      knobMenu: q(".mag-plug-knob-menu", controls),
      pageJumpBtn: q(".mag-plug-pagejump", controls),
      pageInput: q(".mag-plug-pageinput", controls),
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

    // Hard lock background motion: always centered
    rootEl.style.setProperty("--mag-bg-x", "0px");
    rootEl.style.setProperty("--mag-bg-y", "0px");
    rootEl.style.setProperty("--mag-bg-scale", "1.0");

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

    // fallback: last image found in last page
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

    cover.addEventListener("click", (e) => { e.preventDefault(); onOpen(); });
    cover.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
    });

    objectEl.appendChild(cover);
    try { cover.focus({ preventScroll: true }); } catch (_) {}
  }

  function renderSpread(objectEl, leftPage, rightPage, baseHref) {
    objectEl.innerHTML = "";

    const spread = document.createElement("div");
    spread.className = "mag-plug-spread";

    const backPlane = document.createElement("div");
    backPlane.className = "mag-plug-spread-back";
    spread.appendChild(backPlane);

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

  function updateStacks(stageEl, spreadIndex, spreadCount) {
    const root = stageEl.closest(".mag-plug") || document.documentElement;
    const left = clamp(spreadIndex * 2, 0, spreadCount * 2);
    const right = clamp(spreadCount * 2 - spreadIndex * 2 - 2, 0, spreadCount * 2);
    root.style.setProperty("--mag-stack-left", String(clamp(left, 0, 80)));
    root.style.setProperty("--mag-stack-right", String(clamp(right, 0, 80)));
  }

  function setLabel(ui, text, announce) {
    if (ui.pageJumpBtn) ui.pageJumpBtn.textContent = String(text || "");
    if (announce && ui.live) ui.live.textContent = String(text || "");
  }

  function attachNav(ui, state, transform) {
    // Defensive: never crash on missing nodes
    if (!ui || !state || !transform) return;
    if (!ui.btnPrev || !ui.btnNext || !ui.btnClose) return;

    // click handlers
   // close handler (keep this as click; no repeat needed)
ui.btnClose.addEventListener("click", (e) => { e.preventDefault(); state.goCover("front"); });

// prev/next: tap = 1 step, hold = repeat after delay (no runaway sensitivity)
const HOLD_DELAY = 650
;     // ms before repeating starts
const REPEAT_START = 170;   // initial repeat speed (ms)
const REPEAT_MIN = 70;      // fastest repeat (ms)
const ACCEL_EVERY = 420;    // ms between speed-ups
const ACCEL_STEP = 18;      // ms faster each accel tick

function bindHoldToRepeat(btn, stepFn) {
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

  const startRepeat = () => {
    isHeld = true;
    rate = REPEAT_START;

    // first repeat tick happens immediately on hold-start
    stepFn();

    repeatTimer = setInterval(stepFn, rate);

    // accelerate while holding
    accelTimer = setInterval(() => {
      rate = Math.max(REPEAT_MIN, rate - ACCEL_STEP);
      if (repeatTimer) {
        clearInterval(repeatTimer);
        repeatTimer = setInterval(stepFn, rate);
      }
    }, ACCEL_EVERY);
  };

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    isHeld = false;
    clearAll();

    try { btn.setPointerCapture(e.pointerId); } catch (_) {}

    holdTimer = setTimeout(startRepeat, HOLD_DELAY);
  });

  btn.addEventListener("pointerup", (e) => {
    e.preventDefault();

    // if released before hold delay: single step
    const doSingle = !isHeld;

    clearAll();

    if (doSingle) stepFn();
  });

  btn.addEventListener("pointercancel", (e) => { e.preventDefault(); clearAll(); });
  btn.addEventListener("pointerleave", (e) => { e.preventDefault(); clearAll(); });
}

// IMPORTANT: remove click handlers for prev/next.
// Pointer-up handles single-step; hold handles repeat.
bindHoldToRepeat(ui.btnPrev, () => state.goPrev());
bindHoldToRepeat(ui.btnNext, () => state.goNext());


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

      ui.knobBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleKnob(); });
      document.addEventListener("click", (e) => {
        if (!knobOpen) return;
        if (ui.knobMenu.contains(e.target) || ui.knobBtn.contains(e.target)) return;
        closeKnob();
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeKnob(); });

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
      });
    }

    // page jump
    if (ui.pageJumpBtn && ui.pageInput) {
      const openPageInput = () => {
        ui.pageInput.value = "";
        ui.pageInput.classList.add("is-open");
        try { ui.pageInput.focus({ preventScroll: true }); ui.pageInput.select(); } catch (_) {}
      };
      const closePageInput = () => ui.pageInput.classList.remove("is-open");

      ui.pageJumpBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPageInput(); });
      ui.pageInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closePageInput(); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const v = parseInt(String(ui.pageInput.value || ""), 10);
          closePageInput();
          if (Number.isFinite(v)) state.goToPage(v);
        }
      });
      ui.pageInput.addEventListener("blur", () => closePageInput());
    }
  }

  function attachKeyboard(wrapper, cfg, state) {
    if (!cfg || !cfg.enableKeyboard) return;
    wrapper.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "ArrowLeft") { e.preventDefault(); state.goPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); state.goNext(); }
      if (e.key === "Escape") { e.preventDefault(); state.goCover("front"); }
    });
  }

  function attachParallax(stageEl, cfg, rootEl) {
    // Background motion is DISABLED by design.
    if (prefersReducedMotion(cfg)) return () => {};
    const root = rootEl || stageEl.closest(".mag-plug") || document.documentElement;

    let raf = 0;
    let tx = 0, ty = 0;

    function apply() {
      raf = 0;
      root.style.setProperty("--mag-tilt-x", `${ty.toFixed(2)}deg`);
      root.style.setProperty("--mag-tilt-y", `${tx.toFixed(2)}deg`);
      // hard lock background vars
      root.style.setProperty("--mag-bg-x", "0px");
      root.style.setProperty("--mag-bg-y", "0px");
    }

    function onMove(clientX, clientY) {
      const r = stageEl.getBoundingClientRect();
      const nx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (clientY - (r.top + r.height / 2)) / (r.height / 2);
      const cx = clamp(nx, -1, 1);
      const cy = clamp(ny, -1, 1);

      tx = cx * 8;         // rotateY
      ty = -cy * 6;        // rotateX

      if (!raf) raf = requestAnimationFrame(apply);
    }

    function reset() { tx = ty = 0; if (!raf) raf = requestAnimationFrame(apply); }

    const onPointerMove = (e) => onMove(e.clientX, e.clientY);
    const onTouchMove = (e) => { if (e.touches && e.touches.length) onMove(e.touches[0].clientX, e.touches[0].clientY); };

    stageEl.addEventListener("pointermove", onPointerMove, { passive: true });
    stageEl.addEventListener("pointerleave", reset, { passive: true });
    stageEl.addEventListener("touchmove", onTouchMove, { passive: true });
    stageEl.addEventListener("touchend", reset, { passive: true });

    // initialize
    reset();

    return () => {
      stageEl.removeEventListener("pointermove", onPointerMove);
      stageEl.removeEventListener("pointerleave", reset);
      stageEl.removeEventListener("touchmove", onTouchMove);
      stageEl.removeEventListener("touchend", reset);
    };
  }

  function attachGestures(shell, cfg, state) {
    const stage = shell.stage;
    const objectEl = shell.object;

    const EDGE = 0.16;
    const SWIPE_MIN_PX = 35;
    const SWIPE_MAX_Y_PX = 80;

    let down = false;
    let sx = 0, sy = 0, st = 0;

    const getPoint = (e) => {
      if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    };

    const onDown = (e) => {
      // Don't steal from inputs/buttons/links
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      if (tag === "button" || tag === "input" || tag === "a") return;

      down = true;
      const p = getPoint(e);
      sx = p.x; sy = p.y;
      st = Date.now();
    };

    const onUp = (e) => {
      if (!down) return;
      down = false;

      const p = getPoint(e);
      const dx = p.x - sx;
      const dy = p.y - sy;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const elapsed = Date.now() - st;

      // Swipe
      if (adx >= SWIPE_MIN_PX && ady <= SWIPE_MAX_Y_PX) {
        if (dx < 0) state.goNext();
        else state.goPrev();
        return;
      }

      // Tap
      if (elapsed < 350 && adx < 8 && ady < 8) {
        const r = objectEl.getBoundingClientRect();
        const nx = (p.x - r.left) / Math.max(1, r.width);

        if (!state.isOpen) {
          // closed: tap anywhere opens (front/back depending on current cover)
          if (state.coverSide === "back") state.openToSpread(state.spreads.length - 1);
          else state.openToSpread(0);
          return;
        }

        if (nx <= EDGE) state.goPrev();
        else if (nx >= 1 - EDGE) state.goNext();
        else state.goNext(); // middle advances
      }
    };

    stage.addEventListener("pointerdown", onDown, { passive: true });
    stage.addEventListener("pointerup", onUp, { passive: true });
    stage.addEventListener("touchstart", onDown, { passive: true });
    stage.addEventListener("touchend", onUp, { passive: true });

    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("touchstart", onDown);
      stage.removeEventListener("touchend", onUp);
    };
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

    const { byId } = indexPagesById(viewer);
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

    const state = {
      isOpen: false,
      coverSide: "front",
      spreadIndex: 0,
      hasOpenedOnce: false,
      spreads,

      goCover: (side = "front") => {
        state.isOpen = false;
        state.coverSide = (side === "back") ? "back" : "front";
        shell.wrapper.classList.remove("is-open");
        shell.wrapper.classList.remove("is-opening");

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
        state.render();
        sendEvent(cfg, issueId, sessionId, "issue_open", null, {});
      },

      openIssue: () => state.openToSpread(0),

      goToPage: (pageNumber) => {
        const pn = clamp(parseInt(String(pageNumber || 1), 10), 1, spreads.length * 2);
        let idx = 0;
        for (let s = 0; s < spreads.length; s++) {
          const sp = spreads[s];
          if (sp.pageLeftNumber === pn || sp.pageRightNumber === pn) { idx = s; break; }
          const approxLeft = (s * 2) + 1;
          const approxRight = approxLeft + 1;
          if (approxLeft === pn || approxRight === pn) { idx = s; break; }
        }
        state.openToSpread(idx);
      },

      render: () => {
        const s = spreads[state.spreadIndex];
        renderSpread(shell.object, s.left || null, s.right || null, baseHref);

        const pnL = s.pageLeftNumber;
        const pnR = s.pageRightNumber;

        let label = `Spread ${state.spreadIndex + 1} / ${spreads.length}`;
        if (pnL || pnR) {
          const a = pnL ? String(pnL) : "—";
          const b = pnR ? String(pnR) : "—";
          label = `Pages ${a}–${b}`;
        }

        setLabel(ui, label, !!cfg.announcePageChanges);
        if (ui.btnPrev) ui.btnPrev.disabled = state.spreadIndex <= 0;
        if (ui.btnNext) ui.btnNext.disabled = state.spreadIndex >= spreads.length - 1;

        updateStacks(shell.stage, state.spreadIndex, spreads.length);

        const pageIndex = (s.leftIdx !== null && s.leftIdx !== undefined) ? s.leftIdx : null;
        sendEvent(cfg, issueId, sessionId, "page_view", pageIndex, { spread: true, spread_id: s.id });
      },

      goPrev: () => {
        if (!state.isOpen) {
          // closed back cover -> open to last spread
          if (state.coverSide === "back") { state.openToSpread(spreads.length - 1); }
          return;
        }
        if (state.spreadIndex <= 0) { state.goCover("front"); return; }
        state.spreadIndex = clamp(state.spreadIndex - 1, 0, spreads.length - 1);
        state.render();
      },

      goNext: () => {
        if (!state.isOpen) {
          // closed front cover -> open to first spread
          if (state.coverSide === "front") { state.openToSpread(0); }
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

    // Start on front cover (true closed-cover state)
    state.goCover("front");
  }

  function bootAll() {
    getRoots().forEach((el) => { bootOne(el); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootAll);
  else bootAll();
})();
