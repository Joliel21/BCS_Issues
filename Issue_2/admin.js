/* BCS Magazine Plug — Admin JS (v1)
   - Copy shortcode buttons
   - Small UX notice (non-blocking)
*/

(function () {
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function flash(el, text) {
    const prev = el.textContent;
    el.textContent = text;
    el.disabled = true;
    setTimeout(() => {
      el.textContent = prev;
      el.disabled = false;
    }, 900);
  }

  ready(function () {
    // Copy shortcode buttons in Issues table
    document.addEventListener("click", async function (e) {
      const btn = e.target && e.target.closest ? e.target.closest(".mag-plug-copy") : null;
      if (!btn) return;

      e.preventDefault();
      const val = btn.getAttribute("data-copy") || "";
      if (!val) return;

      const ok = await copyToClipboard(val);
      flash(btn, ok ? "Copied" : "Copy failed");
    });
  });
})();
