/* =====================================================================
   MAG PLUG — RUNTIME (magazine.js) — PATCHSET v5 (WP) — NO ARROWS + MOVEMENT RESTORED
   Fixes:
   - Removes/hides any legacy prev/next arrow buttons found in DOM (even if injected elsewhere)
   - Page turning ONLY via: edge tap, middle tap (next), swipe, keyboard (optional)
   - Touch swipe: uses pointer events with passive:false + touch-action:none to allow preventDefault
   - Restores “magazine moves with mouse” by applying transforms directly to the BOOK element (not via CSS vars)
   - Keeps background static (no parallax)
   - Adds an under-book shadow element that moves with the book
   Notes:
   - This file is self-contained; it does not require arrow CSS removal, but we also ship a CSS patch in the ZIP
     to hide any theme/plugin arrows that might still exist.
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
    stage.style.touchAction = "none"; // crucial for swipe/tap on touch devices

    const bg = document.createElement("div");
    bg.className = "bcs-mag-bg mag-plug-background";

    const propsLayer = document.createElement("div");
    propsLayer.className = "mag-plug-props-layer";
    propsLayer.setAttribute("aria-hidden", "true");

    const shadow = document.createElement("div");
    shadow.className = "mag-plug-book-shadow";
    shadow.setAttribute("aria-hidden", "true");

    const object = document.createElement("div");
    object.className = "bcs-mag-book mag-plug-object";
    object.setAttribute("data-mag-book", "1");

    stage.appendChild(bg);
    stage.appendChild(propsLayer);
    stage.appendChild(shadow);
    stage.appendChild(object);
    wrapper.appendChild(stage);
    rootEl.appendChild(wrapper);

    if (cfg && cfg.stageBackground) stage.style.backgroundColor = cfg.stageBackground;

    return { wrapper, stage, bg, propsLayer, shadow, object, rootEl };
  }

  function buildControls(wrapper) {
    const controls = document.createElement("div");
    controls.className = "mag-plug-controls";
    // NO PREV/NEXT ARROWS IN THIS VERSION
    controls.innerHTML = `
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

      <button class="mag-plug-view" type="button" aria-label="Toggle one-page view">Two-page</button>
      <button class="mag-plug-toc" type="button" aria-label="Open table of contents">TOC</button>

      <button class="mag-plug-sound-btn" type="button" aria-label="Music" aria-haspopup="menu" aria-expanded="false">♪</button>
      <div class="mag-plug-sound-menu" role="menu" aria-label="Music options">
        <button type="button" class="mag-plug-sound-item" role="menuitem" data-action="music-toggle">Play / Pause</button>
        <button type="button" class="mag-plug-sound-item" role="menuitem" data-action="music-vol-0">Volume: 0%</button>
        <button type="button" class="mag-plug-sound-item" role="menuitem" data-action="music-vol-25">Volume: 25%</button>
        <button type="button" class="mag-plug-sound-item" role="menuitem" data-action="music-vol-50">Volume: 50%</button>
        <button type="button" class="mag-plug-sound-item" role="menuitem" data-action="music-vol-75">Volume: 75%</button>
        <button type="button" class="mag-plug-sound-item" role="menuitem" data-action="music-vol-100">Volume: 100%</button>
      </div>

      <button class="mag-plug-pagejump" type="button" aria-label="Jump to page">Cover</button>
      <input class="mag-plug-pageinput" type="number" inputmode="numeric" min="1" step="1"
             aria-label="Type a page number and press Enter" />

      <button class="mag-plug-btn mag-plug-close" type="button" aria-label="Close magazine">✕</button>
    `;
    wrapper.appendChild(controls);

    const live = document.createElement("div");
    live.className = "mag-plug-live";
    live.setAttribute("aria-live", "polite");
    live.textContent = "";
    wrapper.appendChild(live);

    // TOC overlay
    const toc = document.createElement("div");
    toc.className = "mag-plug-toc-panel";
    toc.style.cssText = `
      position:absolute; inset:0; display:none; z-index:20;
      background: rgba(0,0,0,0.45);
      align-items:center; justify-content:center;
    `;
    toc.innerHTML = `
      <div class="mag-plug-toc-inner" role="dialog" aria-modal="true" aria-label="Table of contents"
           style="width:min(92vw,520px); max-height:min(80vh,720px); overflow:auto;
                  background:rgba(0,0,0,0.85); color:#fff; border:1px solid rgba(255,255,255,0.2);
                  border-radius:14px; padding:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 6px 10px;">
          <div style="font-weight:700;">Table of Contents</div>
          <button type="button" class="mag-plug-toc-close"
                  style="appearance:none; border:1px solid rgba(255,255,255,0.35); background:rgba(255,255,255,0.08);
                         color:#fff; border-radius:10px; padding:6px 10px; cursor:pointer;">Close</button>
        </div>
        <div class="mag-plug-toc-list"></div>
      </div>
    `;
    wrapper.appendChild(toc);

    return {
      controls,
      live,

      tocPanel: toc,
      tocList: q(".mag-plug-toc-list", toc),
      tocClose: q(".mag-plug-toc-close", toc),

      btnClose: q(".mag-plug-close", controls),

      knobBtn: q(".mag-plug-knob", controls),
      knobMenu: q(".mag-plug-knob-menu", controls),

      viewBtn: q(".mag-plug-view", controls),
      tocBtn: q(".mag-plug-toc", controls),

      soundBtn: q(".mag-plug-sound-btn", controls),
      soundMenu: q(".mag-plug-sound-menu", controls),

      pageJumpBtn: q(".mag-plug-pagejump", controls),
      pageInput: q(".mag-plug-pageinput", controls),
    };
  }

  function applyManifestTheme(shell, rootEl, cfg, manifest, baseHref) {
    const bgFromManifest = manifest && manifest.background ? (manifest.background.image || manifest.background.imageUrl || "") : "";
    const bgUrl = resolveUrlMaybe(baseHref, bgFromManifest || (cfg && cfg.backgroundUrl) || DEFAULT_BG_URL);
    shell.bg.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : "none";

    // background must never move
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
    const coverText = String((cfg && cfg.coverText) || (manifest && manifest.cover ? (manifest.cover.text || "") : "") || "").trim();
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
    }, true);

    // Single activation path: pointerup only (prevents click+pointer duplication)
    cover.addEventListener("pointerup", (e) => {
      e.preventDefault(); e.stopPropagation();
      onOpen();
    }, true);

    objectEl.appendChild(cover);
    try { cover.focus({ preventScroll: true }); } catch (_) {}
  }

  function renderSpread(objectEl, leftPage, rightPage, baseHref, viewMode, singleSide) {
    objectEl.innerHTML = "";

    const spread = document.createElement("div");
    spread.className = "mag-plug-spread";

    const backPlane = document.createElement("div");
    backPlane.className = "mag-plug-spread-back";
    spread.appendChild(backPlane);

    const makePage = (page, sideCls) => {
      const pageEl = document.createElement("div");
      pageEl.className = `mag-plug-page ${sideCls || ""}`.trim();
      const sheet = document.createElement("div");
      sheet.className = "mag-plug-sheet";
      (Array.isArray(page?.elements) ? page.elements : []).forEach((n) =>
        sheet.appendChild(elementToDom(n, baseHref))
      );
      pageEl.appendChild(sheet);
      return pageEl;
    };

    if (viewMode === "single") {
      const single = makePage(singleSide === "right" ? rightPage : leftPage, "single");
      single.classList.add("single");
      spread.appendChild(single);
    } else {
      const pageL = makePage(leftPage, "left");
      const gutter = document.createElement("div");
      gutter.className = "mag-plug-gutter";
      const pageR = makePage(rightPage, "right");

      spread.appendChild(pageL);
      spread.appendChild(gutter);
      spread.appendChild(pageR);
    }

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

  function swallowAll(e) {
    try { e.preventDefault(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}
    try { e.stopImmediatePropagation(); } catch (_) {}
  }

  function attachControls(ui, state, transform, audioCtl) {
    if (!ui || !state || !transform) return;
    if (!ui.btnClose) return;

    // Close
    ui.btnClose.addEventListener("pointerdown", swallowAll, true);
    ui.btnClose.addEventListener("click", (e) => { swallowAll(e); state.goCover("front"); }, true);

    // knob menu (rotation affects book transform)
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

      ui.knobBtn.addEventListener("pointerdown", swallowAll, true);
      ui.knobBtn.addEventListener("click", (e) => { swallowAll(e); toggleKnob(); }, true);

      document.addEventListener("pointerdown", (e) => {
        if (!knobOpen) return;
        if (ui.knobMenu.contains(e.target) || ui.knobBtn.contains(e.target)) return;
        closeKnob();
      }, true);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeKnob(); });

      ui.knobMenu.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const act = t.getAttribute("data-action");
        if (!act) return;
        swallowAll(e);
        closeKnob();

        if (act === "center") { transform.recenter(); return; }
        if (act === "rot-45") transform.rotateBy(-45);
        if (act === "rot+45") transform.rotateBy(45);
        if (act === "rot-90") transform.rotateBy(-90);
        if (act === "rot+90") transform.rotateBy(90);
      }, true);
    }

    // One-page view toggle
    if (ui.viewBtn) {
      ui.viewBtn.addEventListener("pointerdown", swallowAll, true);
      ui.viewBtn.addEventListener("click", (e) => { swallowAll(e); state.toggleViewMode(); }, true);
    }

    // TOC
    if (ui.tocBtn && ui.tocPanel && ui.tocClose) {
      const openToc = () => {
        ui.tocPanel.style.display = "flex";
        try { ui.tocClose.focus({ preventScroll: true }); } catch (_) {}
      };
      const closeToc = () => {
        ui.tocPanel.style.display = "none";
        try { ui.tocBtn.focus({ preventScroll: true }); } catch (_) {}
      };

      ui.tocBtn.addEventListener("pointerdown", swallowAll, true);
      ui.tocBtn.addEventListener("click", (e) => { swallowAll(e); openToc(); }, true);

      ui.tocClose.addEventListener("pointerdown", swallowAll, true);
      ui.tocClose.addEventListener("click", (e) => { swallowAll(e); closeToc(); }, true);

      ui.tocPanel.addEventListener("click", (e) => { if (e.target === ui.tocPanel) closeToc(); }, true);

      document.addEventListener("keydown", (e) => {
        if (ui.tocPanel.style.display !== "flex") return;
        if (e.key === "Escape") closeToc();
      });
    }

    // Music
    if (ui.soundBtn && ui.soundMenu && audioCtl) {
      let open = false;
      const setOpen = (v) => {
        open = !!v;
        ui.soundMenu.classList.toggle("is-open", open);
        ui.soundBtn.setAttribute("aria-expanded", open ? "true" : "false");
      };

      ui.soundBtn.addEventListener("pointerdown", swallowAll, true);
      ui.soundBtn.addEventListener("click", (e) => { swallowAll(e); setOpen(!open); }, true);

      document.addEventListener("pointerdown", (e) => {
        if (!open) return;
        if (ui.soundMenu.contains(e.target) || ui.soundBtn.contains(e.target)) return;
        setOpen(false);
      }, true);

      ui.soundMenu.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const act = t.getAttribute("data-action") || "";
        if (!act) return;
        swallowAll(e);
        setOpen(false);

        if (act === "music-toggle") audioCtl.toggle();
        if (act === "music-vol-0") audioCtl.setVolume(0);
        if (act === "music-vol-25") audioCtl.setVolume(0.25);
        if (act === "music-vol-50") audioCtl.setVolume(0.5);
        if (act === "music-vol-75") audioCtl.setVolume(0.75);
        if (act === "music-vol-100") audioCtl.setVolume(1.0);
      }, true);
    }

    // page jump
    if (ui.pageJumpBtn && ui.pageInput) {
      ui.pageJumpBtn.addEventListener("pointerdown", swallowAll, true);
      ui.pageJumpBtn.addEventListener("click", (e) => {
        swallowAll(e);
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
      });
      ui.pageInput.addEventListener("blur", () => closePageInput());
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

  function makeBookTransformController(shell, cfg) {
    const reduced = prefersReducedMotion(cfg);

    let rotZ = 0;
    let tiltX = 0;
    let tiltY = 0;

    const apply = () => {
      // Apply to BOOK + SHADOW (so they move together)
      const t = `translate3d(0,0,0) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg)`;
      shell.object.style.transform = t;
      shell.shadow.style.transform = t;
    };

    const recenter = () => {
      rotZ = 0;
      apply();
    };

    const rotateBy = (deg) => {
      rotZ = (rotZ + deg) % 360;
      apply();
    };

    const setTilt = (xDeg, yDeg) => {
      if (reduced) { tiltX = 0; tiltY = 0; apply(); return; }
      tiltX = clamp(xDeg, -6, 6);
      tiltY = clamp(yDeg, -8, 8);
      apply();
    };

    recenter();
    return { recenter, rotateBy, setTilt };
  }

  function attachHoverTilt(shell, cfg, transform) {
    if (prefersReducedMotion(cfg)) return () => {};
    const stageEl = shell.stage;

    let raf = 0;
    let tx = 0, ty = 0;

    function onMove(clientX, clientY) {
      const r = stageEl.getBoundingClientRect();
      const nx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (clientY - (r.top + r.height / 2)) / (r.height / 2);
      const cx = clamp(nx, -1, 1);
      const cy = clamp(ny, -1, 1);

      // gentle movement
      tx = cx * 5;     // rotateY
      ty = -cy * 3.5;  // rotateX

      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        transform.setTilt(ty, tx);
      });
    }

    function reset() {
      tx = 0; ty = 0;
      transform.setTilt(0, 0);
    }

    const onPointerMove = (e) => onMove(e.clientX, e.clientY);

    stageEl.addEventListener("pointermove", onPointerMove, { passive: true });
    stageEl.addEventListener("pointerleave", reset, { passive: true });
    reset();

    return () => {
      stageEl.removeEventListener("pointermove", onPointerMove);
      stageEl.removeEventListener("pointerleave", reset);
    };
  }

  // Pointer-only gestures with passive:false so preventDefault works on touch browsers
  function attachGestures(shell, state) {
    const stage = shell.stage;
    const objectEl = shell.object;

    const EDGE = 0.30;        // larger edge zone per request
    const SWIPE_MIN_PX = 22;  // easier swipe
    const SWIPE_MAX_Y_PX = 130;

    let down = false;
    let sx = 0, sy = 0, st = 0;
    let pid = null;

    const onDown = (e) => {
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      if (tag === "button" || tag === "input" || tag === "a") return;

      down = true;
      pid = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      st = Date.now();

      try { stage.setPointerCapture(pid); } catch (_) {}
      // prevent scroll/zoom gesture stealing
      try { e.preventDefault(); } catch (_) {}
    };

    const onUp = (e) => {
      if (!down) return;
      down = false;

      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const elapsed = Date.now() - st;

      // Swipe
      if (adx >= SWIPE_MIN_PX && ady <= SWIPE_MAX_Y_PX) {
        if (dx < 0) state.goNext(false);
        else state.goPrev(false);
        return;
      }

      // Tap
      if (elapsed < 420 && adx < 10 && ady < 10) {
        const r = objectEl.getBoundingClientRect();
        const nx = (e.clientX - r.left) / Math.max(1, r.width);

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

    const onCancel = () => { down = false; };

    stage.addEventListener("pointerdown", onDown, { passive: false });
    stage.addEventListener("pointerup", onUp, { passive: true });
    stage.addEventListener("pointercancel", onCancel, { passive: true });

    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onCancel);
    };
  }

  function removeLegacyArrows(rootEl) {
    // If some other runtime/plugin injects arrow buttons, remove/hide them so user never sees them.
    const legacy = qa(".mag-plug-prev, .mag-plug-next, .bcs-mag-prev, .bcs-mag-next, .turn-prev, .turn-next", rootEl);
    legacy.forEach((el) => {
      try { el.remove(); } catch (_) { try { el.style.display = "none"; } catch (_) {} }
    });

    // Also hide via injected style (belt + suspenders)
    if (!q("#mag-plug-hide-arrows-style")) {
      const st = document.createElement("style");
      st.id = "mag-plug-hide-arrows-style";
      st.textContent = `
        .mag-plug-prev,.mag-plug-next,.bcs-mag-prev,.bcs-mag-next,.turn-prev,.turn-next{display:none!important;}
      `;
      document.head.appendChild(st);
    }
  }

  function getRoots() {
    return qa(".bcs-mag, .mag-plug").filter(el => el instanceof HTMLElement && el.getAttribute("data-json-url"));
  }

  function makeAudioController(cfg, manifest, baseHref) {
    const urlFromCfg = cfg && cfg.musicUrl ? String(cfg.musicUrl) : "";
    const urlFromManifest = manifest && manifest.music ? String(manifest.music.url || manifest.music.src || "") : "";
    const musicUrl = resolveUrlMaybe(baseHref, urlFromCfg || urlFromManifest || "");

    if (!musicUrl) return { has: false, toggle: () => {}, setVolume: () => {} };

    const a = new Audio();
    a.src = musicUrl;
    a.loop = true;
    a.preload = "auto";
    a.volume = 0.5;

    const play = async () => { try { await a.play(); } catch (_) {} };
    const pause = () => { try { a.pause(); } catch (_) {} };

    return {
      has: true,
      toggle: () => { if (a.paused) play(); else pause(); },
      setVolume: (v) => {
        a.volume = clamp(Number(v || 0), 0, 1);
        if (a.paused && a.volume > 0) play();
      },
    };
  }

  async function bootOne(rootEl) {
    removeLegacyArrows(rootEl);

    const cfg = parseConfig(rootEl);
    const jsonUrl = rootEl.getAttribute("data-json-url") || "";
    const issueId = String(cfg.issueId || "issue");
    const sessionId = makeSessionId();

    const shell = buildShell(rootEl, cfg);
    const ui = buildControls(shell.wrapper);

    shell.wrapper.tabIndex = 0;
    shell.wrapper.setAttribute("role", "region");
    shell.wrapper.setAttribute("aria-label", "Magazine reader");

    setLabel(ui, "Loading…", false);

    let viewer = null, manifest = null, baseHref = "";
    try {
      const loaded = await loadIssue(cfg, jsonUrl);
      viewer = loaded.viewer;
      manifest = loaded.manifest;
      baseHref = loaded.baseHref;
    } catch (_) {
      setLabel(ui, "Failed to load issue", true);
      return;
    }

    applyManifestTheme(shell, rootEl, cfg, manifest, baseHref);

    const { byId } = indexPagesById(viewer);
    const spreads = normalizeSpreads(viewer, byId);
    if (!spreads.length) { setLabel(ui, "No spreads", true); return; }

    const coverInfo = getCoverFromSources(cfg, viewer, manifest, baseHref);
    const coverFront = coverInfo.coverFront || "";
    const coverBack = getBackCoverFromViewer(viewer, baseHref, coverFront);
    const coverText = coverInfo.coverText || "";

    // TOC list
    if (ui.tocList) {
      const items = [];
      const tocFromManifest = manifest && Array.isArray(manifest.toc) ? manifest.toc : null;
      if (tocFromManifest && tocFromManifest.length) {
        tocFromManifest.forEach((it) => {
          items.push({ label: String(it.title || it.label || "Section"), page: Number(it.page || it.pageNumber || 1) });
        });
      } else {
        spreads.forEach((sp, i) => {
          const a = sp.pageLeftNumber || (i * 2 + 1);
          const b = sp.pageRightNumber || (i * 2 + 2);
          items.push({ label: `Pages ${a}–${b}`, page: Number(a) });
        });
      }
      ui.tocList.innerHTML = items.map((it) => `
        <button type="button" class="mag-plug-toc-item" data-page="${it.page}"
          style="width:100%; text-align:left; padding:10px 10px; margin:0; border:0;
                 background:transparent; color:#fff; cursor:pointer; border-radius:10px;">
          ${it.label}
        </button>
      `).join("");

      ui.tocList.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const page = parseInt(t.getAttribute("data-page") || "", 10);
        if (!Number.isFinite(page)) return;
        swallowAll(e);
        if (ui.tocPanel) ui.tocPanel.style.display = "none";
        state.goToPage(page);
      }, true);
    }

    const audioCtl = makeAudioController(cfg, manifest, baseHref);
    const transform = makeBookTransformController(shell, cfg);
    attachHoverTilt(shell, cfg, transform);

    // NAV GUARD: prevents rapid double turns from a single interaction
    const NAV_GUARD_MS = 520;
    let lastNavAt = 0;

    const state = {
      isOpen: false,
      coverSide: "front",
      spreadIndex: 0,
      hasOpenedOnce: false,
      spreads,
      viewMode: "spread",   // "spread" | "single"
      singleSide: "right",  // "left" | "right"

      toggleViewMode: () => {
        if (!state.isOpen) return;
        if (state.viewMode === "spread") {
          state.viewMode = "single";
          state.singleSide = "left";
          if (ui.viewBtn) ui.viewBtn.textContent = "One-page";
        } else {
          state.viewMode = "spread";
          if (ui.viewBtn) ui.viewBtn.textContent = "Two-page";
        }
        state.render(true);
      },

      goCover: (side = "front") => {
        state.isOpen = false;
        state.coverSide = (side === "back") ? "back" : "front";
        shell.wrapper.classList.remove("is-open");
        shell.wrapper.classList.remove("is-opening");

        renderCover(shell.object, coverFront, coverBack, coverText, state.coverSide, () => state.openIssue());

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
        state.viewMode = "spread";
        state.singleSide = "left";
        if (ui.viewBtn) ui.viewBtn.textContent = "Two-page";

        state.render(true);
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

      render: (announce) => {
        const s = spreads[state.spreadIndex];

        renderSpread(shell.object, s.left || null, s.right || null, baseHref, state.viewMode, state.singleSide);

        const pnL = s.pageLeftNumber;
        const pnR = s.pageRightNumber;

        let label = `Spread ${state.spreadIndex + 1} / ${spreads.length}`;
        if (state.viewMode === "single") {
          const one = state.singleSide === "right" ? (pnR || (state.spreadIndex * 2 + 2)) : (pnL || (state.spreadIndex * 2 + 1));
          label = `Page ${one}`;
        } else if (pnL || pnR) {
          const a = pnL ? String(pnL) : "—";
          const b = pnR ? String(pnR) : "—";
          label = `Pages ${a}–${b}`;
        }

        setLabel(ui, label, announce && !!cfg.announcePageChanges);
        updateStacks(shell.stage, state.spreadIndex, spreads.length);

        const pageIndex =
          state.viewMode === "single"
            ? (state.singleSide === "right" ? s.rightIdx : s.leftIdx)
            : (s.leftIdx !== null && s.leftIdx !== undefined ? s.leftIdx : null);

        sendEvent(cfg, issueId, sessionId, "page_view", pageIndex, { spread: state.viewMode !== "single", spread_id: s.id, view: state.viewMode });
      },

      goPrev: (force = false) => {
        const now = Date.now();
        if (!force && (now - lastNavAt) < NAV_GUARD_MS) return;
        lastNavAt = now;

        if (!state.isOpen) {
          if (state.coverSide === "back") state.openToSpread(spreads.length - 1);
          return;
        }

        if (state.viewMode === "single") {
          if (state.singleSide === "right") { state.singleSide = "left"; state.render(true); return; }
          if (state.spreadIndex <= 0) { state.goCover("front"); return; }
          state.spreadIndex = clamp(state.spreadIndex - 1, 0, spreads.length - 1);
          state.singleSide = "right";
          state.render(true);
          return;
        }

        if (state.spreadIndex <= 0) { state.goCover("front"); return; }
        state.spreadIndex = clamp(state.spreadIndex - 1, 0, spreads.length - 1);
        state.render(true);
      },

      goNext: (force = false) => {
        const now = Date.now();
        if (!force && (now - lastNavAt) < NAV_GUARD_MS) return;
        lastNavAt = now;

        if (!state.isOpen) {
          if (state.coverSide === "front") state.openToSpread(0);
          return;
        }

        if (state.viewMode === "single") {
          if (state.singleSide === "left") { state.singleSide = "right"; state.render(true); return; }
          if (state.spreadIndex >= spreads.length - 1) { state.goCover("back"); return; }
          state.spreadIndex = clamp(state.spreadIndex + 1, 0, spreads.length - 1);
          state.singleSide = "left";
          state.render(true);
          return;
        }

        if (state.spreadIndex >= spreads.length - 1) { state.goCover("back"); return; }
        state.spreadIndex = clamp(state.spreadIndex + 1, 0, spreads.length - 1);
        state.render(true);
      },
    };

    attachControls(ui, state, transform, audioCtl);
    attachKeyboard(shell.wrapper, cfg, state);
    attachGestures(shell, state);

    // Start on front cover
    state.goCover("front");
  }

  function bootAll() {
    getRoots().forEach((el) => { bootOne(el); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootAll);
  else bootAll();
})();
